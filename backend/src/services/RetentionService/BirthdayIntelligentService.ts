/**
 * BirthdayIntelligentService — orquestração I/O do fluxo de 3 toques de aniversário.
 *
 * Fase 2 do Módulo de Retenção. Substitui BirthdayReminderService (D-0 apenas)
 * por um fluxo completo de 3 toques:
 *
 *   dm3 — D-3: antecipação, 3 dias antes do aniversário
 *   d0  — D-0: parabéns + geração de cupom único
 *   dp7 — D+7: follow-up com lembrete do cupom ainda disponível
 *
 * Idempotência garantida em nível de banco via:
 *   UNIQUE(contactId, year, touchType) na tabela BirthdayTouches.
 *
 * Lógica pura de datas e mensagens vive em `BirthdayService.utils.ts`
 * para ser testável sem ambiente de I/O.
 *
 * Diretiva: `directives/retencao_modulo.md` seção 8 (Aniversário Inteligente).
 */

import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Company from "../../models/Company";
import BirthdayTouch from "../../models/BirthdayTouch";
import Coupon from "../../models/Coupon";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";
import {
  extractMonthDay,
  getDayOffsetFromBirthday,
  whichTouchToFire,
  buildTouchMessage
} from "./BirthdayService.utils";
import { createCoupon } from "./CouponService";
import {
  isWithinFireWindow,
  getActiveWhatsapp,
  getCompanyTimezone
} from "./_shared";

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Validade do cupom de aniversário em dias a partir do D-0.
 * Deve ser ≥ 7 para que o D+7 ainda encontre o cupom válido.
 */
const BIRTHDAY_COUPON_VALIDITY_DAYS = 30;

/**
 * Calcula quantos dias restam de validade de um cupom.
 *
 * @param coupon Cupom com validUntil
 * @param now Data de referência (default: agora)
 * @returns Dias restantes (≥ 0)
 */
function daysUntilExpiry(coupon: Coupon, now: Date = new Date()): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const diff = coupon.validUntil.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / MS_PER_DAY));
}

// ── Processamento por toque ────────────────────────────────────────

/**
 * Processa um único toque para um contato.
 *
 * Fluxo:
 *   1. Verifica idempotência (BirthdayTouch já existe?)
 *   2. Para D-0: gera cupom antes de enviar
 *   3. Para D+7: busca cupom do D-0 para incluir na mensagem
 *   4. Monta mensagem e envia via WhatsApp
 *   5. Persiste BirthdayTouch
 *
 * @param contact Contato aniversariante
 * @param whatsappId ID do WhatsApp da empresa
 * @param companyId ID da empresa
 * @param year Ano do ciclo (ex: 2026)
 * @param touchType Qual dos 3 toques ("dm3" | "d0" | "dp7")
 * @param birthdayMessageTemplate Template D-0 configurado pelo admin
 */
async function processTouchForContact(
  contact: Contact,
  whatsappId: number,
  companyId: number,
  year: number,
  touchType: "dm3" | "d0" | "dp7",
  birthdayMessageTemplate: string
): Promise<void> {
  // ── 1. Idempotência via BirthdayTouch ────────────────────────────
  const alreadySent = await BirthdayTouch.findOne({
    where: { contactId: contact.id, companyId, year, touchType }
  });

  if (alreadySent) {
    logger.info(
      `[BirthdayIntelligent] Toque ${touchType} já enviado para ${contact.name} (${year}) — pulando`
    );
    return;
  }

  // ── 2. Preparação de cupom ───────────────────────────────────────
  let coupon: Coupon | null = null;
  let couponDaysLeft: number | undefined;

  if (touchType === "d0") {
    // Gera cupom de aniversário (D-0)
    const validFrom = new Date();
    const validUntil = new Date(validFrom);
    validUntil.setDate(validUntil.getDate() + BIRTHDAY_COUPON_VALIDITY_DAYS);

    coupon = await createCoupon({
      contactId: contact.id,
      companyId,
      reason: "birthday",
      discountType: "percent",
      discountValue: 10,
      codePrefix: "ANIVER",
      validFrom,
      validUntil
    });
  } else if (touchType === "dp7") {
    // Busca cupom do D-0 para incluir no follow-up
    const d0Touch = await BirthdayTouch.findOne({
      where: { contactId: contact.id, companyId, year, touchType: "d0" },
      include: ["coupon"]
    });

    if (d0Touch?.coupon) {
      coupon = d0Touch.coupon as Coupon;
      couponDaysLeft = daysUntilExpiry(coupon);
    }
  }

  // ── 3. Monta mensagem ────────────────────────────────────────────
  const message = buildTouchMessage({
    touchType,
    contactName: contact.name,
    birthdayMessageTemplate,
    couponCode: coupon?.code,
    couponDaysLeft
  });

  // ── 4. Busca/cria ticket e envia mensagem ────────────────────────
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

  // ── 5. Registra toque (idempotência futura) ──────────────────────
  await BirthdayTouch.create({
    contactId: contact.id,
    companyId,
    year,
    touchType,
    sentAt: new Date(),
    couponId: coupon?.id ?? null
  } as any);

  logger.info(
    `[BirthdayIntelligent] Toque ${touchType} enviado para ${contact.name} ` +
    `(ID: ${contact.id}, empresa: ${companyId}, ano: ${year})` +
    (coupon ? ` — cupom: ${coupon.code}` : "")
  );
}

// ── Função principal ───────────────────────────────────────────────

/**
 * Serviço de aniversário inteligente com 3 toques.
 *
 * Chamado pelo cron a cada minuto. Verifica se está no horário configurado
 * antes de processar cada empresa. Idempotente por design: re-executar
 * no mesmo dia não envia mensagens duplicadas.
 *
 * @example
 *   // Em server.ts:
 *   cron.schedule("* * * * *", () => BirthdayIntelligentService());
 */
const BirthdayIntelligentService = async (): Promise<void> => {
  try {
    // BUG-FIX H3: log per-minute foi removido. processCompany agora
    // sai cedo se não estiver na janela de disparo — sem barulho.
    const companies = await Company.findAll({ attributes: ["id"] });

    for (const company of companies) {
      try {
        await processCompany(company.id);
      } catch (err) {
        logger.error(
          `[BirthdayIntelligent] Erro ao processar empresa ${company.id}:`,
          err
        );
      }
    }
  } catch (err) {
    logger.error("[BirthdayIntelligent] Erro fatal no serviço:", err);
  }
};

/**
 * Processa todos os aniversários de uma empresa.
 *
 * Verifica settings, horário configurado, WhatsApp conectado e
 * itera sobre contatos com aniversário nos offsets esperados.
 *
 * @param companyId ID da empresa
 */
async function processCompany(companyId: number): Promise<void> {
  // ── 1. Habilitação (cheap — 1 query) ────────────────────────────
  const enabledSetting = await Setting.findOne({
    where: { key: "birthdayReminderEnabled", companyId, value: "enabled" }
  });
  if (!enabledSetting) return;

  // ── 2. Horário + timezone (BUG-FIX B3 + H3 — checar ANTES) ──────
  const [timeSetting, timezone] = await Promise.all([
    Setting.findOne({ where: { key: "birthdayReminderTime", companyId } }),
    getCompanyTimezone(companyId)
  ]);
  const configuredTime = String(timeSetting?.value || "09:00");
  if (!isWithinFireWindow(configuredTime, timezone)) return;

  // ── 3. Template D-0 ─────────────────────────────────────────────
  const messageSetting = await Setting.findOne({
    where: { key: "birthdayMessage", companyId }
  });
  if (!messageSetting?.value) {
    logger.warn(
      `[BirthdayIntelligent] Empresa ${companyId}: sem template de mensagem (birthdayMessage) — pulando`
    );
    return;
  }
  const birthdayMessageTemplate = messageSetting.value;

  // ── 4. WhatsApp conectado ───────────────────────────────────────
  const { whatsapp, wbotAvailable } = await getActiveWhatsapp(
    companyId,
    "[BirthdayIntelligent]"
  );
  if (!whatsapp || !wbotAvailable) return;

  // ── 5. Busca contatos com aniversário cadastrado ────────────────
  const contacts = await Contact.findAll({
    where: {
      companyId,
      birthday: { [Op.not]: null },
      active: true,
      isGroup: false,
      marketingOptOut: { [Op.not]: true }  // Respeita opt-out de marketing
    }
  });

  logger.info(
    `[BirthdayIntelligent] Empresa ${companyId}: ${contacts.length} contatos com aniversário cadastrado`
  );

  const now = new Date();
  const year = now.getUTCFullYear();

  for (const contact of contacts) {
    try {
      await processContact(
        contact,
        whatsapp.id!,
        companyId,
        year,
        now,
        birthdayMessageTemplate
      );
    } catch (err) {
      logger.error(
        `[BirthdayIntelligent] Erro ao processar contato ${contact.id} (${contact.name}):`,
        err
      );
    }
  }
}

/**
 * Determina qual toque disparar para um contato e o processa.
 *
 * @param contact Contato
 * @param whatsappId ID do WhatsApp
 * @param companyId ID da empresa
 * @param year Ano do ciclo
 * @param now Data atual de referência
 * @param birthdayMessageTemplate Template D-0
 */
async function processContact(
  contact: Contact,
  whatsappId: number,
  companyId: number,
  year: number,
  now: Date,
  birthdayMessageTemplate: string
): Promise<void> {
  // Extrai "MM-DD" do aniversário do contato
  const birthdayRaw = contact.getDataValue("birthday") as Date | string | null;
  const monthDay = extractMonthDay(birthdayRaw);

  if (!monthDay) {
    logger.warn(
      `[BirthdayIntelligent] Data de aniversário inválida para ${contact.name} (ID: ${contact.id}): ${birthdayRaw}`
    );
    return;
  }

  // Calcula offset e determina qual toque disparar
  const offset = getDayOffsetFromBirthday(monthDay, now);
  const touchType = whichTouchToFire(offset);

  if (!touchType) return; // Nenhum toque hoje para este contato

  logger.info(
    `[BirthdayIntelligent] ${contact.name}: aniversário ${monthDay}, offset ${offset} → toque ${touchType}`
  );

  await processTouchForContact(
    contact,
    whatsappId,
    companyId,
    year,
    touchType,
    birthdayMessageTemplate
  );
}

export default BirthdayIntelligentService;
