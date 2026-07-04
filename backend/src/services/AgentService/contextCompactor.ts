/**
 * contextCompactor — funções puras para compactação de histórico de conversa.
 *
 * Quando o histórico excede COMPACTION_THRESHOLD mensagens, as mensagens antigas
 * são descartadas em favor de um resumo gerado pelo LLM. Isso evita que tickets
 * longos façam o modelo "esquecer" o início da conversa por falta de contexto.
 *
 * DESIGN: todas as funções são puras (sem I/O, sem Redis, sem Sequelize).
 * A orquestração — chamada ao LLM para gerar o resumo e persistência no Redis —
 * é responsabilidade do AgentService/index.ts. Ver §II.1 de CLAUDE.md (TDD first)
 * e §III (separação de responsabilidades).
 */

import { AIMessage } from "./providers/interfaces";

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Número de mensagens que dispara a compactação.
 * Exportado para que contextManager e AgentService usem o mesmo valor.
 */
export const COMPACTION_THRESHOLD = 30;

/** Máximo de caracteres por mensagem no contexto de compactação. */
const MAX_CONTENT_CHARS_FOR_SUMMARY = 500;

/** Número de mensagens recentes preservadas após compactação. */
const DEFAULT_KEEP_RECENT = 10;

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Decide se o histórico deve ser compactado.
 *
 * @param messages - Array de mensagens do histórico.
 * @param threshold - Limite de mensagens antes de compactar (padrão: COMPACTION_THRESHOLD).
 * @returns `true` se `messages.length > threshold`, caso contrário `false`.
 *
 * @example
 * shouldCompact(history)         // true se history.length > 30
 * shouldCompact(history, 50)     // true se history.length > 50
 */
export function shouldCompact(
  messages: AIMessage[],
  threshold: number = COMPACTION_THRESHOLD
): boolean {
  // Compactação só faz sentido quando o histórico supera o limite definido.
  // Igual ao threshold NÃO compacta — preserva contexto enquanto possível.
  return messages.length > threshold;
}

/**
 * Extrai o conteúdo textual de uma mensagem.
 *
 * Nesta codebase, `AIMessage.content` é sempre `string`. A função encapsula
 * esse acesso para que futuras evoluções da interface (ex: blocos de conteúdo)
 * possam ser tratadas aqui sem alterar os consumidores.
 *
 * @param message - Mensagem cujo conteúdo textual deve ser extraído.
 * @returns String com o conteúdo textual, ou `""` se não houver texto.
 *
 * @example
 * extractTextContent({ role: "user", content: "Olá" }) // "Olá"
 */
export function extractTextContent(message: AIMessage): string {
  // content é sempre string nesta codebase (ver providers/interfaces.ts)
  return typeof message.content === "string" ? message.content : "";
}

/**
 * Formata um array de mensagens como texto legível para o LLM sumarizar.
 *
 * Cada mensagem recebe um prefixo `role:` e conteúdos maiores que
 * MAX_CONTENT_CHARS_FOR_SUMMARY são truncados com `"..."` para evitar
 * que uma mensagem gigante domine o contexto de sumarização.
 *
 * @param messages - Mensagens a formatar (normalmente o segmento "antigo" do histórico).
 * @returns String multi-linha pronta para ser passada como prompt de sumarização.
 *
 * @example
 * buildCompactionContext([
 *   { role: "user", content: "Quero agendar" },
 *   { role: "assistant", content: "Qual serviço?" }
 * ])
 * // "user: Quero agendar\nassistant: Qual serviço?"
 */
export function buildCompactionContext(messages: AIMessage[]): string {
  if (messages.length === 0) return "";

  return messages
    .map(msg => {
      const raw = extractTextContent(msg);
      // Truncar conteúdo longo para não dominar o prompt de sumarização.
      // A "..." sinaliza ao LLM que houve truncamento proposital.
      const content =
        raw.length > MAX_CONTENT_CHARS_FOR_SUMMARY
          ? raw.slice(0, MAX_CONTENT_CHARS_FOR_SUMMARY) + "..."
          : raw;
      return `${msg.role}: ${content}`;
    })
    .join("\n");
}

/**
 * Aplica a compactação: descarta mensagens antigas, prepend o resumo.
 *
 * A mensagem de resumo é injetada com `role: "user"` e um marcador especial
 * para que o LLM saiba que é contexto de sistema e não uma mensagem real do
 * cliente. Dessa forma o provedor não precisa suportar `role: "system"` no
 * meio do histórico (comportamento não-padrão em alguns providers).
 *
 * @param messages - Histórico completo (não modificado — função imutável).
 * @param summary - Texto do resumo gerado pelo LLM.
 * @param keepRecentCount - Quantas mensagens recentes preservar após compactação
 *   (padrão: DEFAULT_KEEP_RECENT = 10).
 * @returns Novo array: [mensagem de resumo, ...últimas keepRecentCount mensagens].
 *
 * @example
 * const compacted = applyCompaction(history, "Cliente quer agendar limpeza", 10);
 * // compacted[0] = { role: "user", content: "[CONTEXTO ANTERIOR RESUMIDO...] ..." }
 * // compacted[1..10] = últimas 10 mensagens do histórico original
 */
export function applyCompaction(
  messages: AIMessage[],
  summary: string,
  keepRecentCount: number = DEFAULT_KEEP_RECENT
): AIMessage[] {
  // Garante imutabilidade: não mutamos o array original
  const recent = keepRecentCount > 0
    ? messages.slice(-keepRecentCount)
    : [];

  // A mensagem de resumo usa role "user" com marcador explícito.
  // Razão: `role: "system"` no meio do histórico é rejeitado por alguns providers
  // (ex: OpenAI rejeita "system" fora da posição 0). O marcador instrui o LLM
  // a tratar o bloco como contexto de sistema, não como input do cliente.
  const summaryMessage: AIMessage = {
    role: "user",
    content:
      "[CONTEXTO ANTERIOR RESUMIDO — NÃO É UMA NOVA MENSAGEM DO CLIENTE]\n" +
      `Resumo da conversa anterior: ${summary}`
  };

  return [summaryMessage, ...recent];
}

/**
 * Estima o número de tokens de um array de mensagens.
 *
 * Usa a heurística simples de 1 token ≈ 4 caracteres, suficiente para
 * decisões de compactação onde precisão exata não é necessária.
 * Tokenizers reais (tiktoken, etc.) seriam mais precisos mas adicionam
 * dependência e latência desnecessárias para este uso.
 *
 * @param messages - Mensagens a estimar.
 * @returns Estimativa de tokens (inteiro, arredondado para baixo).
 *
 * @example
 * estimateTokenCount([{ role: "user", content: "abcd" }]) // 1
 */
export function estimateTokenCount(messages: AIMessage[]): number {
  if (messages.length === 0) return 0;

  const totalChars = messages.reduce((sum, msg) => {
    return sum + extractTextContent(msg).length;
  }, 0);

  // 1 token ≈ 4 chars — heurística padrão para português/inglês
  return Math.floor(totalChars / 4);
}
