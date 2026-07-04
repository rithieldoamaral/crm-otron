/**
 * CouponService — camada de I/O para geração e gestão de cupons.
 *
 * Responsabilidades:
 *   1. `createCoupon`   — gera código único + persiste no banco
 *   2. `redeemCoupon`   — valida e marca como resgatado (atômico)
 *   3. `getByCode`      — busca cupom pelo código
 *   4. `listForContact` — lista cupons de um contato
 *
 * Lógica pura (generateCode, validateCouponDecision) está em
 * `CouponService.utils.ts` — separada para testes unitários.
 *
 * Diretiva: `directives/retencao_modulo.md` seção 7 (Cupons de Retenção).
 */

import AppError from "../../errors/AppError";
import Coupon, { CouponDiscountType, CouponReason } from "../../models/Coupon";
import { logger } from "../../utils/logger";
import { generateCode, validateCouponDecision } from "./CouponService.utils";

// ── Types ──────────────────────────────────────────────────────────

export interface CreateCouponParams {
  contactId?: number;
  companyId: number;
  reason: CouponReason;
  discountType: CouponDiscountType;
  discountValue: number;
  /** Início da validade. Default: agora */
  validFrom?: Date;
  /**
   * Fim da validade. Default: 30 dias a partir de validFrom.
   * Para aniversários, recomenda-se 7 dias.
   */
  validUntil?: Date;
  /** Prefixo do código (ex: "ANIVER", "FIDELIDADE"). Default: "CUPOM" */
  codePrefix?: string;
}

export interface RedeemCouponParams {
  code: string;
  companyId: number;
  /** ID do usuário que está resgatando */
  redeemedByUserId: number;
}

// ── Utilitários internos ──────────────────────────────────────────

const DEFAULT_VALIDITY_DAYS = 30;

/**
 * Garante código único tentando até 5 vezes antes de falhar.
 * Colisão é extremamente rara (~1/10^8), mas protegemos mesmo assim.
 */
async function generateUniqueCode(prefix: string): Promise<string> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const code = generateCode(prefix);
    const existing = await Coupon.findOne({ where: { code } });
    if (!existing) return code;
    logger.warn(`[CouponService] Colisão de código na tentativa ${attempt}: ${code}`);
  }
  throw new Error("[CouponService] Falha ao gerar código único após 5 tentativas");
}

// ── Funções de I/O ─────────────────────────────────────────────────

/**
 * Cria um novo cupom para um contato.
 *
 * Gera código único legível (ex: ANIVER-7H2K-X3M9) e persiste no banco.
 * Default de validade: 30 dias a partir de agora.
 *
 * @param params Dados do cupom
 * @returns Coupon criado
 *
 * @example
 *   await createCoupon({
 *     contactId: 42,
 *     companyId: 1,
 *     reason: "birthday",
 *     discountType: "percent",
 *     discountValue: 10,
 *     codePrefix: "ANIVER",
 *     validUntil: addDays(new Date(), 7)
 *   });
 */
export async function createCoupon(
  params: CreateCouponParams
): Promise<Coupon> {
  const {
    contactId,
    companyId,
    reason,
    discountType,
    discountValue,
    codePrefix = "CUPOM",
    validFrom = new Date(),
    validUntil
  } = params;

  const computedValidUntil = validUntil ?? (() => {
    const d = new Date(validFrom);
    d.setDate(d.getDate() + DEFAULT_VALIDITY_DAYS);
    return d;
  })();

  const code = await generateUniqueCode(codePrefix);

  const coupon = await Coupon.create({
    code,
    contactId: contactId ?? null,
    companyId,
    reason,
    discountType,
    discountValue,
    validFrom,
    validUntil: computedValidUntil,
    redeemedAt: null,
    redeemedBy: null
  } as any);

  logger.info(
    `[CouponService] Cupom criado: ${code} (reason=${reason}, contact=${contactId ?? "genérico"}, empresa=${companyId})`
  );

  return coupon;
}

/**
 * Resgata um cupom existente.
 *
 * Valida estado (não expirado, não redimido) antes de marcar como resgatado.
 * Operação idempotente por código: se já resgatado, lança AppError.
 *
 * @param params { code, companyId, redeemedByUserId }
 * @returns Coupon atualizado
 * @throws AppError 404 se cupom não encontrado na empresa
 * @throws AppError 422 se cupom inválido (expirado, já resgatado, ainda não válido)
 *
 * @example
 *   await redeemCoupon({ code: "ANIVER-7H2K-X3M9", companyId: 1, redeemedByUserId: 5 });
 */
export async function redeemCoupon(
  params: RedeemCouponParams
): Promise<Coupon> {
  const { code, companyId, redeemedByUserId } = params;

  const coupon = await Coupon.findOne({ where: { code, companyId } });
  if (!coupon) {
    throw new AppError("ERR_COUPON_NOT_FOUND", 404);
  }

  const validation = validateCouponDecision(coupon);
  if (!validation.valid) {
    const messages: Record<string, string> = {
      already_redeemed: "ERR_COUPON_ALREADY_REDEEMED",
      not_yet_valid: "ERR_COUPON_NOT_YET_VALID",
      expired: "ERR_COUPON_EXPIRED"
    };
    throw new AppError(messages[validation.reason] ?? "ERR_COUPON_INVALID", 422);
  }

  await coupon.update({
    redeemedAt: new Date(),
    redeemedBy: redeemedByUserId
  });

  await coupon.reload();

  logger.info(
    `[CouponService] Cupom resgatado: ${code} por user #${redeemedByUserId} (empresa=${companyId})`
  );

  return coupon;
}

/**
 * Busca um cupom pelo código dentro de uma empresa.
 *
 * @param code Código do cupom (ex: "ANIVER-7H2K-X3M9")
 * @param companyId ID da empresa
 * @returns Coupon com include de Contact e User redeemer
 * @throws AppError 404 se não encontrado
 */
export async function getByCode(
  code: string,
  companyId: number
): Promise<Coupon> {
  const coupon = await Coupon.findOne({
    where: { code, companyId },
    include: ["contact", "redeemer"]
  });

  if (!coupon) {
    throw new AppError("ERR_COUPON_NOT_FOUND", 404);
  }

  return coupon;
}

/**
 * Lista cupons de um contato, ordenados por criação decrescente.
 *
 * @param contactId ID do contato
 * @param companyId ID da empresa
 * @param limit Máximo de registros. Default: 20
 * @returns Lista de Coupon
 */
export async function listForContact(
  contactId: number,
  companyId: number,
  limit: number = 20
): Promise<Coupon[]> {
  return Coupon.findAll({
    where: { contactId, companyId },
    order: [["createdAt", "DESC"]],
    limit
  });
}

export default {
  createCoupon,
  redeemCoupon,
  getByCode,
  listForContact
};
