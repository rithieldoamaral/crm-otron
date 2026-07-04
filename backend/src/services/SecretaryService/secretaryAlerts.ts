/**
 * secretaryAlerts — alertas proativos do canal secretária.
 * Executa a cada 5 minutos via cron em server.ts.
 * Dois alertas: tickets esperando muito (waitAlert) e erros do agente (agentError).
 */

import { Op } from "sequelize";
import Company from "../../models/Company";
import Ticket from "../../models/Ticket";
import { getSettingsByCompany } from "../AgentService/settingsCache";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import { getWbot } from "../../libs/wbot";
import { logger } from "../../utils/logger";
import { canonicalizePhone } from "./phoneMatch";

interface CompanySettings {
  secretaryAdminNumbers: string[];
  secretaryAlertWaitMinutes: number;
  secretaryAlertAgentError: boolean;
}

async function loadCompanySettings(companyId: number): Promise<CompanySettings> {
  const rows = await getSettingsByCompany(companyId);
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const raw: string = map.secretaryAdminNumbers ?? "";
  const adminNumbers = raw.split(",").map((n: string) => n.trim()).filter(Boolean);

  return {
    adminNumbers,
    secretaryAdminNumbers: adminNumbers,
    secretaryAlertWaitMinutes: parseInt(map.secretaryAlertWaitMinutes ?? "0", 10) || 0,
    secretaryAlertAgentError: map.secretaryAlertAgentError === "enabled"
  } as any;
}

async function sendAlertToAdmins(
  whatsapp: Whatsapp,
  adminNumbers: string[],
  message: string
): Promise<void> {
  try {
    const wbot = getWbot(whatsapp.id);
    await Promise.all(
      adminNumbers.map(number => {
        // Canonicaliza o número antes de montar o JID de destino: o cadastro
        // pode ter o 9º dígito brasileiro (5548988368758) enquanto o JID real
        // do WhatsApp trafega sem ele (554888368758). Enviar na forma canônica
        // (sem o 9, com código de país) garante a entrega. Ver phoneMatch.ts.
        const jid = `${canonicalizePhone(number)}@s.whatsapp.net`;
        return wbot.sendMessage(jid, { text: message }).catch(err => {
          logger.warn(`SecretaryAlert: failed to send to ${number}: ${err.message}`);
        });
      })
    );
  } catch (err: any) {
    logger.warn(`SecretaryAlert: wbot not available for whatsapp ${whatsapp.id}: ${err.message}`);
  }
}

/**
 * Verifica tickets em espera há mais de X minutos e notifica o canal secretária.
 */
async function checkWaitAlerts(
  companyId: number,
  whatsapp: Whatsapp,
  settings: CompanySettings
): Promise<void> {
  if (settings.secretaryAlertWaitMinutes <= 0) return;

  const threshold = new Date(Date.now() - settings.secretaryAlertWaitMinutes * 60 * 1000);

  const waiting = await Ticket.findAll({
    where: {
      companyId,
      status: "open",
      updatedAt: { [Op.lt]: threshold }
    },
    include: [
      { model: Contact, as: "contact", attributes: ["name", "number"] },
      { model: Queue, as: "queue", attributes: ["name"] }
    ],
    limit: 10
  });

  if (waiting.length === 0) return;

  const lines = waiting.map((t: any) => {
    const mins = Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 60000);
    return `• #${t.id} ${t.contact?.name ?? "?"} — ${mins} min sem resposta${t.queue ? ` (${t.queue.name})` : ""}`;
  });

  const msg = `⏰ *Alerta de Espera*\n${waiting.length} atendimento(s) sem resposta:\n\n${lines.join("\n")}`;

  await sendAlertToAdmins(whatsapp, settings.secretaryAdminNumbers, msg);
}

/**
 * Detecta tickets que voltaram para pending recentemente (indicando erro do agente)
 * e notifica o canal secretária.
 */
async function checkAgentErrorAlerts(
  companyId: number,
  whatsapp: Whatsapp,
  settings: CompanySettings
): Promise<void> {
  if (!settings.secretaryAlertAgentError) return;

  // Tickets que foram para pending com chatbot:false nos últimos 5 minutos
  const recentThreshold = new Date(Date.now() - 5 * 60 * 1000);

  const failed = await Ticket.findAll({
    where: {
      companyId,
      status: "pending",
      chatbot: false,
      updatedAt: { [Op.gte]: recentThreshold }
    },
    include: [
      { model: Contact, as: "contact", attributes: ["name", "number"] }
    ],
    limit: 5
  });

  if (failed.length === 0) return;

  const lines = failed.map((t: any) => `• #${t.id} ${t.contact?.name ?? "?"}`);
  const msg = `⚠️ *Alerta de Erro do Agente*\n${failed.length} ticket(s) com falha do agente IA:\n\n${lines.join("\n")}\n\nVerifique as configurações do agente.`;

  await sendAlertToAdmins(whatsapp, settings.secretaryAdminNumbers, msg);
}

/**
 * Ponto de entrada chamado pelo cron a cada 5 minutos.
 * Processa todas as empresas com canal secretária ativo.
 */
export async function runSecretaryAlerts(): Promise<void> {
  try {
    const companies = await Company.findAll({ where: { status: true } });

    await Promise.all(
      companies.map(async (company: any) => {
        try {
          const whatsapp = await Whatsapp.findOne({
            where: { companyId: company.id, isSecretaryChannel: true }
          });

          if (!whatsapp) return;

          const settings = await loadCompanySettings(company.id);
          if (settings.secretaryAdminNumbers.length === 0) return;

          await Promise.all([
            checkWaitAlerts(company.id, whatsapp, settings),
            checkAgentErrorAlerts(company.id, whatsapp, settings)
          ]);
        } catch (err: any) {
          logger.error(`SecretaryAlerts error for company ${company.id}: ${err.message}`);
        }
      })
    );
  } catch (err: any) {
    logger.error(`SecretaryAlerts fatal error: ${err.message}`);
  }
}
