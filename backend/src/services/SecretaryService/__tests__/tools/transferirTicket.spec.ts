/**
 * Testes TDD para a tool transferirTicket.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/User");
jest.mock("../../../../models/Queue");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { transferirTicket } from "../../tools/transferirTicket";
import Ticket from "../../../../models/Ticket";
import User from "../../../../models/User";
import Queue from "../../../../models/Queue";

describe("transferirTicket", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("transfere ticket para usuário e retorna confirmação", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      contact: { name: "Ana" },
      companyId,
      update: jest.fn().mockResolvedValue(undefined)
    };
    const mockUser = { id: 3, name: "Carla Atendente" };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    (User.findOne as jest.Mock).mockResolvedValue(mockUser);

    const result = await transferirTicket({ ticketId: 42, usuarioId: 3 }, companyId);

    expect(mockTicket.update).toHaveBeenCalledWith(expect.objectContaining({ userId: 3, status: "open" }));
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/Carla Atendente/);
  });

  it("transfere ticket para fila e retorna confirmação", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      contact: { name: "Ana" },
      companyId,
      update: jest.fn().mockResolvedValue(undefined)
    };
    const mockQueue = { id: 5, name: "Suporte Técnico" };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    (Queue.findOne as jest.Mock).mockResolvedValue(mockQueue);

    const result = await transferirTicket({ ticketId: 42, filaId: 5 }, companyId);

    expect(mockTicket.update).toHaveBeenCalledWith(expect.objectContaining({ queueId: 5 }));
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/Suporte Técnico/);
  });

  it("retorna erro quando ticket não é encontrado", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null);

    const result = await transferirTicket({ ticketId: 999, filaId: 1 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });

  it("retorna erro quando usuário destino não existe", async () => {
    const mockTicket = {
      id: 42, status: "open", contact: { name: "Ana" }, companyId,
      update: jest.fn()
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    (User.findOne as jest.Mock).mockResolvedValue(null);

    const result = await transferirTicket({ ticketId: 42, usuarioId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/usuário.*não encontrado/i);
    expect(mockTicket.update).not.toHaveBeenCalled();
  });

  it("retorna erro quando fila destino não existe", async () => {
    const mockTicket = {
      id: 42, status: "open", contact: { name: "Ana" }, companyId,
      update: jest.fn()
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    (Queue.findOne as jest.Mock).mockResolvedValue(null);

    const result = await transferirTicket({ ticketId: 42, filaId: 999 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/fila.*não encontrada/i);
  });

  it("retorna erro quando nem filaId nem usuarioId são fornecidos", async () => {
    const mockTicket = {
      id: 42, status: "open", contact: { name: "Ana" }, companyId,
      update: jest.fn()
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);

    const result = await transferirTicket({ ticketId: 42 }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/destino/i);
  });
});
