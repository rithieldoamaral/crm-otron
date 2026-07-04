/**
 * Testes TDD para a tool fecharTicket.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { fecharTicket } from "../../tools/fecharTicket";
import Ticket from "../../../../models/Ticket";

describe("fecharTicket", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("fecha ticket com sucesso e retorna confirmação", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      contact: { name: "Maria Silva" },
      companyId,
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);

    const result = await fecharTicket({ ticketId: 42 }, companyId);

    expect(mockTicket.update).toHaveBeenCalledWith({ status: "closed" });
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/fechado|encerrado/i);
  });

  it("inclui nome do cliente na confirmação", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      contact: { name: "João Tutora" },
      companyId,
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);

    const result = await fecharTicket({ ticketId: 42 }, companyId);

    expect(result.mensagem).toMatch(/João Tutora/);
  });

  it("retorna erro quando ticket não é encontrado", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null);

    const result = await fecharTicket({ ticketId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });

  it("retorna erro quando ticket já está fechado", async () => {
    const mockTicket = {
      id: 42,
      status: "closed",
      contact: { name: "Ana" },
      companyId,
      update: jest.fn()
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);

    const result = await fecharTicket({ ticketId: 42 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/já fechado|already/i);
    expect(mockTicket.update).not.toHaveBeenCalled();
  });
});
