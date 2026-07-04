/**
 * PreventiveReminderService — orquestração I/O do lembrete preventivo.
 *
 * Fase 3A do Módulo de Retenção.
 *
 * Dispara uma mensagem proativa quando o cliente atinge 80% do seu intervalo
 * médio entre serviços (status "quase_na_hora" do DormantDetectionService),
 * antes de virar "atrasado". Objetivo: capturar o cliente ANTES da dormência.
 *
 * Idempotência por design via UNIQUE(contactId, baselineHistoryId) na tabela
 * PreventiveTouches. Quando o cliente volta e cria novo ServiceHistory, o
 * baselineHistoryId muda e libera novo toque em ciclos futuros.
 *
 * Configurações lidas de Setting (por empresa):
 *   - preventiveReminderEnabled  → "enabled" / "disabled"
 *   - preventiveReminderTime     → "HH:mm" (default: "10:00")
 *   - preventiveReminderMessage  → template com {{name}}, {{dias}}
 *   - preventiveReminderThreshold → ratio min (default: 0.8)
 *
 * Lógica pura em `PreventiveReminderService.utils.ts`.
 */

import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Company from "../../models/Company";
import PreventiveTouch from "../../models/PreventiveTouch";
import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";
import { classify } from "./DormantDetectionService";
import { listForContact } from "./ServiceHistoryService";
import {
  shouldFirePreventive,
  buildPreventiveMessage,
  DEFAULT_PREVENTIVE_THRESHOLD
} from "./PreventiveReminderService.utils";
import {
  isWithinFireWindow,
  getActiveWhatsapp,
  getCompanyTimezone
} from "./_shared";

// ── Constantes ─────────────────────────────────────────────────────

const HISTORY_FETCH_LIMIT = 50;

// ── Helpers internos ───────────────────────────────────────────────

/**
 * Parseia o threshold do Setting de forma defensiva.
 * Aceita "0.8", "0.85", etc. Fallback para default em caso de erro.
 */
function parseThreshold(raw: string | undefined): number {
  if (!raw) return DEFAULT_PREVENTIVE_THRESHOLD;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0 || parsed >= 1) {
    logger.warn(
      `[PreventiveReminder] Threshold inválido: ${raw} — usando default ${DEFAULT_PREVENTIVE_THRESHOLD}`
    );
    return DEFAULT_PREVENTIVE_THRESHOLD;
  }
  return parsed;
}

// ── Processamento por contato ──────────────────────────────────────

/**
 * Processa um único contato: classifica, decide se dispara, envia e persiste.
 *
 * @returns true se enviou, false se não disparou
 */
async function processContact(
  contact: Contact,
  whatsappId: number,
  companyId: number,
  template: string | undefined,
  threshold: number
): Promise<boolean> {
  // Busca histórico do contato
  const history = await listForContact({
    contactId: contact.id,
    companyId,
    limit: HISTORY_FETCH_LIMIT
  });

  if (history.length === 0) return false;

  // Classifica
  const classification = classify(history);

  // Pega o último ServiceHistory como baseline para idempotência
  const lastHistory = history[0]; // listForContact ordena DESC
  const baselineHistoryId = lastHistory?.id ?? null;

  // Verifica se já existe toque preventivo para este ciclo
  const existingTouch = await PreventiveTouch.findOne({
    where: { contactId: contact.id, baselineHistoryId }
  });

  // Decide via função pura
  const shouldFire = shouldFirePreventive(
    {
      status: classification.status,
      ratio: classification.ratio,
      alreadyTouchedThisCycle: !!existingTouch,
      totalServices: classification.totalServices
    },
    threshold
  );

  if (!shouldFire) return false;

  // Monta mensagem
  const message = buildPreventiveMessage({
    contactName: contact.name,
    template,
    daysSinceLastService: classification.daysSinceLastService
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

  // Persiste toque (UNIQUE garante que duplicatas sejam rejeitadas)
  await PreventiveTouch.create({
    contactId: contact.id,
    companyId,
    baselineHistoryId,
    sentAt: new Date(),
    ratioAtSend: classification.ratio,
    daysSinceLastService: classification.daysSinceLastService
  } as any);

  logger.info(
    `[PreventiveReminder] Toque enviado para ${contact.name} ` +
    `(ID: ${contact.id}, empresa: ${companyId}, ratio: ${classification.ratio.toFixed(2)}, ` +
    `dias: ${classification.daysSinceLastService})`
  );

  return true;
}

// ── Processamento por empresa ──────────────────────────────────────

async function processCompany(companyId: number): Promise<void> {
  // ── 1. Habilitação (cheap — 1 query) ─────────────────────────────
  const enabledSetting = await Setting.findOne({
    where: { key: "preventiveReminderEnabled", companyId, value: "enabled" }
  });
  if (!enabledSetting) return;

  // ── 2. Horário + timezone (cheap — 2 queries, mas barram cedo) ──
  // BUG-FIX H3/H4: checar janela ANTES de carregar contatos.
  const [timeSetting, timezone] = await Promise.all([
    Setting.findOne({ where: { key: "preventiveReminderTime", companyId } }),
    getCompanyTimezone(companyId)
  ]);
  const configuredTime = String(timeSetting?.value || "10:00");
  if (!isWithinFireWindow(configuredTime, timezone)) return;

  // ── 3. Demais configs (só carrega se estamos na janela) ─────────
  const [messageSetting, thresholdSetting] = await Promise.all([
    Setting.findOne({ where: { key: "preventiveReminderMessage", companyId } }),
    Setting.findOne({ where: { key: "preventiveReminderThreshold", companyId } })
  ]);
  const template = messageSetting?.value;
  const threshold = parseThreshold(thresholdSetting?.value);

  // ── 4. WhatsApp conectado ────────────────────────────────────────
  const { whatsapp, wbotAvailable } = await getActiveWhatsapp(
    companyId,
    "[PreventiveReminder]"
  );
  if (!whatsapp || !wbotAvailable) return;

  // ── 5. Busca contatos candidatos ─────────────────────────────────
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
      const sent = await processContact(
        contact,
        whatsapp.id!,
        companyId,
        template,
        threshold
      );
      if (sent) sentCount++;
    } catch (err) {
      logger.error(
        `[PreventiveReminder] Erro no contato ${contact.id} (${contact.name}):`,
        err
      );
    }
  }

  if (sentCount > 0) {
    logger.info(
      `[PreventiveReminder] Empresa ${companyId}: ${sentCount} toque(s) preventivo(s) enviado(s)`
    );
  }
}

// ── Função principal ───────────────────────────────────────────────

/**
 * Serviço de lembrete preventivo. Chamado pelo cron a cada minuto.
 * Idempotente por design via UNIQUE constraint na tabela PreventiveTouches.
 *
 * @example
 *   // Em server.ts:
 *   cron.schedule("* * * * *", () => PreventiveReminderService());
 */
const PreventiveReminderService = async (): Promise<void> => {
  try {
    const companies = await Company.findAll({ attributes: ["id"] });

    for (const company of companies) {
      try {
        await processCompany(company.id);
      } catch (err) {
        logger.error(
          `[PreventiveReminder] Erro ao processar empresa ${company.id}:`,
          err
        );
      }
    }
  } catch (err) {
    logger.error("[PreventiveReminder] Erro fatal:", err);
  }
};

export default PreventiveReminderService;
