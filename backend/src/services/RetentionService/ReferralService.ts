/**
 * ReferralService — orquestração I/O do programa de indicação.
 *
 * Fase 4C do Módulo de Retenção.
 *
 * Fluxo completo:
 *   1. `getOrCreateReferralCode(contactId)` — entrega/gera código do cliente
 *   2. `registerReferral({ code, newContactId })` — registra Referral pending
 *   3. Quando o novo contato gera 1º ServiceHistory:
 *      → hook `convertReferralIfPending` marca outcome='converted'
 *      → gera 2 cupons (referrer + referred), envia 2 mensagens
 *
 * Lógica pura em `ReferralService.utils.ts`.
 */

import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Referral from "../../models/Referral";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";
import { createCoupon } from "./CouponService";
import { CouponDiscountType } from "../../models/Coupon";
import {
  generateReferralCode,
  validateReferralRegistration,
  buildReferrerThanksMessage,
  buildReferredWelcomeMessage
} from "./ReferralService.utils";
import {
  addDays,
  formatDiscountLabel,
  safeCouponDiscountType,
  getActiveWhatsapp
} from "./_shared";

// ── Constantes ─────────────────────────────────────────────────────

const MAX_CODE_GEN_ATTEMPTS = 5;
const DEFAULT_DISCOUNT_VALUE = 15;
const DEFAULT_DISCOUNT_TYPE: CouponDiscountType = "percent";
const DEFAULT_VALIDITY_DAYS = 60;

async function loadReferralConfig(companyId: number) {
  const [
    enabledSetting,
    referrerTpl,
    referredTpl,
    discountTypeSetting,
    discountValueSetting,
    validDaysSetting
  ] = await Promise.all([
    Setting.findOne({ where: { key: "referralEnabled", companyId } }),
    Setting.findOne({ where: { key: "referralReferrerMessage", companyId } }),
    Setting.findOne({ where: { key: "referralReferredMessage", companyId } }),
    Setting.findOne({ where: { key: "referralDiscountType", companyId } }),
    Setting.findOne({ where: { key: "referralDiscountValue", companyId } }),
    Setting.findOne({ where: { key: "referralValidDays", companyId } })
  ]);

  const enabled = enabledSetting?.value === "enabled";
  const discountType = safeCouponDiscountType(discountTypeSetting?.value, DEFAULT_DISCOUNT_TYPE);
  const discountValue = parseFloat(discountValueSetting?.value || String(DEFAULT_DISCOUNT_VALUE));
  const validDays = parseInt(validDaysSetting?.value || String(DEFAULT_VALIDITY_DAYS), 10);

  return {
    enabled,
    referrerTemplate: referrerTpl?.value,
    referredTemplate: referredTpl?.value,
    discountType,
    discountValue: isNaN(discountValue) ? DEFAULT_DISCOUNT_VALUE : discountValue,
    validDays: isNaN(validDays) || validDays <= 0 ? DEFAULT_VALIDITY_DAYS : validDays
  };
}

// ── 1. getOrCreateReferralCode ─────────────────────────────────────

/**
 * Entrega o código de indicação do contato. Gera preguiçosamente se não existir.
 *
 * @param contactId ID do contato
 * @param companyId ID da empresa (para validação)
 * @returns Código (ex: "INDICA-A2B3C4")
 * @throws AppError 404 se contato não encontrado
 */
export async function getOrCreateReferralCode(
  contactId: number,
  companyId: number
): Promise<string> {
  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) throw new AppError("ERR_CONTACT_NOT_FOUND", 404);

  if (contact.referralCode) return contact.referralCode;

  // BUG-FIX H1: atomic update via WHERE id=? AND referralCode IS NULL
  // Evita race onde duas requisições concorrentes geram códigos diferentes
  // para o mesmo contato. Se outra request ganhou a corrida, retornamos o
  // valor dela (re-read).
  for (let attempt = 1; attempt <= MAX_CODE_GEN_ATTEMPTS; attempt++) {
    const candidate = generateReferralCode();

    // Verifica colisão GLOBAL (alfabeto pequeno)
    const existing = await Contact.findOne({
      where: { referralCode: candidate }
    });
    if (existing) {
      logger.warn(`[Referral] Colisão de código (tentativa ${attempt}): ${candidate}`);
      continue;
    }

    // Atualização atômica: só atribui se ainda for NULL
    const [affected] = await Contact.update(
      { referralCode: candidate },
      { where: { id: contactId, referralCode: null as any } }
    );

    if (affected === 1) {
      logger.info(`[Referral] Código gerado para contato ${contactId}: ${candidate}`);
      return candidate;
    }

    // Perdemos a corrida — outra request setou. Re-lê e retorna.
    const refreshed = await Contact.findByPk(contactId);
    if (refreshed?.referralCode) {
      logger.info(`[Referral] Código já gerado por request paralela: ${refreshed.referralCode}`);
      return refreshed.referralCode;
    }
    // Caso muito raro: update afetou 0 e referralCode ainda NULL — tenta de novo.
  }

  throw new Error("[Referral] Falha ao gerar código único após múltiplas tentativas");
}

// ── 2. registerReferral ────────────────────────────────────────────

export interface RegisterReferralParams {
  /** Código de indicação fornecido pelo novo contato */
  referralCode: string;
  /** ID do novo contato */
  referredContactId: number;
  companyId: number;
}

/**
 * Registra uma indicação pendente. Idempotente:
 *   - Se já existe Referral para `referredContactId`, lança AppError 409.
 *   - Validações de auto-indicação e mesma empresa.
 *
 * @returns Referral criado (pending)
 * @throws AppError 404 se código não encontrado
 * @throws AppError 422 se validação falha
 * @throws AppError 409 se já existe indicação para este contato
 */
export async function registerReferral(
  params: RegisterReferralParams
): Promise<Referral> {
  const { referralCode, referredContactId, companyId } = params;

  // Busca o referrer pelo código
  const referrer = await Contact.findOne({
    where: { referralCode, companyId }
  });
  if (!referrer) throw new AppError("ERR_REFERRAL_CODE_NOT_FOUND", 404);

  // Busca o novo contato
  const referred = await Contact.findOne({
    where: { id: referredContactId, companyId }
  });
  if (!referred) throw new AppError("ERR_CONTACT_NOT_FOUND", 404);

  // Valida via função pura
  const validation = validateReferralRegistration({
    referrerContactId: referrer.id,
    referredContactId: referred.id,
    referrerCompanyId: referrer.companyId,
    referredCompanyId: referred.companyId
  });
  if (!validation.valid) {
    const messages: Record<string, string> = {
      self_referral: "ERR_REFERRAL_SELF",
      different_companies: "ERR_REFERRAL_DIFFERENT_COMPANIES",
      missing_data: "ERR_REFERRAL_MISSING_DATA"
    };
    throw new AppError(messages[validation.reason] ?? "ERR_REFERRAL_INVALID", 422);
  }

  // Cria o Referral — UNIQUE constraint protege contra duplicatas
  try {
    const referral = await Referral.create({
      referrerContactId: referrer.id,
      referredContactId: referred.id,
      companyId,
      referralCode,
      outcome: "pending"
    } as any);

    logger.info(
      `[Referral] Registrado: referrer ${referrer.id} → referred ${referred.id} ` +
      `(code: ${referralCode}, empresa: ${companyId})`
    );

    return referral;
  } catch (err: any) {
    if (err?.name === "SequelizeUniqueConstraintError") {
      throw new AppError("ERR_REFERRAL_ALREADY_EXISTS", 409);
    }
    throw err;
  }
}

// ── 3. convertReferralIfPending (hook) ─────────────────────────────

/**
 * Hook chamado quando o `referredContact` cria seu PRIMEIRO ServiceHistory.
 *
 * Marca o Referral como 'converted', gera cupons para ambos os lados,
 * envia mensagens. Idempotente: se já está 'converted', retorna sem ação.
 *
 * NÃO LANÇA exceções — erros são logados.
 */
export async function convertReferralIfPending(
  referredContactId: number,
  companyId: number
): Promise<void> {
  try {
    const referral = await Referral.findOne({
      where: { referredContactId, companyId, outcome: "pending" }
    });
    if (!referral) return;

    const config = await loadReferralConfig(companyId);
    if (!config.enabled) {
      // Marca como expired para não tentar de novo
      await referral.update({ outcome: "expired" });
      logger.info(`[Referral] #${referral.id} marcado expired (programa desabilitado)`);
      return;
    }

    // BUG-FIX H6: atomic claim. Marcamos converted ANTES de gerar cupons,
    // para evitar que duas execuções paralelas (ex: webhook retry) gerem
    // 4 cupons em vez de 2.
    const [affected] = await Referral.update(
      { outcome: "converted", convertedAt: new Date() },
      { where: { id: referral.id, outcome: "pending" } }
    );
    if (affected !== 1) {
      logger.info(
        `[Referral] #${referral.id} já convertido por outra execução — pulando`
      );
      return;
    }

    // Carrega contatos
    const [referrer, referred] = await Promise.all([
      Contact.findByPk(referral.referrerContactId),
      Contact.findByPk(referral.referredContactId)
    ]);
    if (!referrer || !referred) {
      logger.warn(`[Referral] Contato(s) ausente(s) em referral #${referral.id}`);
      return;
    }

    // Gera 2 cupons (já claimado — seguro contra duplicação)
    const validFrom = new Date();
    const validUntil = addDays(validFrom, config.validDays);

    const [referrerCoupon, referredCoupon] = await Promise.all([
      createCoupon({
        contactId: referrer.id,
        companyId,
        reason: "referral",
        discountType: config.discountType,
        discountValue: config.discountValue,
        codePrefix: "INDICA",
        validFrom,
        validUntil
      }),
      createCoupon({
        contactId: referred.id,
        companyId,
        reason: "referral",
        discountType: config.discountType,
        discountValue: config.discountValue,
        codePrefix: "AMIGO",
        validFrom,
        validUntil
      })
    ]);

    // Atualiza os IDs dos cupons no referral (já está converted)
    await referral.update({
      referrerCouponId: referrerCoupon.id,
      referredCouponId: referredCoupon.id
    });

    // Tenta enviar mensagens (best-effort)
    const { whatsapp, wbotAvailable } = await getActiveWhatsapp(companyId, "[Referral]");

    if (wbotAvailable && whatsapp) {
      const discountLabel = formatDiscountLabel(config.discountType, config.discountValue);

      // Mensagem para referrer (se não tem opt-out)
      if (!referrer.marketingOptOut) {
        try {
          const msg = buildReferrerThanksMessage({
            contactName: referrer.name,
            relatedContactName: referred.name,
            couponCode: referrerCoupon.code,
            discountLabel,
            validDays: config.validDays,
            template: config.referrerTemplate
          });
          const ticket = await FindOrCreateTicketService(
            referrer, whatsapp.id!, 0, companyId
          );
          await SendWhatsAppMessage({
            body: formatBody(msg, referrer),
            ticket
          });
        } catch (err) {
          logger.error(`[Referral] Falha ao enviar para referrer ${referrer.id}:`, err);
        }
      }

      // Mensagem para referred (se não tem opt-out)
      if (!referred.marketingOptOut) {
        try {
          const msg = buildReferredWelcomeMessage({
            contactName: referred.name,
            couponCode: referredCoupon.code,
            discountLabel,
            validDays: config.validDays,
            template: config.referredTemplate
          });
          const ticket = await FindOrCreateTicketService(
            referred, whatsapp.id!, 0, companyId
          );
          await SendWhatsAppMessage({
            body: formatBody(msg, referred),
            ticket
          });
        } catch (err) {
          logger.error(`[Referral] Falha ao enviar para referred ${referred.id}:`, err);
        }
      }
    }

    logger.info(
      `[Referral] #${referral.id} convertido: ${referrer.name} indicou ${referred.name} ` +
      `(cupons: ${referrerCoupon.code} + ${referredCoupon.code})`
    );
  } catch (err) {
    logger.error("[Referral] Erro inesperado em convertReferralIfPending:", err);
  }
}

// ── 4. Funções de leitura ──────────────────────────────────────────

/**
 * Lista todas as indicações feitas por um contato.
 */
export async function listReferralsByReferrer(
  referrerContactId: number,
  companyId: number
): Promise<Referral[]> {
  return Referral.findAll({
    where: { referrerContactId, companyId },
    order: [["createdAt", "DESC"]]
  });
}

/**
 * Sumário de indicações do contato: total, convertidas, taxa.
 */
export async function getReferralSummary(
  referrerContactId: number,
  companyId: number
): Promise<{
  total: number;
  converted: number;
  pending: number;
  conversionRate: number;
}> {
  const referrals = await Referral.findAll({
    where: { referrerContactId, companyId }
  });
  const converted = referrals.filter(r => r.outcome === "converted").length;
  const pending = referrals.filter(r => r.outcome === "pending").length;
  return {
    total: referrals.length,
    converted,
    pending,
    conversionRate: referrals.length > 0
      ? Math.round((converted / referrals.length) * 100)
      : 0
  };
}

export default {
  getOrCreateReferralCode,
  registerReferral,
  convertReferralIfPending,
  listReferralsByReferrer,
  getReferralSummary
};
