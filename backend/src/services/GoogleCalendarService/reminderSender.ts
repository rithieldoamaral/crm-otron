/**
 * reminderSender — envia lembretes de agendamento via WhatsApp.
 * Executado pelo cron a cada 5 minutos.
 * Configurável por empresa: lembrete 1 dia antes e/ou 15 minutos antes.
 */

import { Op } from "sequelize";
import Company from "../../models/Company";
import Schedule from "../../models/Schedule";
import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import Contact from "../../models/Contact";
import Service from "../../models/Service";
import User from "../../models/User";
import { getWbot } from "../../libs/wbot";
import { registerPendingReminder } from "./reminderHandler";
import { logger } from "../../utils/logger";

async function getCompanyReminderSettings(companyId: number) {
  const rows = await Setting.findAll({ where: { companyId } });
  const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  return {
    dayBefore: map.calendarReminderDayBefore === "true",
    fifteenMin: map.calendarReminder15min === "true"
  };
}

async function sendReminderMessage(
  companyId: number,
  contactNumber: string,
  message: string,
  scheduleId: number,
  googleEventId?: string
): Promise<void> {
  const whatsapp = await Whatsapp.findOne({ where: { companyId, isAgentChannel: true } });
  if (!whatsapp) return;

  try {
    const wbot = getWbot(whatsapp.id);
    await wbot.sendMessage(`${contactNumber}@s.whatsapp.net`, { text: message });
    await registerPendingReminder(companyId, contactNumber, scheduleId, googleEventId);
    await (await Schedule.findByPk(scheduleId))?.update({ reminderSentAt: new Date() } as any);
  } catch (err: any) {
    logger.warn(`ReminderSender: failed to send to ${contactNumber}: ${err.message}`);
  }
}

/**
 * Verifica e envia lembretes para todos os agendamentos pendentes.
 * Chamado pelo cron a cada 5 minutos.
 */
export async function runReminderSender(): Promise<void> {
  try {
    const companies = await Company.findAll({ where: { status: true } });

    for (const company of companies as any[]) {
      const settings = await getCompanyReminderSettings(company.id);
      if (!settings.dayBefore && !settings.fifteenMin) continue;

      const windows: Date[] = [];
      const now = new Date();

      if (settings.dayBefore) {
        // Amanhã às 9h — envia hoje entre 8h55 e 9h05
        const tomorrow9h = new Date(now);
        tomorrow9h.setDate(tomorrow9h.getDate() + 1);
        tomorrow9h.setHours(9, 0, 0, 0);
        if (Math.abs(now.getHours() * 60 + now.getMinutes() - 9 * 60) < 5) {
          windows.push(tomorrow9h);
        }
      }

      if (settings.fifteenMin) {
        const in15 = new Date(now.getTime() + 15 * 60 * 1000);
        windows.push(in15);
      }

      for (const targetTime of windows) {
        const windowStart = new Date(targetTime.getTime() - 5 * 60 * 1000);
        const windowEnd = new Date(targetTime.getTime() + 5 * 60 * 1000);

        const schedules = await Schedule.findAll({
          where: {
            companyId: company.id,
            status: "PENDENTE",
            reminderSentAt: null,
            sendAt: { [Op.between]: [windowStart, windowEnd] as any }
          },
          include: [
            { model: Contact, as: "contact", attributes: ["name", "number"] },
            { model: Service, as: "service", attributes: ["name"] },
            { model: User, as: "user", attributes: ["name"] }
          ]
        });

        for (const schedule of schedules as any[]) {
          const s = schedule;
          const date = new Date(s.sendAt);
          const dateStr = date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
          const timeStr = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          const serviceName = s.service?.name ?? s.body ?? "seu horário";
          const profName = s.user?.name ?? "nosso profissional";

          const msg = `Olá ${s.contact?.name}! 👋\n\nLembrete: seu agendamento de *${serviceName}* com *${profName}* é ${dateStr} às *${timeStr}*.\n\nConfirme respondendo *SIM* ou cancele com *NÃO*.`;

          await sendReminderMessage(
            company.id,
            s.contact?.number,
            msg,
            s.id,
            s.googleEventId
          );
        }
      }
    }
  } catch (err: any) {
    logger.error(`ReminderSender fatal error: ${err.message}`);
  }
}
