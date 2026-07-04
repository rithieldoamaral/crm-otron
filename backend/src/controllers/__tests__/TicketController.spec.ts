/**
 * Testes TDD para o gate de autorização da listagem de tickets (ticket #22,
 * tech debt "Access-control REST da listagem de Secretária").
 *
 * Why: a aba "Secretária" (status="secretary") é privilégio do admin. O frontend
 * esconde a aba de não-admins e o realtime (socket) já é admin-only, mas o
 * endpoint REST `GET /tickets?status=secretary` era craftável por um não-admin
 * da MESMA empresa, que recebia os tickets de Secretária no fetch inicial.
 * Este teste fixa o contrato: status="secretary" exige profile==="admin" (403).
 */

jest.mock("../../services/TicketServices/ListTicketsService");
// Factory mock: socket.ts importa config/auth (exige JWT_SECRET no load).
// O gate de Secretária não usa socket, então um stub vazio basta.
jest.mock("../../libs/socket", () => ({ getIO: jest.fn() }));
// O controller importa serviços-irmãos (store/update/remove) cujo grafo de
// imports carrega `baileys` (ESM, não transformável pelo ts-jest). O handler
// `index` testado aqui só usa ListTicketsService, então stubamos o resto para
// manter a suíte isolada e rápida (sem subir o wbot/baileys).
jest.mock("../../services/TicketServices/CreateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/DeleteTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/ShowTicketFromUUIDService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/ShowTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/ListTicketsServiceReport", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/TicketServices/ListTicketsServiceKanban", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../models/Ticket", () => ({ __esModule: true, default: {} }));

import { index } from "../TicketController";
import ListTicketsService from "../../services/TicketServices/ListTicketsService";
import AppError from "../../errors/AppError";

const mockList = ListTicketsService as jest.Mock;

/** Monta um req/res mínimos para exercitar o controller sem Express real. */
const buildReqRes = (profile: string, status: string) => {
  const req: any = {
    query: { status, showAll: "true" },
    user: { id: 7, companyId: 1, profile }
  };
  const json = jest.fn();
  const res: any = { status: jest.fn(() => res), json };
  return { req, res, json };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ tickets: [], count: 0, hasMore: false });
});

describe("TicketController.index — gate de Secretária", () => {
  it("admin VÊ a listagem status='secretary' (chama o service)", async () => {
    const { req, res, json } = buildReqRes("admin", "secretary");

    await index(req, res);

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: "secretary", companyId: 1 })
    );
    expect(json).toHaveBeenCalledWith({ tickets: [], count: 0, hasMore: false });
  });

  it("não-admin NÃO vê status='secretary' (403, service nunca é chamado)", async () => {
    const { req, res } = buildReqRes("user", "secretary");

    await expect(index(req, res)).rejects.toMatchObject({
      statusCode: 403
    });
    await expect(index(req, res)).rejects.toBeInstanceOf(AppError);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("não-admin continua vendo status normais (ex.: 'open') — gate é só de Secretária", async () => {
    const { req } = buildReqRes("user", "open");

    await index(req, { status: jest.fn(() => ({ json: jest.fn() })) } as any);

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open", companyId: 1 })
    );
  });
});
