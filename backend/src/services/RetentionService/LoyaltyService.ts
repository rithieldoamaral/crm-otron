/**
 * LoyaltyService — orquestração I/O do programa de fidelidade.
 *
 * Fase 3B do Módulo de Retenção.
 *
 * Conceito: a cada N serviços completados (5, 10, 20, etc), o cliente
 * recebe automaticamente um cupom de fidelidade + mensagem de parabéns.
 *
 * Integração: chamado como hook pelo `ServiceHistoryService.recordHistory`
 * imediatamente após criar um novo ServiceHistory. Isolado em try/catch:
 * falha no programa de fidelidade NÃO bloqueia o fluxo principal.
 *
 * Idempotência por design via UNIQUE(contactId, milestone) na tabela
 * LoyaltyRewards.
 *
 * Configurações lidas de Setting (por empresa):
 *   - loyaltyEnabled        → "enabled" / "disabled"
 *   - loyaltyMilestones     → CSV (default: "5,10,20,50,100")
 *   - loyaltyMessage        → template
 *   - loyaltyDiscountType   → "percent" / "fixed" / "free_service"
 *   - loyaltyDiscountValue  → número
 *   - loyaltyValidDays      → dias de validade do cupom (default: 60)
 *
 * Lógica pura em `LoyaltyService.utils.ts`.
 */

import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import LoyaltyReward from "../../models/LoyaltyReward";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";
import { createCoupon } from "./CouponService";
import { CouponDiscountType } from "../../models/Coupon";
import {
  parseMilestones,
  getNewlyReachedMilestones,
  buildLoyaltyMessage,
  DEFAULT_MILESTONES
} from "./LoyaltyService.utils";
import {
  addDays,
  safeCouponDiscountType,
  getActiveWhatsapp
} from "./_shared";

// ── Constantes ─────────────────────────────────────────────────────

const DEFAULT_VALIDITY_DAYS = 60;
const DEFAULT_DISCOUNT_TYPE: CouponDiscountType = "percent";
const DEFAULT_DISCOUNT_VALUE = 15;

// ── Helpers internos ───────────────────────────────────────────────

/**
 * Lê as configurações de fidelidade da empresa em paralelo.
 */
async function loadLoyaltyConfig(companyId: number) {
  const [
    enabledSetting,
    milestonesSetting,
    messageSetting,
    discountTypeSetting,
    discountValueSetting,
    validDaysSetting
  ] = await Promise.all([
    Setting.findOne({ where: { key: "loyaltyEnabled", companyId } }),
    Setting.findOne({ where: { key: "loyaltyMilestones", companyId } }),
    Setting.findOne({ where: { key: "loyaltyMessage", companyId } }),
    Setting.findOne({ where: { key: "loyaltyDiscountType", companyId } }),
    Setting.findOne({ where: { key: "loyaltyDiscountValue", companyId } }),
    Setting.findOne({ where: { key: "loyaltyValidDays", companyId } })
  ]);

  const enabled = enabledSetting?.value === "enabled";
  const milestonesRaw = milestonesSetting?.value;
  const parsed = parseMilestones(milestonesRaw);
  const milestones = parsed.length > 0 ? parsed : DEFAULT_MILESTONES;

  const discountType = safeCouponDiscountType(discountTypeSetting?.value, DEFAULT_DISCOUNT_TYPE);
  const discountValue = parseFloat(discountValueSetting?.value || String(DEFAULT_DISCOUNT_VALUE));
  const validDays = parseInt(validDaysSetting?.value || String(DEFAULT_VALIDITY_DAYS), 10);

  return {
    enabled,
    milestones,
    template: messageSetting?.value,
    discountType,
    discountValue: isNaN(discountValue) ? DEFAULT_DISCOUNT_VALUE : discountValue,
    validDays: isNaN(validDays) || validDays <= 0 ? DEFAULT_VALIDITY_DAYS : validDays
  };
}

// ── Função pública: hook após novo ServiceHistory ──────────────────

export interface CheckLoyaltyParams {
  contactId: number;
  companyId: number;
  /** Total de serviços ANTES de criar este novo (para detectar marco) */
  previousTotal: number;
  /** Total atual (após criar) */
  totalServices: number;
}

/**
 * Verifica se o cliente atingiu um marco de fidelidade e, em caso positivo,
 * gera cupom e envia mensagem. Idempotente via UNIQUE constraint.
 *
 * **NÃO LANÇA EXCEÇÕES** — qualquer erro é logado mas não propagado.
 * O fluxo principal de criação de ServiceHistory NÃO pode quebrar por
 * causa desta feature lateral.
 *
 * @param params { contactId, companyId, previousTotal, totalServices }
 * @returns Lista de marcos efetivamente recompensados (vazio se nenhum)
 */
export async function checkAndAwardLoyalty(
  params: CheckLoyaltyParams
): Promise<number[]> {
  const awardedMilestones: number[] = [];

  try {
    const { contactId, companyId, previousTotal, totalServices } = params;

    // ── 1. Carrega config ──────────────────────────────────────────
    const config = await loadLoyaltyConfig(companyId);
    if (!config.enabled) return awardedMilestones;

    // ── 2. Busca marcos já recompensados ───────────────────────────
    const existingRewards = await LoyaltyReward.findAll({
      where: { contactId, companyId },
      attributes: ["milestone"]
    });
    const alreadyRewarded = existingRewards.map(r => r.milestone);

    // ── 3. Decide via função pura ──────────────────────────────────
    const newlyReached = getNewlyReachedMilestones(
      totalServices,
      previousTotal,
      config.milestones,
      alreadyRewarded
    );

    if (newlyReached.length === 0) return awardedMilestones;

    // ── 4. Para cada marco novo, gera cupom + envia mensagem ───────
    const contact = await Contact.findOne({ where: { id: contactId, companyId } });
    if (!contact) {
      logger.warn(`[Loyalty] Contato ${contactId} não encontrado (empresa ${companyId})`);
      return awardedMilestones;
    }

    if (contact.marketingOptOut) {
      logger.info(
        `[Loyalty] Contato ${contactId} (${contact.name}) tem opt-out — registrando recompensa sem envio`
      );
      // Mesmo com opt-out, registra a recompensa (cliente pode descobrir depois)
      // mas SEM enviar mensagem
      for (const milestone of newlyReached) {
        try {
          const coupon = await createCoupon({
            contactId,
            companyId,
            reason: "loyalty",
            discountType: config.discountType,
            discountValue: config.discountValue,
            codePrefix: "FIEL",
            validUntil: addDays(new Date(), config.validDays)
          });
          await LoyaltyReward.create({
            contactId,
            companyId,
            milestone,
            couponId: coupon.id,
            awardedAt: new Date()
          } as any);
          awardedMilestones.push(milestone);
        } catch (err) {
          logger.error(`[Loyalty] Falha ao registrar marco ${milestone} (opt-out):`, err);
        }
      }
      return awardedMilestones;
    }

    // ── WhatsApp conectado ────────────────────────────────────────
    const { whatsapp, wbotAvailable } = await getActiveWhatsapp(companyId, "[Loyalty]");

    // ── Para cada marco: cupom + mensagem (se WhatsApp ativo) ──────
    for (const milestone of newlyReached) {
      try {
        const coupon = await createCoupon({
          contactId,
          companyId,
          reason: "loyalty",
          discountType: config.discountType,
          discountValue: config.discountValue,
          codePrefix: "FIEL",
          validUntil: addDays(new Date(), config.validDays)
        });

        if (wbotAvailable && whatsapp) {
          const message = buildLoyaltyMessage({
            contactName: contact.name,
            milestone,
            couponCode: coupon.code,
            template: config.template
          });

          const ticket = await FindOrCreateTicketService(
            contact,
            whatsapp.id!,
            0,
            companyId
          );

          await SendWhatsAppMessage({
            body: formatBody(message, contact),
            ticket
          });
        }

        await LoyaltyReward.create({
          contactId,
          companyId,
          milestone,
          couponId: coupon.id,
          awardedAt: new Date()
        } as any);

        awardedMilestones.push(milestone);

        logger.info(
          `[Loyalty] Marco ${milestone} entregue para ${contact.name} ` +
          `(ID: ${contactId}, empresa: ${companyId}, cupom: ${coupon.code})`
        );
      } catch (err: any) {
        // Tratamento específico para violação de UNIQUE (race condition)
        if (err?.name === "SequelizeUniqueConstraintError") {
          logger.info(
            `[Loyalty] Marco ${milestone} já existia para contato ${contactId} — ignorando duplicata`
          );
        } else {
          logger.error(
            `[Loyalty] Falha ao entregar marco ${milestone} (contato ${contactId}):`,
            err
          );
        }
      }
    }
  } catch (err) {
    logger.error("[Loyalty] Erro inesperado em checkAndAwardLoyalty:", err);
  }

  return awardedMilestones;
}

// ── Funções públicas de leitura ─────────────────────────────────────

/**
 * Lista todas as recompensas entregues a um contato.
 */
export async function listRewardsForContact(
  contactId: number,
  companyId: number
): Promise<LoyaltyReward[]> {
  return LoyaltyReward.findAll({
    where: { contactId, companyId },
    include: ["coupon"],
    order: [["awardedAt", "DESC"]]
  });
}

export default {
  checkAndAwardLoyalty,
  listRewardsForContact
};
