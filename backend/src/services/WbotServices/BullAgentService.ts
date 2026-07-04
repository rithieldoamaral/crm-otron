/**
 * BullAgentService — fila persistente Bull/Redis para mensagens do agente IA.
 *
 * Por que fila: o processamento de uma mensagem de agente leva 3-15s (LLM + tools).
 * Se o backend reiniciar neste intervalo, a mensagem em voo se perde e o cliente
 * fica sem resposta. Com Bull, o job fica no Redis e é reprocessado no próximo boot.
 *
 * Retry: 2 tentativas com backoff fixo de 5s. Falha persistente reverte ticket
 * para "pending" via handleAgentMessage (comportamento já existente).
 *
 * Circular dependency: este arquivo importa handleAgentMessage (AgentService).
 * wbotMessageListener importa addAgentMessageJob (este arquivo).
 * verifyMessage é importado via require lazy para evitar o ciclo de módulo.
 */

import Bull from "bull";
import { getWbot } from "../../libs/wbot";
import { handleAgentMessage } from "../AgentService/handleAgentMessage";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";

const REDIS_URI = process.env.REDIS_URI || "redis://localhost:6379";

export interface AgentJobData {
  companyId: number;
  ticketId: number;
  contactId: number;
  contactNumber: string;
  userMessage: string;
  whatsappId: number;
  queueId?: number;
  enqueuedAt: number;
}

const agentMessageQueue = new Bull<AgentJobData>("agentMessageQueue", REDIS_URI, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

agentMessageQueue.process(async (job) => {
  const {
    companyId,
    ticketId,
    contactId,
    contactNumber,
    userMessage,
    whatsappId,
    queueId,
    enqueuedAt,
  } = job.data;

  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) {
    logger.error(`[BullAgentService] Ticket ${ticketId} not found — job discarded`);
    return;
  }

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) {
    logger.error(`[BullAgentService] Contact ${contactId} not found — job discarded`);
    return;
  }

  let wbot: any;
  try {
    wbot = getWbot(whatsappId);
  } catch {
    logger.error(
      `[BullAgentService] wbot session ${whatsappId} not available — job discarded`
    );
    return;
  }

  const agentJid = `${contactNumber}@s.whatsapp.net`;

  try {
    await wbot.sendPresenceUpdate("composing", agentJid);
  } catch {
    // Best-effort: presence failure doesn't block the reply
  }

  await handleAgentMessage(
    { companyId, ticket, contactId, contactNumber, userMessage, whatsappId, queueId },
    async (number, text) => {
      const elapsed = Date.now() - enqueuedAt;
      const minTypingMs = Math.min(1500 + Math.round(text.length * 15), 5000);
      const remaining = Math.max(0, minTypingMs - elapsed);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

      try {
        await wbot.sendPresenceUpdate("paused", agentJid);
      } catch {}

      const sentMsg = await wbot.sendMessage(`${number}@s.whatsapp.net`, { text });
      if (sentMsg) {
        // Lazy require to avoid circular dependency:
        // wbotMessageListener → BullAgentService → wbotMessageListener
        const { verifyMessage } = require("./wbotMessageListener");
        await verifyMessage(sentMsg, ticket, contact);
      }
    }
  );
});

agentMessageQueue.on("failed", (job, err) => {
  logger.error(
    `[BullAgentService] Job ${job.id} failed after ${job.attemptsMade} attempts: ${err.message}`
  );
});

export const addAgentMessageJob = async (
  data: Omit<AgentJobData, "enqueuedAt">
): Promise<void> => {
  await agentMessageQueue.add({ ...data, enqueuedAt: Date.now() });
};
