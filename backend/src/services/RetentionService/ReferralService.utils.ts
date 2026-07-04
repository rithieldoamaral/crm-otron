/**
 * ReferralService — lógica PURA do programa de indicação.
 *
 * Responsabilidades:
 *   - `generateReferralCode`        — código único e legível
 *   - `validateReferralRegistration` — checa regras (auto-indicação, etc)
 *   - `buildReferrerThanksMessage`  — mensagem para quem indicou
 *   - `buildReferredWelcomeMessage` — mensagem para quem foi indicado
 */

import { randomBytes } from "crypto";

// ── Constantes ─────────────────────────────────────────────────────

/** Alfabeto sem caracteres ambíguos (sem 0/O, 1/I/L). */
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Tamanho do código sem prefixo. */
const CODE_LENGTH = 6;

/** Prefixo padrão do código de indicação. */
export const REFERRAL_CODE_PREFIX = "INDICA";

// ── Types ──────────────────────────────────────────────────────────

export interface ReferralRegistrationInput {
  /** ID do contato referrer (encontrado pelo código) */
  referrerContactId: number;
  /** ID do novo contato (vindo de novo cadastro) */
  referredContactId: number;
  /** Empresas devem ser iguais */
  referrerCompanyId: number;
  referredCompanyId: number;
}

export type ReferralValidationReason =
  | "ok"
  | "self_referral"
  | "different_companies"
  | "missing_data";

export interface ReferralValidationResult {
  valid: boolean;
  reason: ReferralValidationReason;
}

export interface ReferralMessageParams {
  contactName: string;
  /** Código do cupom gerado */
  couponCode: string;
  /** Nome amigável do desconto (ex: "20% OFF") */
  discountLabel: string;
  /** Dias de validade */
  validDays: number;
  /** Nome do contato relacionado (referrer ou referred dependendo do contexto) */
  relatedContactName?: string;
  /** Template configurado pelo admin (opcional) */
  template?: string;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Gera um código de indicação único e legível.
 *
 * Formato: PREFIX-XXXXXX
 * Exemplo: INDICA-A2B3C4
 *
 * Usa randomBytes do crypto (não Math.random) para entropia suficiente.
 * 30^6 ≈ 729M combinações — colisão extremamente improvável em SMB.
 *
 * @param prefix Prefixo opcional (default: "INDICA")
 * @returns Código no formato PREFIX-XXXXXX
 *
 * @example
 *   generateReferralCode()            // → "INDICA-A2B3C4"
 *   generateReferralCode("MARIA")     // → "MARIA-X7Y8Z9"
 */
export function generateReferralCode(prefix: string = REFERRAL_CODE_PREFIX): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return `${prefix}-${code}`;
}

/**
 * Valida regras de registro de uma indicação.
 *
 * Regras:
 *   1. Referrer e referred devem ser pessoas DIFERENTES (anti-fraude básica)
 *   2. Mesma empresa (referrals não cruzam empresas)
 *   3. Ambos os IDs devem ser positivos
 *
 * @param input Dados de registro
 * @returns Resultado com motivo se inválido
 *
 * @example
 *   validateReferralRegistration({
 *     referrerContactId: 1, referredContactId: 2,
 *     referrerCompanyId: 1, referredCompanyId: 1
 *   })
 *   // → { valid: true, reason: "ok" }
 */
export function validateReferralRegistration(
  input: ReferralRegistrationInput
): ReferralValidationResult {
  const { referrerContactId, referredContactId, referrerCompanyId, referredCompanyId } = input;

  if (!referrerContactId || !referredContactId || !referrerCompanyId || !referredCompanyId) {
    return { valid: false, reason: "missing_data" };
  }

  if (referrerContactId === referredContactId) {
    return { valid: false, reason: "self_referral" };
  }

  if (referrerCompanyId !== referredCompanyId) {
    return { valid: false, reason: "different_companies" };
  }

  return { valid: true, reason: "ok" };
}

/**
 * Mensagem de agradecimento para quem indicou (referrer).
 * Enviada quando o indicado completa o primeiro serviço.
 *
 * @example
 *   buildReferrerThanksMessage({
 *     contactName: "Maria",
 *     relatedContactName: "Ana",
 *     couponCode: "AMIGO-AB12",
 *     discountLabel: "20% OFF",
 *     validDays: 60
 *   })
 */
export function buildReferrerThanksMessage(params: ReferralMessageParams): string {
  const name = params.contactName || "Cliente";
  const friend = params.relatedContactName || "seu amigo(a)";

  if (params.template && params.template.trim().length > 0) {
    let msg = params.template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{nome\}\}/g, name)
      .replace(/\{\{amigo\}\}/g, friend)
      .replace(/\{\{friend\}\}/g, friend)
      .replace(/\{\{coupon\}\}/g, params.couponCode)
      .replace(/\{\{cupom\}\}/g, params.couponCode)
      .replace(/\{\{discount\}\}/g, params.discountLabel)
      .replace(/\{\{desconto\}\}/g, params.discountLabel)
      .replace(/\{\{dias\}\}/g, String(params.validDays));

    if (!msg.includes(params.couponCode)) {
      msg += `\n\n🎁 Seu cupom: *${params.couponCode}*`;
    }
    return msg;
  }

  return (
    `Oi, ${name}! 🎉 ${friend} acabou de ser atendido(a) e mencionou que você indicou. ` +
    `Como agradecimento pela confiança, separamos um presente para você:\n\n` +
    `🎁 *${params.discountLabel}* — código: *${params.couponCode}*\n` +
    `Válido por ${params.validDays} dias.\n\n` +
    `Obrigado pela indicação! ❤️`
  );
}

/**
 * Mensagem de boas-vindas para o indicado (referred).
 * Enviada também quando ele completa o primeiro serviço (premia o retorno).
 */
export function buildReferredWelcomeMessage(params: ReferralMessageParams): string {
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

    if (!msg.includes(params.couponCode)) {
      msg += `\n\n🎁 Seu cupom: *${params.couponCode}*`;
    }
    return msg;
  }

  return (
    `Bem-vindo(a), ${name}! 💜 Que bom ter você aqui. ` +
    `Como você foi indicado(a) por um amigo nosso, separamos um presente especial:\n\n` +
    `🎁 *${params.discountLabel}* na sua próxima visita — código: *${params.couponCode}*\n` +
    `Válido por ${params.validDays} dias.\n\n` +
    `Esperamos te ver em breve! ❤️`
  );
}
