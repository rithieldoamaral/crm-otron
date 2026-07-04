/**
 * Testes TDD para detectarConversasCriticas.
 *
 * Detecta os N tickets mais críticos com base em 4 sinais determinísticos:
 *   - ALTO (+3): keyword de risco na última mensagem (cancelar, Procon, advogado, etc.)
 *   - ALTO (+3): 3+ mensagens consecutivas do cliente sem resposta do agente
 *   - ALTO (+3): agendamento vinculado ao contato nas próximas 2h
 *   - MÉDIO (+2): sem atividade no ticket há mais de X horas (configurável)
 *
 * Nenhuma chamada LLM nesta tool — matching via regex/contagem, rápido e determinístico.
 * CLAUDE.md II.5: "keyword matching simples — não chamar LLM para isso."
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Message");
jest.mock("../../../../models/Schedule");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { detectarConversasCriticas } from "../../tools/detectarConversasCriticas";
import Ticket from "../../../../models/Ticket";
import Message from "../../../../models/Message";
import Schedule from "../../../../models/Schedule";

const mockTicketFindAll = Ticket.findAll as jest.Mock;
const mockMessageFindAll = Message.findAll as jest.Mock;
const mockScheduleFindAll = Schedule.findAll as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 100,
    status: "open",
    lastMessage: "Olá, gostaria de ajuda",   // sem keyword de risco
    updatedAt: new Date(),                    // ativo agora — sem inatividade
    contactId: 1,
    contact: { name: "Cliente Teste", number: "5511999990001" },
    ...overrides
  };
}

function makeMessages(fromMePattern: boolean[]): any[] {
  // fromMePattern: [mais recente, ..., mais antigo]
  return fromMePattern.map(fromMe => ({ fromMe }));
}

// ── Testes ─────────────────────────────────────────────────────────────────

describe("detectarConversasCriticas", () => {
  const companyId = 1;
  const defaultArgs = { limiteResultados: 5, horasInatividadeAlerta: 4 };

  beforeEach(() => jest.clearAllMocks());

  // ── Sem tickets ──────────────────────────────────────────────────────────

  it("retorna lista vazia e total 0 quando não há tickets ativos", async () => {
    mockTicketFindAll.mockResolvedValue([]);
    mockScheduleFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(0);
    expect(result.total).toBe(0);
    // Não deve tentar buscar mensagens se não há tickets
    expect(mockMessageFindAll).not.toHaveBeenCalled();
  });

  // ── Sinal ALTO: keyword de risco ─────────────────────────────────────────

  it("detecta keyword 'cancelar' no lastMessage — prioridade alta", async () => {
    const ticket = makeTicket({ id: 42, lastMessage: "Quero cancelar meu contrato" });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("alta");
    expect(result.conversas[0].motivos.some(m => /palavra-chave|cancelar|risco/i.test(m))).toBe(true);
  });

  it("detecta keyword 'Procon' (case insensitive) — prioridade alta", async () => {
    const ticket = makeTicket({ id: 42, lastMessage: "vou LEVAR no PROCON mesmo" });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("alta");
  });

  it("detecta keyword 'advogado' — prioridade alta", async () => {
    const ticket = makeTicket({ id: 42, lastMessage: "vou acionar meu advogado" });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("alta");
  });

  it.each(["absurdo", "inadmissível", "inadmissivel", "reclamação", "reclamacao", "processo"])(
    "detecta keyword '%s' como sinal de risco",
    async (keyword) => {
      const ticket = makeTicket({ id: 42, lastMessage: `isso é ${keyword} total` });
      mockTicketFindAll.mockResolvedValue([ticket]);
      mockScheduleFindAll.mockResolvedValue([]);
      mockMessageFindAll.mockResolvedValue([]);

      const result = await detectarConversasCriticas(defaultArgs, companyId);

      expect(result.conversas).toHaveLength(1);
    }
  );

  // ── Sinal ALTO: mensagens sem resposta ───────────────────────────────────

  it("detecta 3+ mensagens consecutivas do cliente sem resposta — prioridade alta", async () => {
    const ticket = makeTicket({ id: 55 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    // 4 mensagens do cliente (fromMe:false), sem resposta do agente
    mockMessageFindAll.mockImplementation(async ({ where }: any) => {
      if (where.ticketId === 55) return makeMessages([false, false, false, false]);
      return [];
    });

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("alta");
    expect(result.conversas[0].motivos.some(m => /mensagens sem resposta|sem resposta/i.test(m))).toBe(true);
  });

  it("NÃO sinaliza quando agente respondeu entre as mensagens do cliente", async () => {
    // Padrão: [cliente, agente, cliente, cliente] — agente respondeu, não são 3 consecutivas
    const ticket = makeTicket({ id: 55 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockImplementation(async ({ where }: any) => {
      if (where.ticketId === 55)
        return makeMessages([false, false, true, false]); // mais recente → mais antigo
      return [];
    });

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    // Sem outros sinais → ticket não deve aparecer
    expect(result.conversas).toHaveLength(0);
  });

  it("não sinaliza 'sem resposta' quando há apenas 2 mensagens consecutivas do cliente", async () => {
    const ticket = makeTicket({ id: 55 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockImplementation(async ({ where }: any) => {
      if (where.ticketId === 55) return makeMessages([false, false]);
      return [];
    });

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(0);
  });

  // ── Sinal ALTO: agendamento próximo ─────────────────────────────────────

  it("detecta agendamento vinculado ao contato nas próximas 2h — prioridade alta", async () => {
    const ticket = makeTicket({ id: 77, contactId: 5 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    // Schedule retorna agendamento com o mesmo contactId do ticket
    mockScheduleFindAll.mockResolvedValue([{ contactId: 5 }]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("alta");
    expect(result.conversas[0].motivos.some(m => /agendamento|próximas/i.test(m))).toBe(true);
  });

  it("NÃO sinaliza agendamento quando o contactId do schedule não coincide com nenhum ticket", async () => {
    const ticket = makeTicket({ id: 77, contactId: 5 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    // Schedule de outro contato
    mockScheduleFindAll.mockResolvedValue([{ contactId: 99 }]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    // Sem outros sinais → ticket não retornado
    expect(result.conversas).toHaveLength(0);
  });

  // ── Sinal MÉDIO: inatividade ─────────────────────────────────────────────

  it("detecta inatividade acima do limiar configurado — prioridade media", async () => {
    const cincoHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const ticket = makeTicket({ id: 88, updatedAt: cincoHorasAtras });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    // limiar de 4h → ticket com 5h de inatividade deve ser sinalizado
    const result = await detectarConversasCriticas(
      { ...defaultArgs, horasInatividadeAlerta: 4 },
      companyId
    );

    expect(result.conversas).toHaveLength(1);
    expect(result.conversas[0].prioridade).toBe("media");
    expect(result.conversas[0].motivos.some(m => /atividade|inativo|horas/i.test(m))).toBe(true);
  });

  it("NÃO sinaliza inatividade abaixo do limiar configurado", async () => {
    const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const ticket = makeTicket({ id: 88, updatedAt: duasHorasAtras });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    // limiar de 4h → ticket com 2h de inatividade NÃO deve ser sinalizado
    const result = await detectarConversasCriticas(
      { ...defaultArgs, horasInatividadeAlerta: 4 },
      companyId
    );

    expect(result.conversas).toHaveLength(0);
  });

  // ── Scoring e ordenação ──────────────────────────────────────────────────

  it("ordena por score decrescente — ticket com mais sinais vem primeiro", async () => {
    // Ticket A: keyword + 4 msgs sem resposta (score 6 — dois sinais Alto)
    const ticketA = makeTicket({ id: 10, lastMessage: "quero cancelar tudo" });
    // Ticket B: apenas inatividade (score 2 — um sinal Médio)
    const cincoHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const ticketB = makeTicket({ id: 20, updatedAt: cincoHorasAtras });

    mockTicketFindAll.mockResolvedValue([ticketA, ticketB]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockImplementation(async ({ where }: any) => {
      if (where.ticketId === 10) return makeMessages([false, false, false, false]);
      return [];
    });

    const result = await detectarConversasCriticas(
      { ...defaultArgs, horasInatividadeAlerta: 4 },
      companyId
    );

    expect(result.conversas[0].ticketId).toBe(10);  // score mais alto primeiro
    expect(result.conversas[0].score).toBeGreaterThan(result.conversas[1].score);
  });

  it("ticket com apenas sinal Médio tem prioridade 'media' e não 'alta'", async () => {
    const cincoHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const ticket = makeTicket({ id: 88, updatedAt: cincoHorasAtras });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(
      { ...defaultArgs, horasInatividadeAlerta: 4 },
      companyId
    );

    expect(result.conversas[0].prioridade).toBe("media");
  });

  it("ticket sem nenhum sinal NÃO é incluído no resultado", async () => {
    const ticket = makeTicket({
      id: 99,
      lastMessage: "Ok, obrigado!",         // sem keyword
      updatedAt: new Date()                  // ativo agora
    });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    // Última msg do agente (fromMe:true) — sem consecutivas do cliente
    mockMessageFindAll.mockImplementation(async () => makeMessages([true, false, true]));

    const result = await detectarConversasCriticas(defaultArgs, companyId);

    expect(result.conversas).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("respeita limiteResultados e retorna no máximo N conversas", async () => {
    // 6 tickets com inatividade (todos com sinal)
    const cincoHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const tickets = Array.from({ length: 6 }, (_, i) =>
      makeTicket({ id: i + 1, updatedAt: cincoHorasAtras })
    );
    mockTicketFindAll.mockResolvedValue(tickets);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(
      { limiteResultados: 3, horasInatividadeAlerta: 4 },
      companyId
    );

    expect(result.conversas).toHaveLength(3);
  });

  it("total reflete o número real de tickets críticos mesmo quando resultado é truncado por limite", async () => {
    const cincoHorasAtras = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const tickets = Array.from({ length: 6 }, (_, i) =>
      makeTicket({ id: i + 1, updatedAt: cincoHorasAtras })
    );
    mockTicketFindAll.mockResolvedValue(tickets);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(
      { limiteResultados: 3, horasInatividadeAlerta: 4 },
      companyId
    );

    // limite=3 → conversas tem 3, mas total deve refletir os 6 críticos reais
    expect(result.total).toBe(6);
  });

  it("usa companyId correto na query de tickets", async () => {
    mockTicketFindAll.mockResolvedValue([]);
    mockScheduleFindAll.mockResolvedValue([]);

    await detectarConversasCriticas(defaultArgs, 42);

    expect(mockTicketFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 42 }) })
    );
  });

  it("aplica companyId em Message.findAll (defense-in-depth)", async () => {
    const ticket = makeTicket({ id: 100, contactId: 5 });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    await detectarConversasCriticas(defaultArgs, 99);

    const allMessageCalls = mockMessageFindAll.mock.calls;
    expect(allMessageCalls.length).toBeGreaterThan(0);
    for (const [callArgs] of allMessageCalls) {
      expect(callArgs.where).toEqual(expect.objectContaining({ companyId: 99 }));
    }
  });

  it("resultado inclui ticketId, cliente, telefone, prioridade, motivos e score", async () => {
    const ticket = makeTicket({ id: 42, lastMessage: "quero cancelar" });
    mockTicketFindAll.mockResolvedValue([ticket]);
    mockScheduleFindAll.mockResolvedValue([]);
    mockMessageFindAll.mockResolvedValue([]);

    const result = await detectarConversasCriticas(defaultArgs, companyId);
    const item = result.conversas[0];

    expect(item.ticketId).toBe(42);
    expect(typeof item.cliente).toBe("string");
    expect(typeof item.telefone).toBe("string");
    expect(["alta", "media"]).toContain(item.prioridade);
    expect(Array.isArray(item.motivos)).toBe(true);
    expect(item.motivos.length).toBeGreaterThan(0);
    expect(typeof item.score).toBe("number");
    expect(item.score).toBeGreaterThan(0);
  });
});
