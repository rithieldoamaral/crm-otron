/**
 * Testes TDD para criarEvento — foco no check anti-duplicata.
 *
 * Bug #24 (Round 9): O check de duplicata verificava apenas status="PENDENTE".
 * Um agendamento com status="ENVIADA" (lembrete disparado) era invisível ao
 * check, permitindo que o agente criasse um segundo agendamento para o mesmo
 * cliente (duplicata silenciosa).
 *
 * Fix: o Op.in do check anti-duplicata deve incluir tanto "PENDENTE" quanto
 * "ENVIADA" — ambos representam agendamentos ativos do cliente.
 */

jest.mock("../../../models/Schedule");
jest.mock("../../../models/Service");
jest.mock("../../../models/ServiceProfessional");
jest.mock("../../../models/User");
jest.mock("../../../models/Contact");
jest.mock("../../../models/UserCalendar");
jest.mock("../../../models/UserWorkingHours");
jest.mock("../calendarApi");

import { criarEvento } from "../tools/criarEvento";
import Schedule from "../../../models/Schedule";
import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import User from "../../../models/User";
import Contact from "../../../models/Contact";
import UserCalendar from "../../../models/UserCalendar";
import UserWorkingHours from "../../../models/UserWorkingHours";
import { createCalendarEvent, getBusyPeriods } from "../calendarApi";

const mockScheduleFindOne = Schedule.findOne as jest.Mock;
const mockScheduleCreate = Schedule.create as jest.Mock;
const mockServiceFindOne = Service.findOne as jest.Mock;
const mockUserFindOne = User.findOne as jest.Mock;
const mockContactFindOne = Contact.findOne as jest.Mock;
const mockUserCalendarFindOne = UserCalendar.findOne as jest.Mock;
const mockUserWorkingHoursFindOne = UserWorkingHours.findOne as jest.Mock;
const mockServiceProfessionalFindOne = ServiceProfessional.findOne as jest.Mock;
const mockCreateCalendarEvent = createCalendarEvent as jest.Mock;
const mockGetBusyPeriods = getBusyPeriods as jest.Mock;

const COMPANY_ID = 1;
const CONTACT_ID = 42;
const ATTENDANT_ID = 5;
const SERVICE_ID = 3;

// Data futura estável — nunca vai "passar"
const FUTURE_DATA = "2099-06-15";
const FUTURE_HORA = "14:00";

function setupCommonMocks() {
  mockServiceFindOne.mockResolvedValue({ id: SERVICE_ID, name: "Reparo de dentes", durationMinutes: 60 });
  mockUserFindOne.mockResolvedValue({ id: ATTENDANT_ID, name: "Dr. Carlos" });
  mockContactFindOne.mockResolvedValue({ id: CONTACT_ID, name: "João Silva", number: "5511999990001" });
  mockUserCalendarFindOne.mockResolvedValue({ id: 1, calendarId: "cal@example.com", isActive: true });
  // Bug #39: criar_evento agora valida disponibilidade. Mocks padrão = profissional
  // trabalha 09:00–18:00 e a agenda está livre, então o horário 14:00 é válido.
  mockUserWorkingHoursFindOne.mockResolvedValue({ dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true });
  mockGetBusyPeriods.mockResolvedValue([]);
  mockCreateCalendarEvent.mockResolvedValue({ id: "google-event-id-xyz" });
  mockScheduleCreate.mockResolvedValue({ id: 99 });
  // Furo #4: por padrão o profissional realiza o serviço (vínculo existe).
  mockServiceProfessionalFindOne.mockResolvedValue({ id: 1, serviceId: SERVICE_ID, userId: ATTENDANT_ID });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupCommonMocks();
});

// ─── Bug #24: check anti-duplicata deve cobrir ENVIADA ───────────────────────

describe("criarEvento — Bug #24: anti-duplicata inclui status ENVIADA", () => {
  it("BLOQUEIA criação quando existe agendamento com status ENVIADA", async () => {
    // Cenário: cliente já tem agendamento com lembrete enviado (ENVIADA).
    // Sem o fix, criarEvento ignorava esse agendamento e criaria um duplicado.
    mockScheduleFindOne.mockResolvedValue({
      id: 55,
      status: "ENVIADA",
      sendAt: new Date(`${FUTURE_DATA}T14:00:00`),
      professionalId: ATTENDANT_ID,
      service: { name: "Reparo de dentes" }
    });

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toBeDefined();
    // O erro deve mencionar o agendamento existente (por id ou orientação)
    expect(result.erro).toMatch(/55|existente|pendente|agendamento/i);
    // Não deve ter criado evento no Google Calendar
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("a query anti-duplicata inclui ENVIADA no Op.in de status", async () => {
    mockScheduleFindOne.mockResolvedValue(null); // sem duplicata — permite criação

    await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    const whereClause = mockScheduleFindOne.mock.calls[0][0].where;
    const statusFilter = whereClause.status;

    // Quando Op.in está presente, verificar que inclui ambos os status ativos
    const inKey = Object.getOwnPropertySymbols(statusFilter).find(
      s => s.toString() === "Symbol(in)"
    );
    expect(inKey).toBeDefined();

    const includedStatuses: string[] = statusFilter[inKey!];
    expect(includedStatuses).toContain("PENDENTE");
    expect(includedStatuses).toContain("ENVIADA");
  });

  it("AINDA bloqueia duplicata com status PENDENTE (comportamento pré-existente)", async () => {
    mockScheduleFindOne.mockResolvedValue({
      id: 56,
      status: "PENDENTE",
      sendAt: new Date(`${FUTURE_DATA}T14:00:00`),
      professionalId: ATTENDANT_ID,
      service: { name: "Reparo de dentes" }
    });

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("PERMITE criação quando não há agendamento ativo (PENDENTE nem ENVIADA)", async () => {
    mockScheduleFindOne.mockResolvedValue(null); // nenhum agendamento ativo

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(true);
    expect(result.agendamentoId).toBeDefined();
    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
  });
});

// ─── Bug #36: instante enviado ao Google é horário de parede BRT ─────────────

describe("criarEvento — Bug #36: timezone do write path (BRT → UTC)", () => {
  it("envia ao Google o instante BRT correto (14:00 BRT = 17:00 UTC)", async () => {
    mockScheduleFindOne.mockResolvedValue(null);

    await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "14:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
    const callArg = mockCreateCalendarEvent.mock.calls[0][0];
    // 14:00 BRT (-03:00) === 17:00Z, independente do fuso do runner.
    expect(callArg.startDateTime).toBe(`${FUTURE_DATA}T17:00:00.000Z`);
    // Serviço dura 60min → fim às 18:00Z.
    expect(callArg.endDateTime).toBe(`${FUTURE_DATA}T18:00:00.000Z`);
  });

  it("persiste sendAt no Schedule como instante BRT correto (não adiantado 3h)", async () => {
    mockScheduleFindOne.mockResolvedValue(null);

    await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "14:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(mockScheduleCreate).toHaveBeenCalledTimes(1);
    const created = mockScheduleCreate.mock.calls[0][0];
    expect(created.sendAt.toISOString()).toBe(`${FUTURE_DATA}T17:00:00.000Z`);
  });
});

// ─── Validações pré-existentes não afetadas pelo fix ─────────────────────────

describe("criarEvento — validações existentes", () => {
  it("retorna erro quando serviço não encontrado", async () => {
    mockServiceFindOne.mockResolvedValue(null);
    mockScheduleFindOne.mockResolvedValue(null);

    const result = await criarEvento(
      { servicoId: 999, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/serviço/i);
  });

  it("retorna erro quando profissional sem calendário conectado", async () => {
    mockUserCalendarFindOne.mockResolvedValue(null);
    mockScheduleFindOne.mockResolvedValue(null);

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/calendário/i);
  });

  it("retorna erro para data no passado", async () => {
    mockScheduleFindOne.mockResolvedValue(null);

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: "2000-01-01", hora: "10:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/passado|já passou/i);
  });
});

// ─── Bug #39: validação determinística de disponibilidade no write path ──────
//
// Com a Feature UX-1, verificar_disponibilidade deixou de devolver a lista de
// slots ao LLM (só a faixa). criar_evento passa a ser a ÚNICA garantia
// determinística de que o horário escolhido está livre e dentro do expediente.

describe("criarEvento — Bug #39: valida disponibilidade antes de criar", () => {
  it("BLOQUEIA agendamento quando o profissional não trabalha no dia", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    mockUserWorkingHoursFindOne.mockResolvedValue({ dayOfWeek: 0, isWorking: false });

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: FUTURE_HORA, contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não atende/i);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("BLOQUEIA agendamento em horário fora do expediente (antes da abertura)", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    // Expediente 09:00–18:00; tenta 08:00 (antes da abertura)
    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "08:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não está disponível|fora do expediente|ocupado/i);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("BLOQUEIA agendamento sobre um horário já ocupado (anti double-booking)", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    // 14:00–15:00 está ocupado na agenda do profissional
    mockGetBusyPeriods.mockResolvedValue([{ start: "14:00", end: "15:00" }]);

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "14:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não está disponível|ocupado/i);
    // O erro deve sugerir horários livres (faixa)
    expect(result.erro).toMatch(/\d{2}:\d{2}/);
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled();
  });

  it("PERMITE agendamento em horário válido e livre", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    mockGetBusyPeriods.mockResolvedValue([]);

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "14:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(true);
    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it("FAIL-OPEN: se a checagem de agenda do Google falhar, não bloqueia o agendamento", async () => {
    mockScheduleFindOne.mockResolvedValue(null);
    // getBusyPeriods rejeita (erro transitório do Google) → criar_evento prossegue
    mockGetBusyPeriods.mockRejectedValue(new Error("Google API timeout"));

    const result = await criarEvento(
      { servicoId: SERVICE_ID, atendenteId: ATTENDANT_ID, data: FUTURE_DATA, hora: "14:00", contactId: CONTACT_ID },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(true);
    expect(mockCreateCalendarEvent).toHaveBeenCalledTimes(1);
  });
});
