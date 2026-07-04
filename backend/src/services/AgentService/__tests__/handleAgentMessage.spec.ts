/**
 * Testes TDD para handleAgentMessage.
 * Cobre: fluxo normal, fallback de erro, atualização de status do ticket.
 */

jest.mock("../index");
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({
    to: jest.fn().mockReturnValue({ emit: jest.fn() })
  })
}));
jest.mock("../../../libs/wbot", () => ({}));
jest.mock("../../../models/Ticket");
jest.mock("../../TicketServices/ShowTicketService", () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ id: 42, status: "open", chatbot: true })
}));

import { handleAgentMessage, AgentMessageContext } from "../handleAgentMessage";
import { handleClientAgent } from "../index";

const mockHandleClientAgent = handleClientAgent as jest.Mock;

function makeTicket(overrides = {}) {
  return {
    id: 42,
    status: "pending",
    chatbot: false,
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const baseSendFn = jest.fn().mockResolvedValue(undefined);

const baseCtx = (ticket: any): AgentMessageContext => ({
  companyId: 1,
  ticket,
  contactId: 10,
  contactNumber: "5511999990000",
  userMessage: "Olá, quero um corte",
  whatsappId: 2
});

beforeEach(() => jest.clearAllMocks());

describe("handleAgentMessage — fluxo normal", () => {
  it("atualiza ticket para open+chatbot antes de chamar o agente", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockResolvedValue({ reply: "Oi! Para quando quer agendar?" });

    await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(ticket.update).toHaveBeenCalledWith({ status: "open", chatbot: true, queueId: undefined });
  });

  it("inclui queueId no update quando fornecido no contexto", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockResolvedValue({ reply: "Olá!" });
    const ctx = { ...baseCtx(ticket), queueId: 7 };

    await handleAgentMessage(ctx, baseSendFn);

    expect(ticket.update).toHaveBeenCalledWith({ status: "open", chatbot: true, queueId: 7 });
  });

  it("chama sendFn com a resposta do agente", async () => {
    const ticket = makeTicket();
    const reply = "Temos horário amanhã às 10h!";
    mockHandleClientAgent.mockResolvedValue({ reply });

    await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(baseSendFn).toHaveBeenCalledWith("5511999990000", reply);
  });

  it("retorna handled:true e a reply quando sucesso", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockResolvedValue({ reply: "Agendado!" });

    const result = await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(result.handled).toBe(true);
    expect(result.reply).toBe("Agendado!");
    expect(result.error).toBeUndefined();
  });
});

describe("handleAgentMessage — fallback de erro", () => {
  it("reverte ticket para pending+chatbot:false quando agente lança erro", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockRejectedValue(new Error("Anthropic timeout"));

    await handleAgentMessage(baseCtx(ticket), baseSendFn);

    // Primeira chamada: open + chatbot
    expect(ticket.update).toHaveBeenNthCalledWith(1, { status: "open", chatbot: true });
    // Segunda chamada: revert para pending
    expect(ticket.update).toHaveBeenNthCalledWith(2, { status: "pending", chatbot: false });
  });

  it("não chama sendFn quando agente falha", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockRejectedValue(new Error("API down"));

    await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(baseSendFn).not.toHaveBeenCalled();
  });

  it("retorna handled:true com error quando agente falha", async () => {
    const ticket = makeTicket();
    mockHandleClientAgent.mockRejectedValue(new Error("Rate limit"));

    const result = await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(result.handled).toBe(true);
    expect(result.error).toMatch(/Rate limit/);
  });

  it("retorna handled:true mesmo se o revert do ticket também falhar", async () => {
    const ticket = makeTicket();
    ticket.update
      .mockResolvedValueOnce(undefined) // primeira chamada (open) ok
      .mockRejectedValueOnce(new Error("DB error")); // segunda (revert) falha
    mockHandleClientAgent.mockRejectedValue(new Error("API error"));

    const result = await handleAgentMessage(baseCtx(ticket), baseSendFn);

    expect(result.handled).toBe(true);
  });
});
