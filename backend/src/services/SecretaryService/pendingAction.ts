/**
 * pendingAction — gerencia ações pendentes de confirmação entre turnos da secretária.
 *
 * Fluxo de uso:
 *   Turno 1: gerar_mensagem_contextualizada → gera rascunho → savePendingAction
 *   Secretária: "Vou enviar: '[rascunho]'. Confirma? (sim/não)"
 *   Turno 2: admin diz "sim" → secretaryLoop intercepta → executa ação → clearPendingAction
 *            admin diz "não" → secretaryLoop cancela → clearPendingAction
 *
 * Por que Redis e não apenas o contexto de conversa:
 *   O contexto da conversa é lido pelo LLM, que pode variar na interpretação.
 *   A pendingAction é dados estruturados (ticketId, body) que precisam chegar
 *   intactos para envio — não podem depender de extração probabilística do LLM.
 *
 * TTL de 10 minutos: suficiente para o admin revisar e confirmar.
 * Após expirar, o admin precisa repetir o pedido.
 */

import { get as redisGet, set as redisSet, del as redisDel } from "../../libs/cache";

// ── Constantes ──────────────────────────────────────────────────────────────

/** TTL da pendingAction no Redis (segundos). */
export const PENDING_ACTION_TTL = 600; // 10 minutos

/**
 * Palavras que o admin diz para CONFIRMAR o envio.
 * Aceita variações comuns sem exigir correspondência exata.
 */
const CONFIRM_REGEX = /^(sim|pode|ok|confirma|manda|envia|isso|vai|certo|tá\s*bom)\b/i;

/**
 * Palavras que o admin diz para CANCELAR o envio.
 */
const CANCEL_REGEX = /^(n[aã]o|cancela|para|pare|desiste|esquece|esqueça|abort)\b/i;

// ── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Ação de envio de mensagem (fluxo legado: gerar_mensagem_contextualizada gera
 * o rascunho e o estaciona para confirmação).
 */
export interface PendingSendMessage {
  type: "enviar_mensagem";
  ticketId: number;
  /** Texto do rascunho a ser enviado ao cliente. */
  body: string;
  /** Nome do contato — usado na mensagem de confirmação ao admin. */
  contactName: string;
}

/**
 * Ação destrutiva/irreversível estacionada para confirmação determinística
 * (2026-06-21). O loop NUNCA executa cancelar/reagendar/fechar/reabrir/transferir/
 * enviar diretamente — estaciona aqui e só executa após o admin confirmar com "sim".
 * Garante que nenhuma ação irreversível dependa da probabilidade do LLM.
 */
export interface PendingToolCall {
  type: "confirm_tool";
  /** Nome da tool a executar após confirmação (ex: "cancelar_agendamento"). */
  tool: string;
  /** Argumentos exatos com que a tool será executada. */
  args: Record<string, unknown>;
  /** Descrição humana da ação, para a mensagem de confirmação ao admin. */
  descricao: string;
}

/** União das ações pendentes suportadas. */
export type PendingAction = PendingSendMessage | PendingToolCall;

// ── Funções de acesso Redis ──────────────────────────────────────────────────

/** Chave Redis para a pendingAction de uma conversa específica. */
export function pendingActionKey(companyId: number, senderNumber: string): string {
  return `secretary:pending:${companyId}:${senderNumber}`;
}

/**
 * Persiste uma ação pendente no Redis com TTL de 10 minutos.
 * Substitui qualquer ação pendente anterior para o mesmo admin.
 */
export async function savePendingAction(
  companyId: number,
  senderNumber: string,
  action: PendingAction
): Promise<void> {
  await redisSet(
    pendingActionKey(companyId, senderNumber),
    JSON.stringify(action),
    "EX",
    PENDING_ACTION_TTL
  );
}

/**
 * Carrega a ação pendente do Redis. Retorna null se não houver ou se expirou.
 */
export async function loadPendingAction(
  companyId: number,
  senderNumber: string
): Promise<PendingAction | null> {
  try {
    const raw = await redisGet(pendingActionKey(companyId, senderNumber));
    if (!raw) return null;
    return JSON.parse(raw) as PendingAction;
  } catch {
    return null;
  }
}

/**
 * Remove a ação pendente do Redis (após execução ou cancelamento).
 */
export async function clearPendingAction(
  companyId: number,
  senderNumber: string
): Promise<void> {
  try {
    await redisDel(pendingActionKey(companyId, senderNumber));
  } catch {
    // Falha silenciosa — Redis pode ter expirado o key antes
  }
}

// ── Classificadores de intenção ──────────────────────────────────────────────

/**
 * Retorna true se a mensagem do admin indica confirmação da ação pendente.
 * Ignora maiúsculas/minúsculas e espaços em branco.
 *
 * @example
 *   isConfirmation("sim")      → true
 *   isConfirmation("pode enviar") → true
 *   isConfirmation("na verdade não") → false
 */
export function isConfirmation(message: string): boolean {
  return CONFIRM_REGEX.test(message.trim());
}

/**
 * Retorna true se a mensagem do admin indica cancelamento da ação pendente.
 *
 * @example
 *   isCancellation("não")      → true
 *   isCancellation("cancela")  → true
 *   isCancellation("ok")       → false
 */
export function isCancellation(message: string): boolean {
  return CANCEL_REGEX.test(message.trim());
}
