import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import BirthdayIntelligentService from "./services/RetentionService/BirthdayIntelligentService";
import PreventiveReminderService from "./services/RetentionService/PreventiveReminderService";
import WinbackService from "./services/RetentionService/WinbackService";
import cron from "node-cron";
import { runSecretaryAlerts }   from "./services/SecretaryService/secretaryAlerts";
import { runMorningBriefings }  from "./services/SecretaryService/secretaryBriefing";
import { runReminderSender }    from "./services/GoogleCalendarService/reminderSender";
import { runAutoCloseScheduled } from "./services/RetentionService/AutoCloseScheduledService";
import SystemLog from "./models/SystemLog";
import { Op } from "sequelize";


const server = app.listen(process.env.PORT, async () => {
  const companies = await Company.findAll();
  const allPromises: any[] = [];
  companies.map(async c => {
  
  	if(c.status === true){  
    	const promise = StartAllWhatsAppsSessions(c.id);
    	allPromises.push(promise);
    }else{
    	logger.info(`Empresa INATIVA: ${c.id} | ${c.name}`);
    }
  
  });

  Promise.all(allPromises).then(() => {
    startQueueProcess();
  });
  logger.info(`Server started on port: ${process.env.PORT}`);
});

process.on("uncaughtException", err => {
  console.error(`${new Date().toUTCString()} uncaughtException:`, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason, p) => {
  console.error(
    `${new Date().toUTCString()} unhandledRejection:`,
    reason,
    p
  );
  process.exit(1);
});


cron.schedule("*/5 * * * *", async () => {  // De 1 minuto para 5 minutos
  try {
    logger.info(`Serviço de transferência de tickets iniciado`);
    await TransferTicketQueue();
  } catch (error) {
    logger.error("Error in cron job:", error);
  }
});

// Fluxo de aniversário inteligente (3 toques: D-3, D-0+cupom, D+7)
// Substitui BirthdayReminderService (D-0 apenas). Idempotente por design.
cron.schedule("* * * * *", async () => {
  try {
    await BirthdayIntelligentService();
  } catch (error) {
    logger.error("[BirthdayIntelligent] Erro no cron:", error);
  }
});

// Lembrete preventivo (Fase 3A) — mensagem proativa quando ratio atinge ~80%
// do intervalo médio de serviços, antes de virar atrasado. Idempotente via
// UNIQUE(contactId, baselineHistoryId) na tabela PreventiveTouches.
cron.schedule("* * * * *", async () => {
  try {
    await PreventiveReminderService();
  } catch (error) {
    logger.error("[PreventiveReminder] Erro no cron:", error);
  }
});

// Win-back pós-perda (Fase 3C) — reativação para clientes "adormecido"/"perdido"
// com cupom de alto valor. Cooldown configurável entre tentativas (default 90d).
cron.schedule("* * * * *", async () => {
  try {
    await WinbackService();
  } catch (error) {
    logger.error("[Winback] Erro no cron:", error);
  }
});

// Alertas proativos da secretária: espera longa + erros do agente
cron.schedule("*/5 * * * *", async () => {
  try {
    await runSecretaryAlerts();
  } catch (error) {
    logger.error("Error in secretary alerts cron:", error);
  }
});

// Briefing matinal da secretária: roda a cada minuto, dispara no horário configurado
cron.schedule("* * * * *", async () => {
  try {
    await runMorningBriefings();
  } catch (error) {
    logger.error("Error in morning briefing cron:", error);
  }
});

// Lembretes de agendamento: envia SIM/NÃO 1 dia antes ou 15min antes
cron.schedule("*/5 * * * *", async () => {
  try {
    await runReminderSender();
  } catch (error) {
    logger.error("Error in reminder sender cron:", error);
  }
});

// Retenção: auto-fecha tickets de agendamento que passaram do horário
// (default 60 min após sendAt, com janela de proteção de 15 min para conversas ativas)
// Registra ServiceHistory para alimentar detecção de adormecidos.
// Configurável por empresa via Settings: retention.autoCloseMinutes / retention.inactivityWindow
cron.schedule("*/5 * * * *", async () => {
  try {
    await runAutoCloseScheduled();
  } catch (error) {
    logger.error("Error in auto-close scheduled cron:", error);
  }
});

// Limpeza de logs antigos: roda 1x/dia às 03:00 e apaga registros > 30 dias
cron.schedule("0 3 * * *", async () => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const deleted = await SystemLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    if (deleted > 0) {
      logger.info(`[SystemLogs] Limpeza: ${deleted} registros removidos (> 30 dias)`);
    }
  } catch (error) {
    logger.error("[SystemLogs] Erro no cron de limpeza:", error);
  }
});

initIO(server);

// Configure graceful shutdown to handle all outstanding promises
gracefulShutdown(server, {
  signals: "SIGINT SIGTERM",
  timeout: 30000, // 30 seconds
  onShutdown: async () => {
    logger.info("Gracefully shutting down...");
    // Add any other cleanup code here, if necessary
  },
  finally: () => {
    logger.info("Server shutdown complete.");
  }
});
