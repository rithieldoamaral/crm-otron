/**
 * Testes TDD para agentUtils — funções puras utilitárias do AgentService.
 * Sem I/O, sem Sequelize, sem Redis. Apenas lógica determinística testável.
 *
 * Bug #33 (2026-05-24): agente esquecia o serviço mais recente e voltava
 * para o anterior. extractLastDiscussedService resolve isso deterministicamente.
 *
 * Bug #35 (2026-05-25): LLM calculava data errada para dia da semana pedido
 * pelo cliente ("terça" → 30/05 sábado em vez de 26/05 terça).
 * buildWeekCalendar fornece tabela explícita dia→data para o system prompt.
 */

import {
  extractLastDiscussedService,
  buildWeekCalendar,
  extractTimeFromMessage,
  extractLastDiscussedDate,
  extractDateFromMessage
} from "../agentUtils";
import { AIMessage } from "../providers/interfaces";

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function makeToolMsg(content: string): AIMessage {
  return { role: "tool", content, toolCallId: "call_1", name: "alguma_tool" };
}

function makeUserMsg(content: string): AIMessage {
  return { role: "user", content };
}

function makeAssistantMsg(content: string): AIMessage {
  return { role: "assistant", content };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("extractLastDiscussedService", () => {
  describe("casos sem serviço no histórico", () => {
    it("retorna null para histórico vazio", () => {
      expect(extractLastDiscussedService([])).toBeNull();
    });

    it("retorna null quando não há mensagens role=tool", () => {
      const history: AIMessage[] = [
        makeUserMsg("Quero agendar"),
        makeAssistantMsg("Claro! Qual serviço você prefere?")
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });

    it("retorna null quando tool results não têm campo servico", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ ok: true, ticketId: 42 })),
        makeToolMsg(JSON.stringify({ contatos: [] }))
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });

    it("retorna null quando servico é string vazia", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ servico: "", disponivel: true }))
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });

    it("ignora conteúdo não-JSON sem lançar erro", () => {
      const history: AIMessage[] = [
        makeToolMsg("conteúdo não é JSON"),
        makeToolMsg("outro texto livre")
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });
  });

  describe("extração de resultado de verificar_disponibilidade", () => {
    it("retorna nome do serviço do resultado da tool", () => {
      const result = {
        disponivel: true,
        data: "2026-05-24",
        servico: "Corte de Cabelo",
        durationMinutes: 60,
        profissionais: []
      };
      const history: AIMessage[] = [makeToolMsg(JSON.stringify(result))];
      expect(extractLastDiscussedService(history)).toBe("Corte de Cabelo");
    });

    it("retorna serviço mesmo quando disponivel=false (busca falhou mas serviço foi tentado)", () => {
      const result = { disponivel: false, servico: "Esmalte nas Unhas", profissionais: [] };
      const history: AIMessage[] = [makeToolMsg(JSON.stringify(result))];
      expect(extractLastDiscussedService(history)).toBe("Esmalte nas Unhas");
    });
  });

  describe("extração de resultado de buscar_proximo_horario", () => {
    it("retorna nome do serviço do resultado da tool", () => {
      const result = {
        encontrado: true,
        data: "2026-05-24",
        hora: "10:00",
        profissional: "Sofia",
        servico: "Depilação a laser",
        mensagem: "Próximo horário disponível: 2026-05-24 às 10:00 com Sofia."
      };
      const history: AIMessage[] = [makeToolMsg(JSON.stringify(result))];
      expect(extractLastDiscussedService(history)).toBe("Depilação a laser");
    });

    it("retorna serviço mesmo quando encontrado=false", () => {
      const result = {
        encontrado: false,
        servico: "Depilação a laser",
        mensagem: "Nenhum horário disponível nos próximos 7 dias."
      };
      const history: AIMessage[] = [makeToolMsg(JSON.stringify(result))];
      expect(extractLastDiscussedService(history)).toBe("Depilação a laser");
    });
  });

  describe("seleção do serviço MAIS RECENTE (Bug #33 — cenário real)", () => {
    it("retorna o ÚLTIMO serviço quando múltiplos tool results existem", () => {
      // Cenário: cliente falou de unhas primeiro, depois mudou para depilação
      const history: AIMessage[] = [
        makeUserMsg("Quero pintar as unhas"),
        makeToolMsg(JSON.stringify({ servico: "Esmalte nas Unhas", disponivel: false })),
        makeAssistantMsg("Infelizmente não temos horário para unhas nos próximos 7 dias."),
        makeUserMsg("Como funciona a depilação?"),
        makeAssistantMsg("A depilação a laser remove os pelos de forma eficaz..."),
        makeUserMsg("Quero agendar"),
        // Próximo passo: LLM chamaria buscar_proximo_horario com Depilação
        makeToolMsg(JSON.stringify({ servico: "Depilação a laser", encontrado: true, hora: "10:00" }))
      ];
      // Deve retornar o ÚLTIMO — Depilação, não Esmalte
      expect(extractLastDiscussedService(history)).toBe("Depilação a laser");
    });

    it("retorna o último mesmo quando apenas o primeiro tinha campo servico", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ servico: "Manicure" })),       // tem servico
        makeToolMsg(JSON.stringify({ ok: true })),                    // não tem servico
        makeToolMsg(JSON.stringify({ servico: "Pedicure" }))         // tem servico — mais recente
      ];
      expect(extractLastDiscussedService(history)).toBe("Pedicure");
    });

    it("ignora tool results sem servico e continua procurando ao contrário", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ servico: "Corte de Cabelo" })), // mais antigo
        makeToolMsg(JSON.stringify({ contatos: [] })),               // sem servico
        makeToolMsg("string não-JSON")                               // não-JSON
      ];
      // Os dois últimos não têm servico — deve retornar o primeiro (mais recente com servico)
      expect(extractLastDiscussedService(history)).toBe("Corte de Cabelo");
    });

    it("ignora mensagens user/assistant e foca só em tool results", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ servico: "Manicure" })),
        makeAssistantMsg("Discutindo sobre Depilação..."), // texto de assistente — não conta
        makeUserMsg("E a depilação?")                     // mensagem de usuário — não conta
      ];
      // Apenas o tool result conta
      expect(extractLastDiscussedService(history)).toBe("Manicure");
    });
  });

  describe("robustez com tipos inesperados", () => {
    it("ignora quando servico não é string", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify({ servico: 123 })),         // número
        makeToolMsg(JSON.stringify({ servico: null })),         // null
        makeToolMsg(JSON.stringify({ servico: { name: "x" } })) // objeto
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });

    it("ignora quando parsed é array (não objeto)", () => {
      const history: AIMessage[] = [
        makeToolMsg(JSON.stringify([{ servico: "Manicure" }]))
      ];
      expect(extractLastDiscussedService(history)).toBeNull();
    });
  });
});

// ─── buildWeekCalendar ────────────────────────────────────────────────────────

describe("buildWeekCalendar", () => {
  it("retorna exatamente 7 dias a partir da data fornecida", () => {
    const now = new Date("2026-05-25T12:00:00-03:00");
    const entries = buildWeekCalendar(now);
    expect(entries).toHaveLength(7);
  });

  it("mapeia segunda a domingo corretamente — Bug #35 (terça = 26/05, não 30/05)", () => {
    // Cenário real: hoje = segunda 25/05. O LLM computou "terça" como 30/05 (sábado!).
    // A tabela correta: terça = 26/05, sábado = 30/05.
    const now = new Date("2026-05-25T12:00:00-03:00");
    const entries = buildWeekCalendar(now);

    expect(entries[0].dayName).toBe("segunda-feira");
    expect(entries[0].iso).toBe("2026-05-25");

    expect(entries[1].dayName).toBe("terça-feira");
    expect(entries[1].iso).toBe("2026-05-26"); // ← CRITICAL: 26, not 30

    expect(entries[2].dayName).toBe("quarta-feira");
    expect(entries[2].iso).toBe("2026-05-27");

    expect(entries[4].dayName).toBe("sexta-feira");
    expect(entries[4].iso).toBe("2026-05-29");

    expect(entries[5].dayName).toBe("sábado");
    expect(entries[5].iso).toBe("2026-05-30"); // sábado = 30 (o LLM confundiu com terça)

    expect(entries[6].dayName).toBe("domingo");
    expect(entries[6].iso).toBe("2026-05-31");
  });

  it("atravessa corretamente virada de mês (sexta+3 = segunda seguinte)", () => {
    const now = new Date("2026-05-29T12:00:00-03:00"); // sexta
    const entries = buildWeekCalendar(now);

    expect(entries[0].dayName).toBe("sexta-feira");
    expect(entries[0].iso).toBe("2026-05-29");

    expect(entries[1].dayName).toBe("sábado");
    expect(entries[1].iso).toBe("2026-05-30");

    expect(entries[2].dayName).toBe("domingo");
    expect(entries[2].iso).toBe("2026-05-31");

    expect(entries[3].dayName).toBe("segunda-feira");
    expect(entries[3].iso).toBe("2026-06-01"); // virada de mês
  });

  it("fornece dateStr no formato DD/MM/AAAA para exibição ao cliente", () => {
    const now = new Date("2026-05-25T12:00:00-03:00");
    const entries = buildWeekCalendar(now);
    // Formato para exibição humana
    expect(entries[0].dateStr).toMatch(/25\/05\/2026/);
    expect(entries[1].dateStr).toMatch(/26\/05\/2026/);
  });
});

// ─── extractTimeFromMessage (Bug #B1 — horário específico, 2026-06-20) ─────────

describe("extractTimeFromMessage", () => {
  describe("reconhece horários explícitos", () => {
    it("extrai 'as 11h' → 11:00 (caso do print do usuário)", () => {
      expect(extractTimeFromMessage("Tem horário para as 11h?")).toBe("11:00");
    });

    it("extrai 'HH:MM' com dois-pontos", () => {
      expect(extractTimeFromMessage("pode ser 14:30?")).toBe("14:30");
    });

    it("extrai 'HHhMM' (sufixo h com minutos)", () => {
      expect(extractTimeFromMessage("11h30 está bom")).toBe("11:30");
    });

    it("extrai variações de sufixo h (hs, hrs, horas)", () => {
      expect(extractTimeFromMessage("às 9hs")).toBe("09:00");
      expect(extractTimeFromMessage("9 horas pode?")).toBe("09:00");
      expect(extractTimeFromMessage("16hrs")).toBe("16:00");
    });

    it("zero-pad horas e minutos de um dígito", () => {
      expect(extractTimeFromMessage("9h")).toBe("09:00");
    });

    it("retorna o PRIMEIRO horário quando há mais de um", () => {
      expect(extractTimeFromMessage("entre 9h e 11h")).toBe("09:00");
    });
  });

  describe("NÃO confunde datas/números com horário (anti falso-positivo)", () => {
    it("retorna null para pergunta de dia ('22 é que dia?')", () => {
      expect(extractTimeFromMessage("22 é que dia? Segunda ou terça?")).toBeNull();
    });

    it("retorna null para número cru sem marcador de hora", () => {
      expect(extractTimeFromMessage("quero o serviço 2")).toBeNull();
      expect(extractTimeFromMessage("são 3 pessoas")).toBeNull();
    });

    it("retorna null para mensagem sem horário", () => {
      expect(extractTimeFromMessage("Gostaria de cortar o cabelo")).toBeNull();
      expect(extractTimeFromMessage("")).toBeNull();
      expect(extractTimeFromMessage(null)).toBeNull();
    });
  });

  describe("descarta valores impossíveis", () => {
    it("ignora hora > 23 e minuto > 59", () => {
      expect(extractTimeFromMessage("25h")).toBeNull();
      expect(extractTimeFromMessage("10:99")).toBeNull();
    });
  });
});

// ─── extractDateFromMessage (causa-raiz "não consegui verificar", 2026-06-21) ──

describe("extractDateFromMessage", () => {
  // Segunda-feira 25/05/2026 como referência fixa (determinístico)
  const SEG = new Date("2026-05-25T12:00:00-03:00");

  describe("datas relativas", () => {
    it("resolve 'hoje'", () => {
      expect(extractDateFromMessage("pode hoje?", SEG)).toBe("2026-05-25");
    });
    it("resolve 'amanhã'", () => {
      expect(extractDateFromMessage("tem amanhã?", SEG)).toBe("2026-05-26");
    });
    it("resolve 'depois de amanhã' (antes de 'amanhã')", () => {
      expect(extractDateFromMessage("pode ser depois de amanhã", SEG)).toBe("2026-05-27");
    });
  });

  describe("dias da semana → próxima ocorrência", () => {
    it("resolve 'sexta-feira' (caso do print do usuário)", () => {
      // De segunda 25/05, a próxima sexta é 29/05.
      expect(extractDateFromMessage("Tem data na sexta-feira?", SEG)).toBe("2026-05-29");
    });
    it("resolve 'sábado'", () => {
      expect(extractDateFromMessage("quero no sábado", SEG)).toBe("2026-05-30");
    });
    it("resolve o próprio dia quando o weekday é hoje", () => {
      expect(extractDateFromMessage("pode na segunda?", SEG)).toBe("2026-05-25");
    });
  });

  describe("datas numéricas", () => {
    it("resolve 'DD/MM' assumindo o ano corrente", () => {
      expect(extractDateFromMessage("pode dia 26/06?", SEG)).toBe("2026-06-26");
    });
    it("resolve 'DD/MM/AAAA'", () => {
      expect(extractDateFromMessage("marca 26/06/2026", SEG)).toBe("2026-06-26");
    });
    it("resolve 'dia DD' no mês corrente (ou próximo se já passou)", () => {
      expect(extractDateFromMessage("dia 26 pode?", SEG)).toBe("2026-05-26");
      expect(extractDateFromMessage("dia 10 pode?", SEG)).toBe("2026-06-10"); // 10 < 25 → próximo mês
    });
  });

  describe("sem data reconhecível → null (não inventa)", () => {
    it("'Tem horário para as 11h?' não vira data", () => {
      expect(extractDateFromMessage("Tem horário para as 11h?", SEG)).toBeNull();
    });
    it("mensagem genérica retorna null", () => {
      expect(extractDateFromMessage("quero cortar o cabelo", SEG)).toBeNull();
      expect(extractDateFromMessage("", SEG)).toBeNull();
      expect(extractDateFromMessage(null, SEG)).toBeNull();
    });
  });
});

// ─── extractLastDiscussedDate (Bug #B2 — âncora de data, 2026-06-20) ───────────

describe("extractLastDiscussedDate", () => {
  it("retorna null para histórico vazio ou sem data", () => {
    expect(extractLastDiscussedDate([])).toBeNull();
    expect(extractLastDiscussedDate([makeUserMsg("oi")])).toBeNull();
    expect(extractLastDiscussedDate([makeToolMsg(JSON.stringify({ ok: true }))])).toBeNull();
  });

  it("extrai a data de um resultado de buscar_proximo_horario", () => {
    const history: AIMessage[] = [
      makeToolMsg(JSON.stringify({ encontrado: true, data: "2026-06-22", hora: "09:00", servico: "Corte" }))
    ];
    expect(extractLastDiscussedDate(history)).toBe("2026-06-22");
  });

  it("retorna a data MAIS RECENTE quando há várias", () => {
    const history: AIMessage[] = [
      makeToolMsg(JSON.stringify({ data: "2026-06-22", disponivel: true })),
      makeToolMsg(JSON.stringify({ ok: true })),
      makeToolMsg(JSON.stringify({ data: "2026-06-25", disponivel: true }))
    ];
    expect(extractLastDiscussedDate(history)).toBe("2026-06-25");
  });

  it("ignora campos data que não estão no formato ISO", () => {
    const history: AIMessage[] = [
      makeToolMsg(JSON.stringify({ data: "22/06/2026" })),
      makeToolMsg(JSON.stringify({ data: "amanhã" }))
    ];
    expect(extractLastDiscussedDate(history)).toBeNull();
  });

  it("ignora conteúdo não-JSON sem lançar erro", () => {
    expect(extractLastDiscussedDate([makeToolMsg("texto livre")])).toBeNull();
  });
});
