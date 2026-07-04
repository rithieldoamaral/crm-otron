/**
 * Testes TDD para consultarMetricas.
 * Snapshot operacional: tickets abertos/pendentes/em espera, agendamentos hoje,
 * tickets fechados hoje e ontem.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Schedule");
jest.mock("../../../AgentService/settingsCache");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { consultarMetricas } from "../../tools/consultarMetricas";
import Ticket from "../../../../models/Ticket";
import Schedule from "../../../../models/Schedule";
import { getSettingsByCompany } from "../../../AgentService/settingsCache";

const mockTicketCount = Ticket.count as jest.Mock;
const mockScheduleCount = Schedule.count as jest.Mock;
const mockGetSettings = getSettingsByCompany as jest.Mock;

/** Configura contagens em ordem: open, pending, waitLong, closedToday, closedYesterday. */
function setupTicketCounts(
  open: number,
  pending: number,
  waitLong: number,
  closedToday: number,
  closedYesterday: number
) {
  mockTicketCount
    .mockResolvedValueOnce(open)
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(waitLong)
    .mockResolvedValueOnce(closedToday)
    .mockResolvedValueOnce(closedYesterday);
}

describe("consultarMetricas", () => {
  const companyId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
    // Limiar padrão de 60 min — reutilizado em todos os testes que não testam isso.
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAlertWaitMinutes", value: "60" }
    ]);
  });

  it("retorna contagem de tickets abertos", async () => {
    setupTicketCounts(10, 3, 2, 22, 18);
    mockScheduleCount.mockResolvedValue(6);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsAbertos).toBe(10);
  });

  it("retorna contagem de tickets pendentes", async () => {
    setupTicketCounts(5, 7, 0, 10, 8);
    mockScheduleCount.mockResolvedValue(3);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsPendentes).toBe(7);
  });

  it("retorna tickets em espera longa com limiar de 60 min", async () => {
    setupTicketCounts(15, 5, 4, 20, 15);
    mockScheduleCount.mockResolvedValue(8);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsEmEsperaLonga).toBe(4);
    expect(result.limiarEsperaMinutos).toBe(60);
  });

  it("usa limiar de espera de 120 min quando setting configurado", async () => {
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAlertWaitMinutes", value: "120" }
    ]);
    setupTicketCounts(5, 2, 1, 8, 5);
    mockScheduleCount.mockResolvedValue(2);

    const result = await consultarMetricas({}, companyId);

    expect(result.limiarEsperaMinutos).toBe(120);
  });

  it("usa limiar padrão de 60 min quando secretaryAlertWaitMinutes é 0 ou ausente", async () => {
    // 0 é "desativado" para alertas proativos, mas para métricas usamos 60 como fallback
    mockGetSettings.mockResolvedValue([]);
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(0);

    const result = await consultarMetricas({}, companyId);

    expect(result.limiarEsperaMinutos).toBe(60);
  });

  it("retorna agendamentos de hoje", async () => {
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(9);

    const result = await consultarMetricas({}, companyId);

    expect(result.agendamentosHoje).toBe(9);
  });

  it("retorna tickets fechados hoje", async () => {
    setupTicketCounts(0, 0, 0, 22, 18);
    mockScheduleCount.mockResolvedValue(0);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsFechadosHoje).toBe(22);
  });

  it("retorna tickets fechados ontem", async () => {
    setupTicketCounts(0, 0, 0, 5, 18);
    mockScheduleCount.mockResolvedValue(0);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsFechadosOntem).toBe(18);
  });

  it("usa companyId correto em todas as queries de Ticket.count", async () => {
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(0);

    await consultarMetricas({}, 42);

    const allCalls = mockTicketCount.mock.calls;
    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      expect(call[0].where.companyId).toBe(42);
    }
  });

  it("usa companyId correto no Schedule.count", async () => {
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(0);

    await consultarMetricas({}, 99);

    expect(mockScheduleCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 99 }) })
    );
  });

  it("retorna todos os 7 campos da interface sem undefined", async () => {
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(0);

    const result = await consultarMetricas({}, companyId);

    expect(result.ticketsAbertos).toBeDefined();
    expect(result.ticketsPendentes).toBeDefined();
    expect(result.ticketsEmEsperaLonga).toBeDefined();
    expect(result.agendamentosHoje).toBeDefined();
    expect(result.ticketsFechadosHoje).toBeDefined();
    expect(result.ticketsFechadosOntem).toBeDefined();
    expect(result.limiarEsperaMinutos).toBeDefined();
  });

  it("executa todas as 5 queries de Ticket.count (open, pending, waitLong, closedToday, closedYesterday)", async () => {
    mockTicketCount.mockResolvedValue(0);
    mockScheduleCount.mockResolvedValue(0);

    await consultarMetricas({}, companyId);

    expect(mockTicketCount).toHaveBeenCalledTimes(5);
    expect(mockScheduleCount).toHaveBeenCalledTimes(1);
  });
});
