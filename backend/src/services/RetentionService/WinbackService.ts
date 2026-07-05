/**
 * WinbackService — orquestração I/O da campanha de reativação de perdidos.
 *
 * Fase 3C do Módulo de Retenção.
 *
 * Conceito: clientes classificados como "adormecido" ou "perdido" pelo
 * DormantDetectionService recebem uma mensagem de reativação automática
 * com cupom de alto valor (default: 20% OFF, 30 dias). Cooldown configurável
 * (default: 90 dias) evita spam.
 *
 * Idempotência: cooldown temporal (não UNIQUE constraint) porque um cliente
 * perdido pode receber múltiplas tentativas ao longo do tempo, mas espaçadas.
 *
 * Conversão: detectada via hook em ServiceHistoryService.recordHistory que
 * marca outcome='converted' quando o cliente volta após receber win-back.
 *
 * Configurações lidas de Setting (por empresa):
 *   - winbackEnabled         → "enabled" / "disabled"
 *   - winbackTime            → "HH:mm" (default: "11:00")
 *   - winbackMessage         → template
 *   - winbackDiscountType    → "percent" | "fixed" | "free_service"
 *   - winbackDiscountValue   → número
 *   - winbackValidDays       → dias de validade do cupom (default: 30)
 *   - winbackCooldownDays    → dias entre tentativas (default: 90)
 *
 * Lógica pura em `WinbackService.utils.ts`.
 */

import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Company from "../../models/Company";
import WinbackAttempt from "../../models/WinbackAttempt";
import ClientPackagePurchase from "../../models/ClientPackagePurchase";
import { hasActivePackage } from "../PackageService/PackageService.utils";
import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";
import { classify } from "./DormantDetectionService";
import { listForContact } from "./ServiceHistoryService";
import { createCoupon } from "./CouponService";
import { CouponDiscountType } from "../../models/Coupon";
import {
  shouldAttemptWinback,
  buildWinbackMessage,
  DEFAULT_WINBACK_COOLDOWN_DAYS,
  WINBACK_STATUSES
} from "./WinbackService.utils";
import {
  isWithinFireWindow,
  addDays,
  formatDiscountLabel,
  safeCouponDiscountType,
  getActiveWhatsapp,
  getCompanyTimezone
} from "./_shared";

// ── Constantes ─────────────────────────────────────────────────────

const DEFAULT_VALIDITY_DAYS = 30;
const DEFAULT_DISCOUNT_TYPE: CouponDiscountType = "percent";
const DEFAULT_DISCOUNT_VALUE = 20;
const HISTORY_FETCH_LIMIT = 50;

async function loadWinbackConfig(companyId: number) {
  const [
    enabledSetting,
    timeSetting,
    messageSetting,
    discountTypeSetting,
    discountValueSetting,
    validDaysSetting,
    cooldownSetting
  ] = await Promise.all([
    Setting.findOne({ where: { key: "winbackEnabled", companyId } }),
    Setting.findOne({ where: { key: "winbackTime", companyId } }),
    Setting.findOne({ where: { key: "winbackMessage", companyId } }),
    Setting.findOne({ where: { key: "winbackDiscountType", companyId } }),
    Setting.findOne({ where: { key: "winbackDiscountValue", companyId } }),
    Setting.findOne({ where: { key: "winbackValidDays", companyId } }),
    Setting.findOne({ where: { key: "winbackCooldownDays", companyId } })
  ]);

  const enabled = enabledSetting?.value === "enabled";
  const configuredTime = String(timeSetting?.value || "11:00");

  const discountType = safeCouponDiscountType(discountTypeSetting?.value, DEFAULT_DISCOUNT_TYPE);
  const discountValue = parseFloat(discountValueSetting?.value || String(DEFAULT_DISCOUNT_VALUE));
  const validDays = parseInt(validDaysSetting?.value || String(DEFAULT_VALIDITY_DAYS), 10);
  const cooldownDays = parseInt(
    cooldownSetting?.value || String(DEFAULT_WINBACK_COOLDOWN_DAYS),
    10
  );

  return {
    enabled,
    configuredTime,
    template: messageSetting?.value,
    discountType,
    discountValue: isNaN(discountValue) ? DEFAULT_DISCOUNT_VALUE : discountValue,
    validDays: isNaN(validDays) || validDays <= 0 ? DEFAULT_VALIDITY_DAYS : validDays,
    cooldownDays: isNaN(cooldownDays) || cooldownDays <= 0
      ? DEFAULT_WINBACK_COOLDOWN_DAYS
      : cooldownDays
  };
}

// ── Processamento por contato ──────────────────────────────────────

async function processContact(
  contact: Contact,
  whatsappId: number,
  companyId: number,
  config: Awaited<ReturnType<typeof loadWinbackConfig>>
): Promise<boolean> {
  // Busca histórico
  const history = await listForContact({
    contactId: contact.id,
    companyId,
    limit: HISTORY_FETCH_LIMIT
  });

  // Cliente sem histórico não é alvo de win-back
  if (history.length === 0) return false;

  // Classifica
  const classification = classify(history);

  // Filtro rápido: só processa status alvo
  if (!WINBACK_STATUSES.includes(classification.status)) return false;

  // Guard de pacote ativo (Tier 2): cliente que comprou um pacote e ainda tem
  // sessões (ex: 10 sessões, consumindo aos poucos) NÃO é adormecido/perdido de
  // verdade — o ServiceHistory só registra a receita na COMPRA (cash basis), não
  // nos consumos, então o algoritmo RFM-lite o vê "parado" e o marca perdido.
  // Disparar winback com desconto aqui é desnecessário e faz o cliente engajado
  // receber cupom que não precisa. Excluímos quem tem pacote ativo.
  const purchases = await ClientPackagePurchase.findAll({
    where: { contactId: contact.id, companyId },
    attributes: ["sessionsUsed", "totalSessions", "expiresAt", "status"]
  });
  if (hasActivePackage(purchases as any)) {
    logger.info(
      `[Winback] Contato ${contact.id} tem pacote ativo — winback ignorado ` +
      `(status retenção: ${classification.status})`
    );
    return false;
  }

  // Busca última tentativa
  const lastAttempt = await WinbackAttempt.findOne({
    where: { contactId: contact.id, companyId },
    order: [["sentAt", "DESC"]]
  });

  // Decide via função pura
  const shouldFire = shouldAttemptWinback(
    {
      status: classification.status,
      lastAttemptAt: lastAttempt?.sentAt ?? null,
      hasHistory: classification.totalServices > 0
    },
    config.cooldownDays
  );

  if (!shouldFire) return false;

  // Gera cupom
  const validFrom = new Date();
  const validUntil = addDays(validFrom, config.validDays);

  const coupon = await createCoupon({
    contactId: contact.id,
    companyId,
    reason: "reactivation",
    discountType: config.discountType,
    discountValue: config.discountValue,
    codePrefix: "VOLTA",
    validFrom,
    validUntil
  });

  // Monta mensagem
  const message = buildWinbackMessage({
    contactName: contact.name,
    couponCode: coupon.code,
    discountLabel: formatDiscountLabel(config.discountType, config.discountValue),
    validDays: config.validDays,
    template: config.template
  });

  // Envia
  const ticket = await FindOrCreateTicketService(
    contact,
    whatsappId,
    0,
    companyId
  );

  await SendWhatsAppMessage({
    body: formatBody(message, contact),
    ticket
  });

  // Persiste tentativa
  await WinbackAttempt.create({
    contactId: contact.id,
    companyId,
    couponId: coupon.id,
    sentAt: new Date(),
    outcome: "pending"
  } as any);

  logger.info(
    `[Winback] Tentativa enviada para ${contact.name} ` +
    `(ID: ${contact.id}, status: ${classification.status}, cupom: ${coupon.code})`
  );

  return true;
}

// ── Processamento por empresa ──────────────────────────────────────

async function processCompany(companyId: number): Promise<void> {
  // BUG-FIX H4: checagem rápida ANTES de carregar config inteira.
  const enabledSetting = await Setting.findOne({
    where: { key: "winbackEnabled", companyId, value: "enabled" }
  });
  if (!enabledSetting) return;

  const config = await loadWinbackConfig(companyId);
  const timezone = await getCompanyTimezone(companyId);
  if (!isWithinFireWindow(config.configuredTime, timezone)) return;

  const { whatsapp, wbotAvailable } = await getActiveWhatsapp(companyId, "[Winback]");
  if (!whatsapp || !wbotAvailable) return;

  const contacts = await Contact.findAll({
    where: {
      companyId,
      active: true,
      isGroup: false,
      marketingOptOut: { [Op.not]: true }
    }
  });

  let sentCount = 0;
  for (const contact of contacts) {
    try {
      const sent = await processContact(contact, whatsapp.id!, companyId, config);
      if (sent) sentCount++;
    } catch (err) {
      logger.error(`[Winback] Erro no contato ${contact.id}:`, err);
    }
  }

  if (sentCount > 0) {
    logger.info(`[Winback] Empresa ${companyId}: ${sentCount} tentativa(s) enviada(s)`);
  }
}

// ── Hook de conversão ──────────────────────────────────────────────

/**
 * Hook chamado quando um cliente cria novo ServiceHistory.
 * Se houver WinbackAttempt pending para este contato, marca como 'converted'.
 *
 * Não lança exceções — falhas são logadas mas não bloqueiam o fluxo principal.
 *
 * @param contactId ID do contato que acabou de voltar
 * @param companyId ID da empresa
 */
export async function markWinbackConverted(
  contactId: number,
  companyId: number
): Promise<void> {
  try {
    const pending = await WinbackAttempt.findOne({
      where: { contactId, companyId, outcome: "pending" },
      order: [["sentAt", "DESC"]]
    });

    if (!pending) return;

    await pending.update({
      outcome: "converted",
      convertedAt: new Date()
    });

    logger.info(
      `[Winback] Conversão registrada: contato ${contactId} voltou após tentativa #${pending.id}`
    );
  } catch (err) {
    logger.error("[Winback] Falha ao marcar conversão:", err);
  }
}

// ── Função principal ───────────────────────────────────────────────

const WinbackService = async (): Promise<void> => {
  try {
    const companies = await Company.findAll({ attributes: ["id"] });

    for (const company of companies) {
      try {
        await processCompany(company.id);
      } catch (err) {
        logger.error(`[Winback] Erro empresa ${company.id}:`, err);
      }
    }
  } catch (err) {
    logger.error("[Winback] Erro fatal:", err);
  }
};

export default WinbackService;
