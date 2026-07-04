/**
 * Testes TDD para a tool enviarMensagemParaCliente.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Contact");
jest.mock("../../../../services/WbotServices/SendWhatsAppMessage");
jest.mock("../../../../services/TicketServices/FindOrCreateTicketService");
jest.mock("../../../../helpers/GetDefaultWhatsApp");
jest.mock("../../../../libs/wbot", () => ({}));
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { enviarMensagemParaCliente } from "../../tools/enviarMensagemParaCliente";
import Ticket from "../../../../models/Ticket";
import Contact from "../../../../models/Contact";
import SendWhatsAppMessage from "../../../../services/WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../../../../services/TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../../../helpers/GetDefaultWhatsApp";

const mockSend = SendWhatsAppMessage as jest.Mock;
const mockContactFindOne = Contact.findOne as jest.Mock;
const mockFindOrCreate = FindOrCreateTicketService as jest.Mock;
const mockGetWa = GetDefaultWhatsApp as jest.Mock;

describe("enviarMensagemParaCliente", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("envia mensagem e retorna confirmação com nome do cliente", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      whatsappId: 2,
      contact: { id: 10, name: "Ana Oliveira", number: "5511999990001" }
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    mockSend.mockResolvedValue(undefined);

    const result = await enviarMensagemParaCliente(
      { ticketId: 42, mensagem: "Seu pet está pronto para buscar!" },
      companyId
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      body: "Seu pet está pronto para buscar!",
      ticket: mockTicket
    }));
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/Ana Oliveira/);
  });

  it("retorna erro quando ticket não existe", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null);

    const result = await enviarMensagemParaCliente(
      { ticketId: 999, mensagem: "teste" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("retorna erro quando ticket pertence a outra empresa", async () => {
    (Ticket.findOne as jest.Mock).mockResolvedValue(null); // findOne filtra por companyId

    const result = await enviarMensagemParaCliente(
      { ticketId: 42, mensagem: "teste" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("retorna erro quando o envio WhatsApp falha", async () => {
    const mockTicket = {
      id: 42,
      status: "open",
      whatsappId: 2,
      contact: { id: 10, name: "Carlos", number: "5511999990001" }
    };
    (Ticket.findOne as jest.Mock).mockResolvedValue(mockTicket);
    mockSend.mockRejectedValue(new Error("wbot offline"));

    const result = await enviarMensagemParaCliente(
      { ticketId: 42, mensagem: "teste" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/wbot offline|falha/i);
  });

  // ── Disparo a um contato SEM ticket (contactId) ──────────────────────────
  it("por contactId: acha o contato, abre ticket no canal conectado e envia", async () => {
    mockContactFindOne.mockResolvedValue({ id: 8, name: "Amanda G", number: "554899" });
    mockGetWa.mockResolvedValue({ id: 2, status: "CONNECTED" });
    mockFindOrCreate.mockResolvedValue({ id: 50, contact: { name: "Amanda G" } });
    mockSend.mockResolvedValue(undefined);

    const result = await enviarMensagemParaCliente(
      { contactId: 8, mensagem: "Tem corte amanhã?" },
      companyId
    );

    expect(mockContactFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8, companyId } })
    );
    expect(mockGetWa).toHaveBeenCalledWith(companyId);
    expect(mockFindOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 8 }), 2, 0, companyId
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/Amanda G.*#50/);
  });

  it("por contactId: erro quando o contato não existe", async () => {
    mockContactFindOne.mockResolvedValue(null);

    const result = await enviarMensagemParaCliente({ contactId: 999, mensagem: "Oi" }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/contato.*não encontrado/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("por contactId: erro claro quando não há canal de WhatsApp conectado", async () => {
    mockContactFindOne.mockResolvedValue({ id: 8, name: "Amanda G" });
    mockGetWa.mockRejectedValue(new Error("ERR_NO_DEF_WAPP_FOUND"));

    const result = await enviarMensagemParaCliente({ contactId: 8, mensagem: "Oi" }, companyId);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/canal de WhatsApp conectado/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("erro quando não informa nem ticketId nem contactId", async () => {
    const result = await enviarMensagemParaCliente({ mensagem: "Oi" } as any, companyId);
    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/ticketId ou contactId/i);
  });

  it("erro quando a mensagem está vazia", async () => {
    const result = await enviarMensagemParaCliente({ contactId: 8, mensagem: "   " }, companyId);
    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/vazia/i);
  });
});
