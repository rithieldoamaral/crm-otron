/**
 * Testes do recebimento de mensagem por canal oficial.
 *
 * DOIS RISCOS COBERTOS AQUI:
 *
 * 1. O AGENTE NÃO RESPONDER (item 1 da auditoria). O handler criava ticket e
 *    mensagem mas nunca enfileirava o job do Agente — a mensagem chegava, o
 *    ticket aparecia na tela, e ninguém respondia. Isso anula o propósito do
 *    canal oficial para quem usa atendimento por IA.
 *
 * 2. ISOLAMENTO MULTI-TENANT (item 3 da auditoria, CLAUDE.md XV.3). O webhook
 *    é rota PÚBLICA. Se o `companyId` viesse do corpo em vez da conexão, um
 *    payload forjado escreveria ticket na empresa de outro cliente. O teste
 *    abaixo prova que a empresa sai SEMPRE da conexão resolvida no servidor.
 *
 * As condições de acionamento do Agente espelham EXATAMENTE as do caminho
 * Baileys (`isAgentChannel`, não ser grupo, ter corpo ou áudio). Divergir
 * faria o Agente se comportar diferente conforme o canal — o oposto do que a
 * camada de adaptador existe para garantir.
 */

import Message from "../../../models/Message";
import CreateOrUpdateContactService from "../../ContactServices/CreateOrUpdateContactService";
import CreateMessageService from "../../MessageServices/CreateMessageService";
import FindOrCreateTicketService from "../../TicketServices/FindOrCreateTicketService";
import { addAgentMessageJob } from "../../WbotServices/BullAgentService";
import { downloadChannelMedia } from "../downloadChannelMedia";
import { handleIncomingChannelMessage } from "../handleIncomingChannelMessage";

jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));
jest.mock("../../ContactServices/CreateOrUpdateContactService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../MessageServices/CreateMessageService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../TicketServices/FindOrCreateTicketService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../WbotServices/BullAgentService", () => ({
  addAgentMessageJob: jest.fn()
}));
jest.mock("../downloadChannelMedia", () => ({
  downloadChannelMedia: jest.fn()
}));
jest.mock("../../AgentService/transcriptionProvider", () => ({
  transcribeAudioForCompany: jest.fn()
}));

const conexao = (over: Record<string, unknown> = {}) =>
  ({
    id: 7,
    companyId: 42,
    channelType: "cloud_api",
    isAgentChannel: false,
    queues: [],
    ...over
  } as any);

const mensagem = (over: Record<string, unknown> = {}) =>
  ({
    channelMessageId: "wamid.ABC",
    from: "554888368758",
    body: "olá",
    timestamp: new Date(),
    raw: {},
    ...over
  } as any);

beforeEach(() => {
  jest.clearAllMocks();
  (Message.findByPk as jest.Mock).mockResolvedValue(null);
  (CreateOrUpdateContactService as jest.Mock).mockResolvedValue({
    id: 99,
    number: "554888368758"
  });
  (FindOrCreateTicketService as jest.Mock).mockResolvedValue({
    id: 1234,
    companyId: 42,
    update: jest.fn()
  });
  (CreateMessageService as jest.Mock).mockResolvedValue({ id: "m1" });
  (downloadChannelMedia as jest.Mock).mockResolvedValue(null);
});

describe("criação de ticket e mensagem", () => {
  it("cria contato, ticket e mensagem a partir da mensagem recebida", async () => {
    await handleIncomingChannelMessage(mensagem(), conexao());

    expect(CreateOrUpdateContactService).toHaveBeenCalled();
    expect(FindOrCreateTicketService).toHaveBeenCalled();
    expect(CreateMessageService).toHaveBeenCalled();
  });

  it("IGNORA reentrega do webhook (idempotência)", async () => {
    // A Meta reenvia quando não recebe 200 rápido. Sem esta guarda, a mesma
    // mensagem apareceria duas vezes e o Agente responderia em dobro.
    (Message.findByPk as jest.Mock).mockResolvedValue({ id: "ja-existe" });

    await handleIncomingChannelMessage(mensagem(), conexao());

    expect(CreateMessageService).not.toHaveBeenCalled();
    expect(addAgentMessageJob).not.toHaveBeenCalled();
  });

  it("ignora mensagem sem id ou sem remetente", async () => {
    await handleIncomingChannelMessage(
      mensagem({ channelMessageId: "" }),
      conexao()
    );
    await handleIncomingChannelMessage(mensagem({ from: "" }), conexao());

    expect(CreateMessageService).not.toHaveBeenCalled();
  });
});

describe("isolamento multi-tenant (XV.3)", () => {
  it("usa o companyId da CONEXÃO, nunca do payload", async () => {
    // O payload é controlado por quem chama a rota pública. Se o companyId
    // saísse dele, um payload forjado escreveria na empresa de outro cliente.
    const payloadMalicioso = mensagem({
      raw: { companyId: 999 },
      companyId: 999
    } as any);

    await handleIncomingChannelMessage(
      payloadMalicioso,
      conexao({ companyId: 42 })
    );

    expect(CreateOrUpdateContactService).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 42 })
    );
    expect(CreateMessageService).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 42 })
    );
  });

  it("cria o ticket na empresa da conexão", async () => {
    await handleIncomingChannelMessage(mensagem(), conexao({ companyId: 42 }));

    // Assinatura: (contact, whatsappId, unread, companyId)
    expect(FindOrCreateTicketService).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.any(Number),
      42
    );
  });
});

describe("acionamento do Agente de IA (item 1)", () => {
  it("ACIONA o Agente quando a conexão é canal do agente", async () => {
    await handleIncomingChannelMessage(
      mensagem({ body: "quero agendar" }),
      conexao({ isAgentChannel: true })
    );

    expect(addAgentMessageJob).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 42,
        ticketId: 1234,
        contactId: 99,
        userMessage: "quero agendar",
        whatsappId: 7
      })
    );
  });

  it("NÃO aciona o Agente quando a conexão não é canal do agente", async () => {
    await handleIncomingChannelMessage(
      mensagem(),
      conexao({ isAgentChannel: false })
    );

    expect(addAgentMessageJob).not.toHaveBeenCalled();
  });

  it("NÃO aciona o Agente quando a mensagem não tem texto nem áudio", async () => {
    // Espelha a condição do Baileys: `(bodyMessage || isAudioMsg)`.
    await handleIncomingChannelMessage(
      mensagem({ body: "" }),
      conexao({ isAgentChannel: true })
    );

    expect(addAgentMessageJob).not.toHaveBeenCalled();
  });

  it("repassa a fila da conexão para o job", async () => {
    await handleIncomingChannelMessage(
      mensagem(),
      conexao({ isAgentChannel: true, queues: [{ id: 5 }] })
    );

    expect(addAgentMessageJob).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 5 })
    );
  });
});

describe("mídia recebida (item 2)", () => {
  it("baixa a mídia e grava o nome do arquivo na mensagem", async () => {
    (downloadChannelMedia as jest.Mock).mockResolvedValue("1700_abc.jpg");

    await handleIncomingChannelMessage(
      mensagem({ mediaUrl: "media-id", mediaType: "image", body: "" }),
      conexao()
    );

    expect(downloadChannelMedia).toHaveBeenCalled();
    expect(CreateMessageService).toHaveBeenCalledWith(
      expect.objectContaining({
        messageData: expect.objectContaining({ mediaUrl: "1700_abc.jpg" })
      })
    );
  });

  it("grava a mensagem MESMO se o download falhar", async () => {
    // Perder o anexo é ruim; perder a mensagem inteira por causa dele é pior.
    (downloadChannelMedia as jest.Mock).mockResolvedValue(null);

    await handleIncomingChannelMessage(
      mensagem({ mediaUrl: "expirado", mediaType: "image" }),
      conexao()
    );

    expect(CreateMessageService).toHaveBeenCalled();
  });

  it("não tenta baixar quando a mensagem é só texto", async () => {
    await handleIncomingChannelMessage(mensagem(), conexao());

    expect(downloadChannelMedia).not.toHaveBeenCalled();
  });
});
