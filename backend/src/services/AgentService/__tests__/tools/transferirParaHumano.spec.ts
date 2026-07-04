/**
 * Testes TDD para a tool transferirParaHumano.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../../TicketServices/ShowTicketService", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ id: 77, status: "pending", chatbot: false })
}));

import { transferirParaHumano } from "../../tools/transferirParaHumano";
import Ticket from "../../../../models/Ticket";

describe("transferirParaHumano", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("desativa chatbot, seta status pending e retorna confirmação", async () => {
    const mockTicket = {
      id: 77,
      chatbot: true,
      userId: 5,
      status: "open",
      companyId,
      save: jest.fn().mockResolvedValue(undefined)
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);

    const result = await transferirParaHumano(
      { ticketId: 77, motivo: "Cliente pediu atendimento humano" },
      companyId
    );

    expect(mockTicket.save).toHaveBeenCalledTimes(1);
    expect(mockTicket.chatbot).toBe(false);
    expect(mockTicket.userId).toBeNull();
    expect(mockTicket.status).toBe("pending");
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/transferido/i);
  });

  it("retorna erro quando ticket não é encontrado", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null);

    const result = await transferirParaHumano(
      { ticketId: 999, motivo: "teste" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });
});
