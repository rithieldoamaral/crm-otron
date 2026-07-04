/**
 * Testes TDD para cancelarAgendamento.
 * Admin cancela agendamento: atualiza reminderStatus → "cancelled"
 * e remove o evento do Google Calendar quando possível.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/UserCalendar");
jest.mock("../../../GoogleCalendarService/calendarApi");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { cancelarAgendamento } from "../../tools/cancelarAgendamento";
import Schedule from "../../../../models/Schedule";
import UserCalendar from "../../../../models/UserCalendar";
import { deleteCalendarEvent } from "../../../GoogleCalendarService/calendarApi";

const mockScheduleFindOne = Schedule.findOne as jest.Mock;
const mockUserCalendarFindOne = UserCalendar.findOne as jest.Mock;
const mockDelete = deleteCalendarEvent as jest.Mock;

function makeSchedule(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 10,
    googleEventId: "evt_abc",
    professionalId: 5,
    reminderStatus: "pending",
    contact: { name: "Maria", number: "5511999990001" },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function makeUserCalendar(): any {
  return {
    calendarId: "cal_xyz",
    accessToken: "tok",
    refreshToken: "ref",
    tokenExpiry: new Date(Date.now() + 3_600_000)
  };
}

describe("cancelarAgendamento", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("cancela agendamento com sucesso: atualiza reminderStatus para 'cancelled'", async () => {
    const schedule = makeSchedule();
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());
    mockDelete.mockResolvedValue(undefined);

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.sucesso).toBe(true);
    expect(schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ reminderStatus: "cancelled" })
    );
  });

  // Correção (2026-06-21): a Secretária deve marcar status="CANCELADO" igual ao
  // Agente — senão buscarAgendamentoCliente (que filtra por status) continua vendo
  // o agendamento como ativo após cancelamento via Secretária.
  it("marca status='CANCELADO' (paridade com o Agente, não só reminderStatus)", async () => {
    const schedule = makeSchedule();
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());
    mockDelete.mockResolvedValue(undefined);

    await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CANCELADO", reminderStatus: "cancelled" })
    );
  });

  it("considera já cancelado quando status='CANCELADO' (mesmo sem reminderStatus)", async () => {
    const schedule = makeSchedule({ status: "CANCELADO", reminderStatus: "pending" });
    mockScheduleFindOne.mockResolvedValue(schedule);

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/já cancelado/i);
    expect(schedule.update).not.toHaveBeenCalled();
  });

  it("deleta o evento do Google Calendar quando googleEventId existe", async () => {
    const schedule = makeSchedule({ googleEventId: "evt_123" });
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());
    mockDelete.mockResolvedValue(undefined);

    await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt_123" })
    );
  });

  it("não chama deleteCalendarEvent quando googleEventId é null/vazio", async () => {
    const schedule = makeSchedule({ googleEventId: null });
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.sucesso).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(schedule.update).toHaveBeenCalled();
  });

  it("retorna erro quando agendamento não encontrado", async () => {
    mockScheduleFindOne.mockResolvedValue(null);

    const result = await cancelarAgendamento({ scheduleId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("retorna erro quando agendamento já está cancelado", async () => {
    const schedule = makeSchedule({ reminderStatus: "cancelled" });
    mockScheduleFindOne.mockResolvedValue(schedule);

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/já cancelado/i);
    expect(schedule.update).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("retorna sucesso com aviso quando deleteCalendarEvent falha (evento já deletado externamente)", async () => {
    const schedule = makeSchedule({ googleEventId: "evt_abc" });
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());
    mockDelete.mockRejectedValue(new Error("Not Found"));

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    // Cancelamento no BD deve ter ocorrido mesmo com falha no Calendar
    expect(result.sucesso).toBe(true);
    expect(result.aviso).toMatch(/calendar|google|agenda/i);
    expect(schedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ reminderStatus: "cancelled" })
    );
  });

  it("quando UserCalendar não existe, pula deleção do Calendar e ainda cancela no BD", async () => {
    const schedule = makeSchedule({ googleEventId: "evt_abc" });
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(null); // sem calendário conectado

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.sucesso).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(schedule.update).toHaveBeenCalled();
  });

  it("mensagem de sucesso menciona o nome do cliente", async () => {
    const schedule = makeSchedule({ contact: { name: "João Teste", number: "5511988880000" } });
    mockScheduleFindOne.mockResolvedValue(schedule);
    mockUserCalendarFindOne.mockResolvedValue(makeUserCalendar());
    mockDelete.mockResolvedValue(undefined);

    const result = await cancelarAgendamento({ scheduleId: 10 }, companyId);

    expect(result.mensagem).toMatch(/João Teste/);
  });

  it("usa companyId correto na busca do agendamento (isolamento multi-tenant)", async () => {
    mockScheduleFindOne.mockResolvedValue(null);

    await cancelarAgendamento({ scheduleId: 10 }, 99);

    expect(mockScheduleFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 99 }) })
    );
  });
});
