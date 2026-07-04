/**
 * AutoCloseScheduledService — orquestração I/O.
 *
 * Lógica pura (decisão de fechar ou não) está em
 * `AutoCloseScheduledService.utils.ts` — separada para permitir testes
 * sem puxar UpdateTicketService → socket → JWT.
 *
 * Contexto: cliente agenda corte para 8h → ticket é aberto → 9h passa e
 * ninguém fechou → este serviço fecha automaticamente após o tempo configurado
 * (default 60 min) E registra um ServiceHistory (conta como visita realizada).
 *
 * Diretiva: `directives/retencao_modulo.md` seção 6.
 */

import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import Schedule from "../../models/Schedule";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import Setting from "../../models/Setting";
import ServiceHistory from "../../models/ServiceHistory";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import {
  shouldCloseSchedule,
  DEFAULT_AUTO_CLOSE_MINUTES,
  DEFAULT_INACTIVITY_WINDOW,
  AutoCloseConfig
} from "./AutoCloseScheduledService.utils";

// Re-export para conveniência
export {
  shouldCloseSchedule,
  DEFAULT_AUTO_CLOSE_MINUTES,
  DEFAULT_INACTIVITY_WINDOW,
  AutoCloseConfig
};

/**
 * Carrega config de auto-close para uma empresa. Lê settings do banco e
 * cai em defaults se não houver. Cacheada em memória durante o ciclo do cron.
 */
async function loadConfig(companyId: number): Promise<AutoCloseConfig> {
  const [closeMin, inactivity] = await Promise.all([
    Setting.findOne({ where: { companyId, key: "retention.autoCloseMinutes" } }),
    Setting.findOne({ where: { companyId, key: "retention.inactivityWindow" } })
  ]);

  return {
    autoCloseMinutes: closeMin?.value
      ? parseInt(closeMin.value, 10)
      : DEFAULT_AUTO_CLOSE_MINUTES,
    inactivityWindow: inactivity?.value
      ? parseInt(inactivity.value, 10)
      : DEFAULT_INACTIVITY_WINDOW
  };
}

/**
 * Função principal chamada pelo cron a cada 5 minutos.
 *
 * Para cada empresa ativa:
 *   1. Carrega config (autoCloseMinutes, inactivityWindow)
 *   2. Busca schedules elegíveis (sendAt < now - autoCloseMinutes, com ticketId)
 *   3. Para cada: aplica `shouldCloseSchedule`. Se sim, fecha + ServiceHistory.
 */
export async function runAutoCloseScheduled(): Promise<void> {
  const startedAt = Date.now();
  let totalChecked = 0;
  let totalClosed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    // Cutoff generoso (30 min) para cobrir empresas com config custom.
    // Filtros precisos por empresa são feitos pelo shouldCloseSchedule.
    const generousCutoff = new Date();
    generousCutoff.setMinutes(generousCutoff.getMinutes() - 30);

    const candidates = await Schedule.findAll({
      where: {
        sendAt: { [Op.lt]: generousCutoff },
        ticketId: { [Op.not]: null }
      },
      limit: 500 // safety: evita scan gigante
    });

    if (candidates.length === 0) return;

    logger.info(`[AutoCloseScheduled] Processando ${candidates.length} candidatos`);

    // Cache de config por empresa
    const configCache = new Map<number, AutoCloseConfig>();

    for (const schedule of candidates) {
      totalChecked++;
      try {
        if (!configCache.has(schedule.companyId)) {
          configCache.set(schedule.companyId, await loadConfig(schedule.companyId));
        }
        const config = configCache.get(schedule.companyId)!;

        const ticket = await Ticket.findByPk(schedule.ticketId!);
        if (!ticket) {
          totalSkipped++;
          continue;
        }

        // Idempotência: já registrado?
        const existing = await ServiceHistory.findOne({
          where: { scheduleId: schedule.id, source: "scheduled_autoclose" }
        });
        if (existing) {
          totalSkipped++;
          continue;
        }

        const lastMsg = await Message.findOne({
          where: { ticketId: ticket.id },
          order: [["createdAt", "DESC"]]
        });

        const decision = shouldCloseSchedule(
          { sendAt: schedule.sendAt, ticketId: schedule.ticketId },
          { status: ticket.status },
          lastMsg?.createdAt ?? null,
          config
        );

        if (!decision.shouldClose) {
          totalSkipped++;
          continue;
        }

        // Fecha o ticket + registra ServiceHistory atomicamente
        await UpdateTicketService({
          ticketData: { status: "closed" },
          ticketId: ticket.id,
          companyId: schedule.companyId
        });

        await ServiceHistory.create({
          contactId: ticket.contactId,
          ticketId: ticket.id,
          companyId: schedule.companyId,
          scheduleId: schedule.id,
          source: "scheduled_autoclose",
          occurredAt: schedule.sendAt
        } as any);

        totalClosed++;
        logger.info(
          `[AutoCloseScheduled] Fechado ticket #${ticket.id} (schedule #${schedule.id}, sendAt=${schedule.sendAt.toISOString()})`
        );
      } catch (err: any) {
        totalErrors++;
        logger.error(
          `[AutoCloseScheduled] Erro ao processar schedule #${schedule.id}: ${err.message}`
        );
      }
    }

    const duration = Date.now() - startedAt;
    logger.info(
      `[AutoCloseScheduled] Concluído: ${totalChecked} verificados, ${totalClosed} fechados, ${totalSkipped} pulados, ${totalErrors} erros (${duration}ms)`
    );
  } catch (err: any) {
    logger.error(`[AutoCloseScheduled] Erro fatal no cron: ${err.message}`);
  }
}

export default runAutoCloseScheduled;
