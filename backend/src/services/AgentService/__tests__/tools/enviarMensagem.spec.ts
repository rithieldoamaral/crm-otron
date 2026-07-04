/**
 * Testes TDD para a tool enviarMensagem.
 */

jest.mock("../../../../models/Contact");
jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Whatsapp");
jest.mock("../../../TicketServices/FindOrCreateTicketService");
jest.mock("../../../WbotServices/SendWhatsAppMessage");
// Impede carregamento do Baileys (não disponível em ambiente Jest)
jest.mock("../../../../libs/wbot", () => ({}));
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { enviarMensagem } from "../../tools/enviarMensagem";
import Contact from "../../../../models/Contact";
import FindOrCreateTicketService from "../../../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../../../WbotServices/SendWhatsAppMessage";

const mockFindOrCreate = FindOrCreateTicketService as jest.Mock;
const mockSend = SendWhatsAppMessage as jest.Mock;

describe("enviarMensagem", () => {
  const companyId = 1;
  const whatsappId = 5;

  beforeEach(() => jest.clearAllMocks());

  it("envia mensagem e retorna confirmação com nome do contato", async () => {
    (Contact.findOne as jest.Mock).mockResolvedValue({
      id: 10,
      name: "Maria Silva",
      number: "5511999991111"
    });
    mockFindOrCreate.mockResolvedValue({ id: 99, status: "open" });
    mockSend.mockResolvedValue(undefined);

    const result = await enviarMensagem(
      { contactId: 10, mensagem: "Seu pedido está pronto!" },
      companyId,
      whatsappId
    );

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/Maria Silva/);
  });

  it("retorna erro quando contato não é encontrado", async () => {
    (Contact.findOne as jest.Mock).mockResolvedValue(null);

    const result = await enviarMensagem(
      { contactId: 999, mensagem: "teste" },
      companyId,
      whatsappId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("retorna erro quando o envio falha", async () => {
    (Contact.findOne as jest.Mock).mockResolvedValue({
      id: 10, name: "João", number: "5511988887777"
    });
    mockFindOrCreate.mockResolvedValue({ id: 100, status: "open" });
    mockSend.mockRejectedValue(new Error("WhatsApp offline"));

    const result = await enviarMensagem(
      { contactId: 10, mensagem: "teste" },
      companyId,
      whatsappId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toBeDefined();
  });
});
