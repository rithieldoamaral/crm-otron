/**
 * Testes TDD para cancelarEvento.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/UserCalendar");
// executeWithCalendarErrorHandling: pass-through real (repropaga rejeições, para o
// tool marcar cancelamento parcial). Ver verificarDisponibilidade.spec.ts.
jest.mock("../../calendarApi", () => ({
  __esModule: true,
  getBusyPeriods: jest.fn(),
  createCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  isCalendarConnectionInvalid: jest.fn(() => false),
  executeWithCalendarErrorHandling: jest.fn((fn: () => Promise<any>) => fn())
}));
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

import { cancelarEvento } from "../../tools/cancelarEvento";
import Schedule from "../../../../models/Schedule";
import UserCalendar from "../../../../models/UserCalendar";
import { deleteCalendarEvent } from "../../calendarApi";
import { logger } from "../../../../utils/logger";

const mockDelete = deleteCalendarEvent as jest.Mock;
const mockLoggerError = (logger as any).error as jest.Mock;

describe("cancelarEvento", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("cancela evento no Calendar e atualiza Schedule", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_123",
      professionalId: 10,
      status: "PENDENTE",
      contact: { name: "Ana" },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000) });
    mockDelete.mockResolvedValue(undefined);

    const result = await cancelarEvento({ scheduleId: 42 }, companyId);

    expect(mockDelete).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_123" }));
    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELADO" }));
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/cancelado/i);
  });

  // Furo #3 (2026-06-20): idempotência. LLM barato às vezes chama cancelar 2x.
  // Se já está CANCELADO, não tenta deletar de novo no Google (evita 404/410 →
  // falso alarme de "cancelamento parcial").
  it("é idempotente: agendamento já CANCELADO não tenta deletar de novo (Furo #3)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_123",
      professionalId: 10,
      status: "CANCELADO",
      contact: { name: "Ana" },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);

    const result = await cancelarEvento({ scheduleId: 42 }, companyId);

    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/já estava cancelado|já.*cancelado/i);
    // Não deve tentar deletar no Google nem re-atualizar o Schedule.
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSchedule.update).not.toHaveBeenCalled();
    // E NÃO deve dar falso alarme de cancelamento parcial.
    expect(result.mensagem).not.toMatch(/parcial/i);
  });

  it("retorna erro quando agendamento não existe", async () => {
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);

    const result = await cancelarEvento({ scheduleId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });

  it("ainda atualiza Schedule mesmo se remoção do Google Calendar falhar", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_123",
      professionalId: 10,
      contact: { name: "Ana" },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000) });
    mockDelete.mockRejectedValue(new Error("Google offline"));

    const result = await cancelarEvento({ scheduleId: 42 }, companyId);

    // Schedule deve ser cancelado mesmo com Google offline
    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELADO" }));
    expect(result.sucesso).toBe(true);
    expect(result.aviso).toMatch(/Google|calendário/i);
  });

  // Regressão bug #7: catch silencioso engolia exception sem logger.error.
  // CLAUDE.md II.5 proíbe catch sem log — bug ficava invisível em produção.
  it("loga o erro com logger.error quando deleteCalendarEvent falha (bug #7)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_123",
      professionalId: 10,
      contact: { name: "Ana" },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockDelete.mockRejectedValue(new Error("API quota exceeded"));

    await cancelarEvento({ scheduleId: 42 }, companyId);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringMatching(/cancelar_evento.*Google|Google.*falh|deleteCalendarEvent/i)
    );
  });

  // Regressão bug #7: a mensagem ao cliente em caso de falha do Google
  // dizia "✅ cancelado" idêntico ao caso de sucesso, e o LLM passava ao
  // cliente "✅ Agendamento cancelado com sucesso" enquanto o evento
  // continuava vivo na agenda do profissional.
  it("não retorna mensagem de sucesso limpa quando Google falha (bug #7)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_123",
      professionalId: 10,
      contact: { name: "Ana" },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockDelete.mockRejectedValue(new Error("Google offline"));

    const result = await cancelarEvento({ scheduleId: 42 }, companyId);

    // Mensagem deve indicar que foi parcial / pode permanecer no Google,
    // não pode ser indistinguível do sucesso completo.
    expect(result.mensagem).toMatch(/parcial|permanec|verifi|não.*sincroniz|pode.*aparecer/i);
  });
});
