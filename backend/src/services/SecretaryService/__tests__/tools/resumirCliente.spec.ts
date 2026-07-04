/**
 * Testes TDD para resumirCliente.
 * Pipeline sub-LLM: busca contato → tickets recentes → mensagens → resumo em bullets.
 *
 * A tool faz UMA chamada sub-LLM (provider.chat) sem tools, para gerar
 * um resumo de atendimento do cliente. Testamos o pipeline ponta a ponta
 * mockando todos os modelos e o provider.
 */

jest.mock("../../../../models/Contact");
jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Message");
jest.mock("../../../AgentService/settingsCache");
jest.mock("../../../AgentService/providers/AIProviderFactory");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { resumirCliente } from "../../tools/resumirCliente";
import Contact from "../../../../models/Contact";
import Ticket from "../../../../models/Ticket";
import Message from "../../../../models/Message";
import { getSettingsByCompany } from "../../../AgentService/settingsCache";
import { AIProviderFactory } from "../../../AgentService/providers/AIProviderFactory";

const mockContactFindOne = Contact.findOne  as jest.Mock;
const mockTicketFindAll  = Ticket.findAll   as jest.Mock;
const mockMessageFindAll = Message.findAll  as jest.Mock;
const mockGetSettings    = getSettingsByCompany as jest.Mock;
const mockCreate         = AIProviderFactory.create as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContact(id = 1, name = "Ana Lima", number = "5511999990001"): any {
  return { id, name, number };
}

function makeTicket(id: number, status = "closed"): any {
  return { id, status, contactId: 1, createdAt: new Date(), updatedAt: new Date() };
}

function makeMessage(id: number, fromMe: boolean, body: string): any {
  return { id, fromMe, body, createdAt: new Date() };
}

function makeProvider(summaryText = "• Cliente satisfeito\n• Sem pendências") {
  return { chat: jest.fn().mockResolvedValue({ content: summaryText, finishReason: "stop" }) };
}

function setupSettings() {
  mockGetSettings.mockResolvedValue([
    { key: "agentProvider", value: "anthropic" },
    { key: "agentApiKey",   value: "sk-test" },
    { key: "agentModel",    value: "claude-haiku-4-5-20251001" },
  ]);
}

// ── Testes ─────────────────────────────────────────────────────────────────

describe("resumirCliente", () => {
  const companyId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
    setupSettings();
  });

  // ── Busca do contato ────────────────────────────────────────────────────

  it("retorna clienteEncontrado:false quando contato não existe", async () => {
    mockContactFindOne.mockResolvedValue(null);

    const result = await resumirCliente({ cliente: "fantasma" }, companyId);

    expect(result.clienteEncontrado).toBe(false);
    expect(result.erro).toMatch(/nenhum cliente encontrado/i);
    expect(mockTicketFindAll).not.toHaveBeenCalled();
  });

  it("busca contato por nome parcial (iLike)", async () => {
    mockContactFindOne.mockResolvedValue(null);

    await resumirCliente({ cliente: "ana" }, companyId);

    expect(mockContactFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId })
      })
    );
  });

  it("retorna clienteNome e clienteTelefone quando contato encontrado", async () => {
    mockContactFindOne.mockResolvedValue(makeContact(1, "Ana Lima", "5511111110001"));
    mockTicketFindAll.mockResolvedValue([makeTicket(10)]);
    mockMessageFindAll.mockResolvedValue([makeMessage(1, false, "Oi"), makeMessage(2, true, "Olá!")]);
    const provider = makeProvider();
    mockCreate.mockReturnValue(provider);

    const result = await resumirCliente({ cliente: "ana" }, companyId);

    expect(result.clienteNome).toBe("Ana Lima");
    expect(result.clienteTelefone).toBe("5511111110001");
  });

  // ── Caso sem tickets ────────────────────────────────────────────────────

  it("retorna resumo simplificado sem chamar sub-LLM quando cliente não tem tickets", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([]);
    const provider = makeProvider();
    mockCreate.mockReturnValue(provider);

    const result = await resumirCliente({ cliente: "Ana" }, companyId);

    expect(result.clienteEncontrado).toBe(true);
    expect(result.totalTickets).toBe(0);
    expect(result.resumo).toBeTruthy();
    // Sub-LLM não precisa ser chamado (sem histórico para resumir)
    expect(provider.chat).not.toHaveBeenCalled();
  });

  // ── Pipeline principal ──────────────────────────────────────────────────

  it("chama sub-LLM com prompt contendo nome do cliente e conteúdo dos tickets", async () => {
    mockContactFindOne.mockResolvedValue(makeContact(1, "Carlos Souza", "5511222220002"));
    mockTicketFindAll.mockResolvedValue([makeTicket(5)]);
    mockMessageFindAll.mockResolvedValue([
      makeMessage(1, false, "Quero cancelar"),
      makeMessage(2, true,  "Entendido, cancelamos."),
    ]);
    const provider = makeProvider("• Solicitou cancelamento\n• Resolvido");
    mockCreate.mockReturnValue(provider);

    await resumirCliente({ cliente: "Carlos" }, companyId);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    const [messages, systemPrompt] = provider.chat.mock.calls[0];
    // System prompt deve falar de "resumo" / "bullets"
    expect(systemPrompt).toMatch(/resum/i);
    // User prompt deve ter o nome do cliente
    expect(messages[0].content).toMatch(/Carlos Souza/);
    // User prompt deve ter conteúdo das mensagens
    expect(messages[0].content).toMatch(/Quero cancelar/);
  });

  it("retorna o resumo gerado pelo sub-LLM", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([makeMessage(1, false, "Olá")]);
    const provider = makeProvider("• Última interação ontem\n• Sem pendências");
    mockCreate.mockReturnValue(provider);

    const result = await resumirCliente({ cliente: "Ana" }, companyId);

    expect(result.resumo).toBe("• Última interação ontem\n• Sem pendências");
  });

  it("inclui totalTickets no resultado", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    const tickets = [makeTicket(1), makeTicket(2)];
    mockTicketFindAll.mockResolvedValue(tickets);
    mockMessageFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());

    const result = await resumirCliente({ cliente: "Ana" }, companyId);

    expect(result.totalTickets).toBe(2);
  });

  // ── maxTickets ──────────────────────────────────────────────────────────

  it("busca até maxTickets tickets (default 3)", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());

    await resumirCliente({ cliente: "Ana" }, companyId);

    expect(mockTicketFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 })
    );
  });

  it("respeita maxTickets customizado", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());

    await resumirCliente({ cliente: "Ana", maxTickets: 5 }, companyId);

    expect(mockTicketFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });

  it("limita maxTickets ao máximo de 5 (evita abuso)", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());

    await resumirCliente({ cliente: "Ana", maxTickets: 100 }, companyId);

    expect(mockTicketFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });

  // ── Erros ───────────────────────────────────────────────────────────────

  it("retorna erro quando sub-LLM falha (não lança exceção)", async () => {
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([makeMessage(1, false, "msg")]);
    const provider = { chat: jest.fn().mockRejectedValue(new Error("LLM timeout")) };
    mockCreate.mockReturnValue(provider);

    const result = await resumirCliente({ cliente: "Ana" }, companyId);

    expect(result.clienteEncontrado).toBe(true);
    expect(result.erro).toMatch(/LLM timeout/);
    expect(result.resumo).toBeUndefined();
  });

  // ── Multi-tenant ────────────────────────────────────────────────────────

  it("usa companyId correto na busca de contato (multi-tenant)", async () => {
    mockContactFindOne.mockResolvedValue(null);

    await resumirCliente({ cliente: "Ana" }, 99);

    expect(mockContactFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 99 }) })
    );
  });

  it("usa companyId correto na busca de tickets", async () => {
    mockContactFindOne.mockResolvedValue(makeContact(7));
    mockTicketFindAll.mockResolvedValue([]);
    mockCreate.mockReturnValue(makeProvider());

    await resumirCliente({ cliente: "Ana" }, 77);

    expect(mockTicketFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 77 }) })
    );
  });

  it("aplica companyId em Message.findAll (defense-in-depth)", async () => {
    mockContactFindOne.mockResolvedValue(makeContact(7));
    mockTicketFindAll.mockResolvedValue([makeTicket(10)]);
    mockMessageFindAll.mockResolvedValue([makeMessage(1, false, "msg")]);
    mockCreate.mockReturnValue(makeProvider());

    await resumirCliente({ cliente: "Ana" }, 66);

    const allMessageCalls = mockMessageFindAll.mock.calls;
    expect(allMessageCalls.length).toBeGreaterThan(0);
    for (const [callArgs] of allMessageCalls) {
      expect(callArgs.where).toEqual(expect.objectContaining({ companyId: 66 }));
    }
  });

  // ── Provider config ────────────────────────────────────────────────────

  it("usa configurações do provider salvas para a empresa", async () => {
    mockGetSettings.mockResolvedValue([
      { key: "agentProvider", value: "groq" },
      { key: "agentApiKey",   value: "gsk-xyz" },
      { key: "agentModel",    value: "llama-3.3-70b-versatile" },
    ]);
    mockContactFindOne.mockResolvedValue(makeContact());
    mockTicketFindAll.mockResolvedValue([makeTicket(1)]);
    mockMessageFindAll.mockResolvedValue([makeMessage(1, false, "ok")]);
    const provider = makeProvider();
    mockCreate.mockReturnValue(provider);

    await resumirCliente({ cliente: "Ana" }, companyId);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "groq", apiKey: "gsk-xyz" })
    );
  });
});
