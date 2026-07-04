/**
 * Testes TDD para contextCompactor — funções puras de compactação de contexto.
 * Sem I/O, sem Redis, sem Sequelize. Apenas lógica determinística.
 */

import {
  shouldCompact,
  extractTextContent,
  buildCompactionContext,
  applyCompaction,
  estimateTokenCount,
  COMPACTION_THRESHOLD
} from "../contextCompactor";
import { AIMessage } from "../providers/interfaces";

// ─── Helpers de fixture ───────────────────────────────────────────────────────

function makeUserMsg(content: string): AIMessage {
  return { role: "user", content };
}

function makeAssistantMsg(content: string): AIMessage {
  return { role: "assistant", content };
}

function makeToolMsg(content: string): AIMessage {
  return { role: "tool", content, toolCallId: "call_1", name: "alguma_tool" };
}

function makeMessages(count: number): AIMessage[] {
  return Array.from({ length: count }, (_, i) =>
    i % 2 === 0 ? makeUserMsg(`user msg ${i}`) : makeAssistantMsg(`assistant msg ${i}`)
  );
}

// ─── shouldCompact ────────────────────────────────────────────────────────────

describe("shouldCompact", () => {
  it("retorna false se messages.length <= threshold padrão", () => {
    expect(shouldCompact(makeMessages(30))).toBe(false);
  });

  it("retorna false se messages.length igual ao threshold padrão", () => {
    expect(shouldCompact(makeMessages(COMPACTION_THRESHOLD))).toBe(false);
  });

  it("retorna true se messages.length > threshold padrão", () => {
    expect(shouldCompact(makeMessages(31))).toBe(true);
  });

  it("funciona com threshold customizado — abaixo", () => {
    expect(shouldCompact(makeMessages(10), 10)).toBe(false);
  });

  it("funciona com threshold customizado — acima", () => {
    expect(shouldCompact(makeMessages(11), 10)).toBe(true);
  });

  it("retorna false para array vazio", () => {
    expect(shouldCompact([])).toBe(false);
  });

  it("retorna false para 1 mensagem", () => {
    expect(shouldCompact([makeUserMsg("olá")])).toBe(false);
  });
});

// ─── extractTextContent ───────────────────────────────────────────────────────

describe("extractTextContent", () => {
  it("retorna content diretamente quando é string", () => {
    const msg = makeUserMsg("Olá, preciso de ajuda");
    expect(extractTextContent(msg)).toBe("Olá, preciso de ajuda");
  });

  it("retorna string vazia para content vazio", () => {
    const msg = makeUserMsg("");
    expect(extractTextContent(msg)).toBe("");
  });

  it("retorna content de mensagem assistant", () => {
    const msg = makeAssistantMsg("Claro, posso ajudar!");
    expect(extractTextContent(msg)).toBe("Claro, posso ajudar!");
  });

  it("retorna content de mensagem tool", () => {
    const msg = makeToolMsg('{"sucesso":true}');
    expect(extractTextContent(msg)).toBe('{"sucesso":true}');
  });
});

// ─── buildCompactionContext ───────────────────────────────────────────────────

describe("buildCompactionContext", () => {
  it("formata mensagens com prefixos user:/assistant:", () => {
    const messages: AIMessage[] = [
      makeUserMsg("Preciso agendar"),
      makeAssistantMsg("Claro, qual horário?")
    ];
    const result = buildCompactionContext(messages);
    expect(result).toContain("user: Preciso agendar");
    expect(result).toContain("assistant: Claro, qual horário?");
  });

  it("inclui mensagens de todas as roles (user, assistant, tool)", () => {
    const messages: AIMessage[] = [
      makeUserMsg("Quais serviços?"),
      makeAssistantMsg("Vou listar"),
      makeToolMsg('{"servicos":["Avaliação","Limpeza"]}'  )
    ];
    const result = buildCompactionContext(messages);
    expect(result).toContain("user: Quais serviços?");
    expect(result).toContain("assistant: Vou listar");
    // tool messages são incluídas com prefixo "tool:"
    expect(result).toContain("tool:");
  });

  it("trunca mensagens muito longas (> 500 chars) com '...'", () => {
    const longContent = "A".repeat(600);
    const messages: AIMessage[] = [makeUserMsg(longContent)];
    const result = buildCompactionContext(messages);
    expect(result).toContain("...");
    // O texto truncado deve ter no máximo 500 chars de conteúdo + "..."
    const line = result.split("\n").find(l => l.startsWith("user: "))!;
    const contentPart = line.replace("user: ", "");
    expect(contentPart.length).toBeLessThanOrEqual(503); // 500 + "..."
  });

  it("não trunca mensagens com exatamente 500 chars", () => {
    const exactContent = "B".repeat(500);
    const messages: AIMessage[] = [makeUserMsg(exactContent)];
    const result = buildCompactionContext(messages);
    const line = result.split("\n").find(l => l.startsWith("user: "))!;
    expect(line).not.toContain("...");
  });

  it("retorna string vazia para array vazio", () => {
    expect(buildCompactionContext([])).toBe("");
  });

  it("separa mensagens com quebra de linha", () => {
    const messages: AIMessage[] = [
      makeUserMsg("msg 1"),
      makeAssistantMsg("msg 2")
    ];
    const result = buildCompactionContext(messages);
    const lines = result.split("\n").filter(l => l.trim().length > 0);
    expect(lines).toHaveLength(2);
  });
});

// ─── applyCompaction ──────────────────────────────────────────────────────────

describe("applyCompaction", () => {
  const summary = "Cliente quer agendar uma limpeza dental para esta semana.";

  it("retorna as últimas keepRecentCount mensagens", () => {
    const messages = makeMessages(20);
    const result = applyCompaction(messages, summary, 10);
    // Últimas 10 originais + 1 mensagem de resumo = 11 total
    expect(result).toHaveLength(11);
    // Verifica que as últimas 10 originais estão presentes
    const lastTen = messages.slice(-10);
    lastTen.forEach((msg, i) => {
      expect(result[i + 1]).toEqual(msg);
    });
  });

  it("insere o resumo como primeira mensagem (role user)", () => {
    const messages = makeMessages(20);
    const result = applyCompaction(messages, summary, 10);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain(summary);
    expect(result[0].content).toContain("[CONTEXTO ANTERIOR RESUMIDO");
  });

  it("não modifica o array original (imutável)", () => {
    const messages = makeMessages(20);
    const original = [...messages];
    applyCompaction(messages, summary, 10);
    expect(messages).toEqual(original);
    expect(messages).toHaveLength(20);
  });

  it("keepRecentCount=0 retorna só o resumo (1 mensagem)", () => {
    const messages = makeMessages(20);
    const result = applyCompaction(messages, summary, 0);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain(summary);
  });

  it("keepRecentCount > messages.length retorna todas + resumo", () => {
    const messages = makeMessages(5);
    const result = applyCompaction(messages, summary, 50);
    // 5 originais + 1 resumo = 6
    expect(result).toHaveLength(6);
    expect(result[0].content).toContain(summary);
    expect(result[1]).toEqual(messages[0]);
  });

  it("retorna só o resumo quando messages está vazio", () => {
    const result = applyCompaction([], summary, 10);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain(summary);
  });

  it("mensagem de resumo contém marcador de contexto anterior", () => {
    const messages = makeMessages(10);
    const result = applyCompaction(messages, summary, 5);
    expect(result[0].content).toContain("[CONTEXTO ANTERIOR RESUMIDO — NÃO É UMA NOVA MENSAGEM DO CLIENTE]");
    expect(result[0].content).toContain("Resumo da conversa anterior:");
  });
});

// ─── estimateTokenCount ───────────────────────────────────────────────────────

describe("estimateTokenCount", () => {
  it("retorna 0 para array vazio", () => {
    expect(estimateTokenCount([])).toBe(0);
  });

  it("estima tokens como total de chars / 4", () => {
    const messages: AIMessage[] = [
      makeUserMsg("abcd"),    // 4 chars → 1 token
      makeAssistantMsg("efgh") // 4 chars → 1 token
    ];
    expect(estimateTokenCount(messages)).toBe(2);
  });

  it("arredonda para baixo (Math.floor)", () => {
    const messages: AIMessage[] = [makeUserMsg("abc")]; // 3 chars → 0.75 → floor → 0
    expect(estimateTokenCount(messages)).toBe(0);
  });

  it("soma chars de todas as mensagens", () => {
    const messages: AIMessage[] = [
      makeUserMsg("12345678"),    // 8 chars
      makeAssistantMsg("1234")   // 4 chars
    ];
    // total = 12 chars → 3 tokens
    expect(estimateTokenCount(messages)).toBe(3);
  });

  it("funciona com mensagem de 400 chars (~100 tokens)", () => {
    const messages: AIMessage[] = [makeUserMsg("A".repeat(400))];
    expect(estimateTokenCount(messages)).toBe(100);
  });
});

// ─── COMPACTION_THRESHOLD (constante exportada) ───────────────────────────────

describe("COMPACTION_THRESHOLD", () => {
  it("é exportada e vale 30", () => {
    expect(COMPACTION_THRESHOLD).toBe(30);
  });
});
