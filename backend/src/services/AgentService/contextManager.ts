/**
 * contextManager — gerencia o histórico de conversa do agente no Redis.
 * TTL de 1 hora: conversas expiram automaticamente, sem acúmulo infinito.
 * Usa o cacheLayer existente (ioredis) para não duplicar conexões.
 */

import { cacheLayer } from "../../libs/cache";
import { AIMessage } from "./providers/interfaces";
import { COMPACTION_THRESHOLD } from "./contextCompactor";

/** Máximo de mensagens mantidas no contexto (configurável por empresa) */
const DEFAULT_MAX_MESSAGES = 20;
const CONTEXT_TTL_SECONDS = 3600; // 1 hora

/**
 * Limite de mensagens que dispara compactação de contexto.
 * Re-exportado de contextCompactor para que módulos que importam contextManager
 * não precisem de um segundo import.
 */
export { COMPACTION_THRESHOLD };

/** Gera a chave Redis para o contexto de um ticket específico */
function contextKey(companyId: number, ticketId: number): string {
  return `agent:ctx:${companyId}:${ticketId}`;
}

/**
 * Carrega o histórico de conversa de um ticket do Redis.
 */
export async function loadContext(
  companyId: number,
  ticketId: number
): Promise<AIMessage[]> {
  try {
    const raw = await cacheLayer.get(contextKey(companyId, ticketId));
    if (!raw) return [];
    return JSON.parse(raw) as AIMessage[];
  } catch {
    return [];
  }
}

/**
 * Salva o histórico de conversa no Redis com TTL de 1 hora.
 * Mantém no máximo maxMessages mensagens (descarta as mais antigas).
 */
export async function saveContext(
  companyId: number,
  ticketId: number,
  messages: AIMessage[],
  maxMessages: number = DEFAULT_MAX_MESSAGES
): Promise<void> {
  try {
    const truncated = messages.slice(-maxMessages);
    await cacheLayer.set(
      contextKey(companyId, ticketId),
      JSON.stringify(truncated),
      "EX",
      CONTEXT_TTL_SECONDS
    );
  } catch {
    // Falha no Redis não deve derrubar o agente
  }
}

/**
 * Remove o contexto de um ticket (usado ao encerrar o atendimento).
 */
export async function clearContext(
  companyId: number,
  ticketId: number
): Promise<void> {
  try {
    await cacheLayer.del(contextKey(companyId, ticketId));
  } catch {
    // Silencioso — limpeza é best-effort
  }
}
