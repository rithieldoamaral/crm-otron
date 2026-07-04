/**
 * Testes TDD para gerarMensagemContextualizada.
 * Pipeline: busca ticket/contato → mensagens recentes → sub-LLM → pendingAction no Redis.
 */

jest.mock("../../../../models/Contact");
jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Message");
jest.mock("../../../AgentService/settingsCache");
jest.mock("../../../AgentService/providers/AIProviderFactory");
jest.mock("../../pendingAction", () => ({
  savePendingAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { gerarMensagemContextualizada } from "../../tools/gerarMensagemContextualizada";
import Contact from "../../../../models/Contact";
import Ticket  from "../../../../models/Ticket";
import Message from "../../../../models/Message";
import { getSettingsByCompany }  from "../../../AgentService/settingsCache";
import { AIProviderFactory }     from "../../../AgentService/providers/AIProviderFactory";
import { savePendingAction }     from "../../pendingAction";

const mockContactFindOne  = Contact.findOne  as jest.Mock;
const mockTicketFindOne   = Ticket.findOne   as jest.Mock;
const mockTicketFindAll   = Ticket.findAll   as jest.Mock; // usado internamente p/ findBestTicket via findOne
const mockMessageFindAll  = Message.findAll  as jest.Mock;
const mockGetSettings     = getSettingsByCompany as jest.Mock;
const mockCreate          = AIProviderFactory.create as jest.Mock;
const mockSavePending     = savePendingAction as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContact(id = 1, name = "Carlos Silva", number = "5511999990001"): any {
  return { id, name, number };
}

function makeTicket(id = 10, status = "open", contactId = 1): any {
  return { id, status, contactId, createdAt: new Date(), updatedAt: new Date(), contact: { id: contactId, name: "Carlos Silva", number: "5511999990001" } };
}

function makeMessage(fromMe: boolean, body: string): any {
  return { fromMe, body, createdAt: new Date() };
}

function makeProvider(draft = "Olá Carlos, passando para informar que seu produto chegou!") {
  return { chat: jest.fn().mockResolvedValue({ content: draft, finishReason: "stop" }) };
}

function setupSettings() {
  mockGetSettings.mockResolvedValue([
    { key: "agentProvider", value: "anthropic" },
    { key: "agentApiKey",   value: "sk-test" },
    { key: "agentModel",    value: "claude-haiku-4-5-20251001" },
  ]);
}

const COMPANY_ID     = 1;
const SENDER_NUMBER  = "5511111110001";
const BASE_ARGS      = { intencao: "informar que o produto chegou", senderNumber: SENDER_NUMBER };

// ── Testes ─────────────────────────────────────────────────────────────────

describe("gerarMensagemContextualizada", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupSettings();
    mockMessageFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());
  });

  // ── Resolução via ticketId ────────────────────────────────────────────────

  it("usa o ticketId diretamente quando fornecido (sem busca de contato)", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(10));

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    // Contact.findOne NÃO deve ser chamado quando ticketId é fornecido
    expect(mockContactFindOne).not.toHaveBeenCalled();
    expect(mockTicketFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 10, companyId: COMPANY_ID }) })
    );
  });

  it("retorna erro quando ticketId não existe", async () => {
    mockTicketFindOne.mockResolvedValue(null);

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 999 }, COMPANY_ID);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/999/);
  });

  // ── Resolução via nome do cliente ────────────────────────────────────────

  it("busca contato por nome quando cliente é fornecido (sem ticketId)", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindOne.mockResolvedValue(makeTicket());

    await gerarMensagemContextualizada({ ...BASE_ARGS, cliente: "Carlos" }, COMPANY_ID);

    expect(mockContactFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY_ID }) })
    );
  });

  it("retorna erro quando cliente não encontrado", async () => {
    mockContactFindOne.mockResolvedValue(null);

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, cliente: "Fantasma" }, COMPANY_ID);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/nenhum cliente encontrado/i);
  });

  it("retorna erro quando cliente não tem tickets", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    // findBestTicket faz dois Ticket.findOne — ambos retornam null
    mockTicketFindOne.mockResolvedValue(null);

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, cliente: "Carlos" }, COMPANY_ID);

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não possui tickets/i);
  });

  it("retorna erro quando nem cliente nem ticketId são fornecidos", async () => {
    const result = await gerarMensagemContextualizada(
      { intencao: "avise", senderNumber: SENDER_NUMBER }, COMPANY_ID
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/informe/i);
  });

  // ── Sub-LLM ───────────────────────────────────────────────────────────────

  it("chama sub-LLM com intenção do admin no prompt", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket());
    const provider = makeProvider();
    mockCreate.mockReturnValue(provider);

    await gerarMensagemContextualizada(
      { ...BASE_ARGS, ticketId: 10, intencao: "produto chegou, pode vir buscar" },
      COMPANY_ID
    );

    const [messages] = provider.chat.mock.calls[0];
    expect(messages[0].content).toMatch(/produto chegou, pode vir buscar/);
  });

  it("inclui histórico de mensagens no prompt do sub-LLM quando disponível", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket());
    mockMessageFindAll.mockResolvedValue([
      makeMessage(false, "Quando chega meu pedido?"),
      makeMessage(true,  "Em breve, estamos verificando."),
    ]);
    const provider = makeProvider();
    mockCreate.mockReturnValue(provider);

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    const [messages] = provider.chat.mock.calls[0];
    expect(messages[0].content).toMatch(/Quando chega meu pedido/);
  });

  it("retorna o rascunho gerado pelo sub-LLM", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket());
    mockCreate.mockReturnValue(makeProvider("Olá Carlos! Seu produto chegou. 🎉"));

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    expect(result.rascunho).toBe("Olá Carlos! Seu produto chegou. 🎉");
    expect(result.sucesso).toBe(true);
  });

  it("usa a intenção como fallback quando sub-LLM falha (não lança exceção)", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket());
    mockCreate.mockReturnValue({ chat: jest.fn().mockRejectedValue(new Error("LLM timeout")) });

    const result = await gerarMensagemContextualizada(
      { ...BASE_ARGS, ticketId: 10, intencao: "produto chegou" },
      COMPANY_ID
    );

    expect(result.sucesso).toBe(true);
    expect(result.rascunho).toBe("produto chegou");
  });

  // ── pendingAction ────────────────────────────────────────────────────────

  it("salva pendingAction no Redis após gerar rascunho", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(10));
    mockCreate.mockReturnValue(makeProvider("Mensagem rascunhada."));

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    expect(mockSavePending).toHaveBeenCalledWith(
      COMPANY_ID,
      SENDER_NUMBER,
      expect.objectContaining({
        type: "enviar_mensagem",
        ticketId: 10,
        body: "Mensagem rascunhada.",
      })
    );
  });

  it("pendingAction inclui contactName", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(10));
    mockCreate.mockReturnValue(makeProvider("Oi!"));

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    expect(mockSavePending).toHaveBeenCalledWith(
      COMPANY_ID,
      SENDER_NUMBER,
      expect.objectContaining({ contactName: "Carlos Silva" })
    );
  });

  it("retorna instrucao com o rascunho para o secretaryLoop apresentar", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(10));
    mockCreate.mockReturnValue(makeProvider("Texto do rascunho."));

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, COMPANY_ID);

    expect(result.instrucao).toBeTruthy();
    expect(result.instrucao).toMatch(/rascunho|confirma|sim|não/i);
  });

  it("retorna ticketId no resultado", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(42));
    mockCreate.mockReturnValue(makeProvider());

    const result = await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 42 }, COMPANY_ID);

    expect(result.ticketId).toBe(42);
  });

  // ── Multi-tenant ────────────────────────────────────────────────────────

  it("usa companyId correto na busca de ticket", async () => {
    mockTicketFindOne.mockResolvedValue(null);

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, 55);

    expect(mockTicketFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 55 }) })
    );
  });

  it("aplica companyId em Message.findAll (defense-in-depth)", async () => {
    mockTicketFindOne.mockResolvedValue(makeTicket(10));
    mockMessageFindAll.mockResolvedValue([makeMessage(false, "Oi")]);
    mockCreate.mockReturnValue(makeProvider());

    await gerarMensagemContextualizada({ ...BASE_ARGS, ticketId: 10 }, 33);

    const allMessageCalls = mockMessageFindAll.mock.calls;
    expect(allMessageCalls.length).toBeGreaterThan(0);
    for (const [callArgs] of allMessageCalls) {
      expect(callArgs.where).toEqual(expect.objectContaining({ companyId: 33 }));
    }
  });
});
