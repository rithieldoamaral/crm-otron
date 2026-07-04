/**
 * Testes TDD para reabrirTicket.
 * Admin reabre um ticket fechado que foi encerrado por engano ou precisa
 * de continuidade.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Contact");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { reabrirTicket } from "../../tools/reabrirTicket";
import Ticket from "../../../../models/Ticket";

const mockFindOne = Ticket.findOne as jest.Mock;

function makeTicket(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 42,
    status: "closed",
    contact: { name: "Maria Silva" },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("reabrirTicket", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("reabre um ticket fechado com sucesso", async () => {
    const ticket = makeTicket();
    mockFindOne.mockResolvedValue(ticket);

    const result = await reabrirTicket({ ticketId: 42 }, companyId);

    expect(result.sucesso).toBe(true);
    expect(ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" })
    );
  });

  it("mensagem de sucesso menciona o nome do cliente e o ID do ticket", async () => {
    const ticket = makeTicket({ contact: { name: "João Ferreira" } });
    mockFindOne.mockResolvedValue(ticket);

    const result = await reabrirTicket({ ticketId: 42 }, companyId);

    expect(result.mensagem).toMatch(/João Ferreira/);
    expect(result.mensagem).toMatch(/42/);
  });

  it("retorna erro quando ticket não encontrado", async () => {
    mockFindOne.mockResolvedValue(null);

    const result = await reabrirTicket({ ticketId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
    expect(mockFindOne).toHaveBeenCalled();
  });

  it("retorna erro quando ticket já está aberto (status 'open')", async () => {
    const ticket = makeTicket({ status: "open" });
    mockFindOne.mockResolvedValue(ticket);

    const result = await reabrirTicket({ ticketId: 42 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não está fechado|já está aberto/i);
    expect(ticket.update).not.toHaveBeenCalled();
  });

  it("retorna erro quando ticket está pendente (status 'pending')", async () => {
    const ticket = makeTicket({ status: "pending" });
    mockFindOne.mockResolvedValue(ticket);

    const result = await reabrirTicket({ ticketId: 42 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não está fechado/i);
    expect(ticket.update).not.toHaveBeenCalled();
  });

  it("usa companyId correto na busca (isolamento multi-tenant)", async () => {
    mockFindOne.mockResolvedValue(null);

    await reabrirTicket({ ticketId: 42 }, 55);

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 55 }) })
    );
  });

  it("atualiza status para 'open' — não para 'pending'", async () => {
    const ticket = makeTicket();
    mockFindOne.mockResolvedValue(ticket);

    await reabrirTicket({ ticketId: 42 }, companyId);

    expect(ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" })
    );
    const updateArg = ticket.update.mock.calls[0][0];
    expect(updateArg.status).not.toBe("pending");
  });
});
