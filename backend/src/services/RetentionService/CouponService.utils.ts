/**
 * CouponService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para permitir testes unitários sem Sequelize/Crypto em ambiente CI.
 * A camada de I/O vive em `CouponService.ts`.
 *
 * Responsabilidades:
 *   - `generateCode`           — gera código legível e único para o cupom
 *   - `validateCouponDecision` — decide se um cupom pode ser resgatado
 */

import crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────

/**
 * Representação mínima de um cupom para decisões de validação.
 * Aceita Coupon completo do Sequelize ou stub de testes.
 */
export interface CouponLike {
  redeemedAt?: Date | null;
  validFrom: Date;
  validUntil: Date;
}

export type ValidationFailReason =
  | "already_redeemed"
  | "not_yet_valid"
  | "expired";

export interface ValidationResult {
  valid: boolean;
  /** "ok" se válido; motivo específico se inválido */
  reason: "ok" | ValidationFailReason;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Gera um código único e legível para cupom.
 *
 * Formato: `{PREFIX}-{4 chars}-{4 chars}` em maiúsculas, ex:
 *   - `ANIVER-7H2K-X3M9`
 *   - `FIDELIDADE-AB12-CD34`
 *   - `CUPOM-AB12-CD34`       (sem prefixo: usa "CUPOM")
 *
 * Usa `crypto.randomBytes` para alta entropia.
 * Caracteres usados: A-Z e 0-9 (excluindo O/0 e I/1 para evitar ambiguidade visual).
 *
 * @param prefix Prefixo legível (ex: "ANIVER", "FIDELIDADE"). Default: "CUPOM"
 * @returns Código único como string (ex: "ANIVER-7H2K-X3M9")
 *
 * @example
 *   generateCode("ANIVER")     // → "ANIVER-7H2K-X3M9"
 *   generateCode()             // → "CUPOM-AB12-CD34"
 *   generateCode("FIDELIDADE") // → "FIDELIDADE-AB12-CD34"
 */
export function generateCode(prefix: string = "CUPOM"): string {
  // Alfanumérico sem ambiguidade visual (sem O, 0, I, 1, L)
  const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const randomPart = (len: number): string => {
    const bytes = crypto.randomBytes(len);
    return Array.from(bytes)
      .map(b => CHARS[b % CHARS.length])
      .join("");
  };

  const sanitized = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `${sanitized}-${randomPart(4)}-${randomPart(4)}`;
}

/**
 * Decide se um cupom pode ser resgatado neste momento.
 *
 * Regras (em ordem de verificação):
 *   1. Já resgatado → `{ valid: false, reason: 'already_redeemed' }`
 *   2. Antes do início da validade → `{ valid: false, reason: 'not_yet_valid' }`
 *   3. Após o fim da validade → `{ valid: false, reason: 'expired' }`
 *   4. Tudo ok → `{ valid: true, reason: 'ok' }`
 *
 * `validFrom` inclusivo, `validUntil` inclusivo (>=/<= em ambos os limites).
 *
 * @param coupon Dados do cupom (pode ser stub de teste)
 * @param now Data de referência (default: agora). Injetável para testes.
 * @returns ValidationResult com valid + reason
 *
 * @example
 *   validateCouponDecision(
 *     { redeemedAt: null, validFrom: yesterday, validUntil: tomorrow },
 *     new Date()
 *   )
 *   // → { valid: true, reason: 'ok' }
 */
export function validateCouponDecision(
  coupon: CouponLike,
  now: Date = new Date()
): ValidationResult {
  // Regra 1: já resgatado
  if (coupon.redeemedAt) {
    return { valid: false, reason: "already_redeemed" };
  }

  // Regra 2: ainda não começou (validFrom inclusivo)
  if (now < coupon.validFrom) {
    return { valid: false, reason: "not_yet_valid" };
  }

  // Regra 3: expirou (validUntil inclusivo)
  if (now > coupon.validUntil) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, reason: "ok" };
}
