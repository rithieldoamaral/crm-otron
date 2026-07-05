/**
 * Testes TDD para persistência de `serviceId` em recordHistory (ITEM D — Fase 7).
 *
 * Objetivo: garantir que `recordHistory` grava o vínculo com o catálogo
 * (serviceId) quando fornecido, SEM quebrar chamadas legadas (sem serviceId →
 * grava null). As dependências de I/O e os hooks fire-and-forget são mockados
 * (mesmo padrão dos demais specs do módulo, que isolam a lógica sob teste).
 */

jest.mock("../../../models/ServiceHistory");
jest.mock("../../../models/Service");
jest.mock("../LoyaltyService", () => ({ checkAndAwardLoyalty: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../WinbackService", () => ({ markWinbackConverted: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../ReferralService", () => ({ convertReferralIfPending: jest.fn().mockResolvedValue(undefined) }));
// UpdateTicketService puxa socket.ts → config/auth.ts (exige JWT_SECRET no boot).
// recordHistory não usa UpdateTicketService — só recordKanbanCompletion usa — então
// mockamos para o módulo carregar sem depender do ambiente de auth.
jest.mock("../../TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../../utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import { recordHistory } from "../ServiceHistoryService";
import ServiceHistory from "../../../models/ServiceHistory";
import Service from "../../../models/Service";

const mockCreate = ServiceHistory.create as jest.Mock;
const mockCount = ServiceHistory.count as jest.Mock;
const mockServiceFindOne = Service.findOne as jest.Mock;

describe("recordHistory — persistência de serviceId (Fase 7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockImplementation(async (attrs: any) => ({ id: 1, ...attrs }));
    mockCount.mockResolvedValue(1);
    mockServiceFindOne.mockResolvedValue({ price: 50 });
  });

  it("grava serviceId quando fornecido", async () => {
    await recordHistory({
      contactId: 42,
      companyId: 1,
      source: "manual",
      serviceId: 7,
      value: 100
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ serviceId: 7 });
  });

  it("grava serviceId = null quando NÃO fornecido (chamada legada)", async () => {
    await recordHistory({
      contactId: 42,
      companyId: 1,
      source: "manual",
      value: 100
    });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({ serviceId: null });
  });

  it("mantém o auto-populate de value pelo catálogo ao usar serviceId (regressão)", async () => {
    // serviceId fornecido, value omitido → busca preço do catálogo (50).
    await recordHistory({
      contactId: 42,
      companyId: 1,
      source: "manual",
      serviceId: 7
    });

    expect(mockServiceFindOne).toHaveBeenCalled();
    const created = mockCreate.mock.calls[0][0];
    expect(created.serviceId).toBe(7);
    expect(created.value).toBe(50);
  });
});
