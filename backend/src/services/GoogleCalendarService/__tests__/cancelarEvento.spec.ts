/**
 * Testes TDD para cancelarEvento.
 *
 * Bug #26 (Round 10): Após o bot cancelar um agendamento via tool cancelar_evento,
 * o evento continuava aparecendo no calendário da aplicação porque:
 *   1. cancelarEvento não emitia socket event → frontend não atualizava em tempo real.
 *   2. ListService não filtrava status=CANCELADO → após refresh, evento voltava.
 *
 * Este arquivo cobre a emissão de socket no cancelarEvento.
 * O filtro do ListService é coberto em ListService.spec.ts.
 */

// Modelos: auto-mock (ts-jest injeta jest.fn() em todos os métodos estáticos).
// socket: factory mock explícito — socket.ts requer JWT_SECRET no top-level,
// o que causaria erro de inicialização mesmo com auto-mock.
jest.mock("../../../models/Schedule");
jest.mock("../../../models/Contact");
jest.mock("../../../models/UserCalendar");
// executeWithCalendarErrorHandling: pass-through real (repropaga rejeições, para o
// tool marcar cancelamento parcial). Os fns de API continuam mockáveis.
jest.mock("../calendarApi", () => ({
  __esModule: true,
  getBusyPeriods: jest.fn(),
  createCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  isCalendarConnectionInvalid: jest.fn(() => false),
  executeWithCalendarErrorHandling: jest.fn((fn: () => Promise<any>) => fn())
}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn()
}));

import { cancelarEvento } from "../tools/cancelarEvento";
import Schedule from "../../../models/Schedule";
import UserCalendar from "../../../models/UserCalendar";
import { deleteCalendarEvent } from "../calendarApi";
import { getIO } from "../../../libs/socket";

const mockScheduleFindOne = Schedule.findOne as jest.Mock;
const mockUserCalendarFindOne = UserCalendar.findOne as jest.Mock;
const mockDeleteCalendarEvent = deleteCalendarEvent as jest.Mock;
const mockGetIO = getIO as jest.Mock;

const COMPANY_ID = 2;
const SCHEDULE_ID = 13;
const GOOGLE_EVENT_ID = "l3l3epqq8jlckl1nch9fr0iohk";

function makeScheduleMock(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    companyId: COMPANY_ID,
    contactId: 8,
    professionalId: 2,
    googleEventId: GOOGLE_EVENT_ID,
    status: "PENDENTE",
    contact: { name: "Rithiel" },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSocketMock() {
  const emitMock = jest.fn();
  const toMock = jest.fn().mockReturnValue({ emit: emitMock });
  mockGetIO.mockReturnValue({ to: toMock, emit: emitMock });
  return { emitMock, toMock };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserCalendarFindOne.mockResolvedValue({
    id: 2,
    userId: 2,
    calendarId: "rithieldoamaral@gmail.com",
    isActive: true,
    accessToken: "enc_access",
    refreshToken: "enc_refresh",
    tokenExpiry: new Date("2099-01-01"),
  });
  mockDeleteCalendarEvent.mockResolvedValue(undefined);
});

// ─── Cancelamento bem-sucedido ────────────────────────────────────────────────

test("cancela agendamento no banco e retorna sucesso", async () => {
  const scheduleMock = makeScheduleMock();
  mockScheduleFindOne.mockResolvedValue(scheduleMock);
  makeSocketMock();

  const result = await cancelarEvento({ scheduleId: SCHEDULE_ID }, COMPANY_ID);

  expect(result.sucesso).toBe(true);
  expect(scheduleMock.update).toHaveBeenCalledWith(
    expect.objectContaining({ status: "CANCELADO" })
  );
});

// ─── Bug #26: socket event deve ser emitido após cancelamento ─────────────────

test("[Bug #26] emite socket event após cancelar para atualizar calendário em tempo real", async () => {
  const scheduleMock = makeScheduleMock();
  mockScheduleFindOne.mockResolvedValue(scheduleMock);
  const { toMock, emitMock } = makeSocketMock();

  await cancelarEvento({ scheduleId: SCHEDULE_ID }, COMPANY_ID);

  // Deve ter chamado io.to(room).emit(event, payload)
  expect(mockGetIO).toHaveBeenCalled();
  // Verifica que algum emit foi chamado com action delete ou update
  const allEmitCalls = emitMock.mock.calls;
  const hasScheduleEvent = allEmitCalls.some(
    (call) =>
      typeof call[0] === "string" &&
      call[0].includes("schedule") &&
      call[1] &&
      (call[1].action === "delete" || call[1].action === "update")
  );
  expect(hasScheduleEvent).toBe(true);
});

test("[Bug #26] socket event inclui scheduleId para frontend remover do estado", async () => {
  const scheduleMock = makeScheduleMock();
  mockScheduleFindOne.mockResolvedValue(scheduleMock);
  const { emitMock } = makeSocketMock();

  await cancelarEvento({ scheduleId: SCHEDULE_ID }, COMPANY_ID);

  const scheduleEventCall = emitMock.mock.calls.find(
    (call) => typeof call[0] === "string" && call[0].includes("schedule")
  );
  expect(scheduleEventCall).toBeDefined();
  const payload = scheduleEventCall[1];
  expect(payload.scheduleId ?? payload.schedule?.id).toBe(SCHEDULE_ID);
});

// ─── Falha no Google Calendar: banco é cancelado, socket ainda emite ──────────

test("[Bug #26] mesmo com falha no Google Calendar, socket event é emitido", async () => {
  const scheduleMock = makeScheduleMock();
  mockScheduleFindOne.mockResolvedValue(scheduleMock);
  mockDeleteCalendarEvent.mockRejectedValue(new Error("Token expirado"));
  const { emitMock } = makeSocketMock();

  const result = await cancelarEvento({ scheduleId: SCHEDULE_ID }, COMPANY_ID);

  // Sucesso parcial: banco cancelado, GCal falhou
  expect(result.sucesso).toBe(true);
  expect(result.aviso).toBeDefined();

  // Socket AINDA deve ser emitido
  const hasSocketEmit = emitMock.mock.calls.some(
    (call) => typeof call[0] === "string" && call[0].includes("schedule")
  );
  expect(hasSocketEmit).toBe(true);
});

// ─── Agendamento não encontrado ───────────────────────────────────────────────

test("retorna erro se scheduleId não existir na company", async () => {
  mockScheduleFindOne.mockResolvedValue(null);
  makeSocketMock();

  const result = await cancelarEvento({ scheduleId: 9999 }, COMPANY_ID);

  expect(result.sucesso).toBe(false);
  expect(result.erro).toContain("9999");
});

test("não emite socket se agendamento não encontrado", async () => {
  mockScheduleFindOne.mockResolvedValue(null);
  const { emitMock } = makeSocketMock();

  await cancelarEvento({ scheduleId: 9999 }, COMPANY_ID);

  expect(emitMock).not.toHaveBeenCalled();
});

// ─── Sem googleEventId: cancela no banco, não tenta Google Calendar ───────────

test("cancela no banco mesmo se não tiver googleEventId", async () => {
  const scheduleMock = makeScheduleMock({ googleEventId: null });
  mockScheduleFindOne.mockResolvedValue(scheduleMock);
  makeSocketMock();

  const result = await cancelarEvento({ scheduleId: SCHEDULE_ID }, COMPANY_ID);

  expect(result.sucesso).toBe(true);
  expect(mockDeleteCalendarEvent).not.toHaveBeenCalled();
  expect(scheduleMock.update).toHaveBeenCalledWith(
    expect.objectContaining({ status: "CANCELADO" })
  );
});
