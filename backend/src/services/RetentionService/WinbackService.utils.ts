/**
 * WinbackService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para testes unitários sem Sequelize, WhatsApp ou cron.
 *
 * Responsabilidades:
 *   - `shouldAttemptWinback`  — decide se deve disparar dada cooldown
 *   - `buildWinbackMessage`   — monta a mensagem de reativação
 */

import { DormantStatusType } from "./DormantDetectionService";

// ── Constantes ─────────────────────────────────────────────────────

/** Dias de cooldown entre tentativas de win-back (default). */
export const DEFAULT_WINBACK_COOLDOWN_DAYS = 90;

/** Status que disparam win-back (cliente já passou da janela de reativação leve). */
export const WINBACK_STATUSES: DormantStatusType[] = ["adormecido", "perdido"];

// ── Types ──────────────────────────────────────────────────────────

export interface WinbackDecisionInput {
  status: DormantStatusType;
  /** Última tentativa de win-back (null se nunca tentou) */
  lastAttemptAt: Date | null;
  /** Cliente tem pelo menos 1 serviço no histórico? */
  hasHistory: boolean;
}

export interface WinbackMessageParams {
  contactName: string;
  /** Cupom de reativação gerado */
  couponCode: string;
  /** Valor do desconto (ex: "20%") */
  discountLabel: string;
  /** Dias de validade do cupom */
  validDays: number;
  /** Template configurado pelo admin (opcional) */
  template?: string;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Decide se uma tentativa de win-back deve ser disparada.
 *
 * Critérios:
 *   1. Status é "adormecido" ou "perdido"
 *   2. Cliente tem histórico (sem histórico = não é "perdido", é "novo nunca veio")
 *   3. Última tentativa foi há mais de `cooldownDays` (ou nunca)
 *
 * @param input Dados de decisão
 * @param cooldownDays Dias mínimos entre tentativas (default: 90)
 * @param now Data de referência (default: agora)
 * @returns true se deve disparar
 *
 * @example
 *   shouldAttemptWinback(
 *     { status: "perdido", lastAttemptAt: null, hasHistory: true }
 *   ) // → true
 */
export function shouldAttemptWinback(
  input: WinbackDecisionInput,
  cooldownDays: number = DEFAULT_WINBACK_COOLDOWN_DAYS,
  now: Date = new Date()
): boolean {
  if (!input.hasHistory) return false;
  if (!WINBACK_STATUSES.includes(input.status)) return false;

  // Nunca tentou → pode tentar
  if (!input.lastAttemptAt) return true;

  // Verifica cooldown
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const daysSinceLast = Math.floor(
    (now.getTime() - input.lastAttemptAt.getTime()) / MS_PER_DAY
  );
  return daysSinceLast >= cooldownDays;
}

/**
 * Monta mensagem de reativação com cupom.
 *
 * @example
 *   buildWinbackMessage({
 *     contactName: "Maria",
 *     couponCode: "VOLTA-AB12",
 *     discountLabel: "20% OFF",
 *     validDays: 30
 *   })
 */
export function buildWinbackMessage(params: WinbackMessageParams): string {
  const name = params.contactName || "Cliente";

  if (params.template && params.template.trim().length > 0) {
    let msg = params.template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{nome\}\}/g, name)
      .replace(/\{\{coupon\}\}/g, params.couponCode)
      .replace(/\{\{cupom\}\}/g, params.couponCode)
      .replace(/\{\{discount\}\}/g, params.discountLabel)
      .replace(/\{\{desconto\}\}/g, params.discountLabel)
      .replace(/\{\{dias\}\}/g, String(params.validDays));

    // Garante que o cupom apareça
    if (!msg.includes(params.couponCode)) {
      msg += `\n\n🎁 Use o código: *${params.couponCode}* (${params.discountLabel})`;
    }
    return msg;
  }

  // Mensagem padrão
  return (
    `Olá, ${name}! 💜 Faz tempo que não nos vemos por aqui. ` +
    `Preparamos uma oferta especial para te receber de volta:\n\n` +
    `🎁 *${params.discountLabel}* com o código: *${params.couponCode}*\n` +
    `Válido por ${params.validDays} dias.\n\n` +
    `Esperamos por você! ❤️`
  );
}
