/**
 * reminderHandler — processa respostas SIM/NÃO de lembretes via WhatsApp.
 * Handler dedicado: intercepta antes do fluxo normal do agente.
 * Usa Redis para rastrear lembretes pendentes por número de contato.
 */

import Schedule from "../../models/Schedule";
import { cacheLayer } from "../../libs/cache";
import { logger } from "../../utils/logger";

export interface ReminderResponseContext {
  companyId: number;
  contactNumber: string;
  message: string;
  whatsappId: number;
}

export interface ReminderResponseResult {
  handled: boolean;
  action?: "confirmed" | "cancelled";
}

interface PendingReminder {
  scheduleId: number;
  googleEventId?: string;
}

function reminderKey(companyId: number, contactNumber: string): string {
  return `reminder:pending:${companyId}:${contactNumber}`;
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Detecta intenção de confirmação ou cancelamento por regex normalizado.
 * Retorna "confirmed", "cancelled" ou null (ambíguo — não intercepta).
 */
export function detectConfirmationIntent(message: string): "confirmed" | "cancelled" | null {
  const normalized = removeAccents(message.toLowerCase().trim());

  const confirmPatterns = /\b(sim|yes|confirmo|confirmado|pode|ok|certo|ta bom|to la|claro)\b/;
  const cancelPatterns = /\b(nao|cancela|cancelar|nao posso|desmarcar|impossivel)\b/;

  if (confirmPatterns.test(normalized)) return "confirmed";
  if (cancelPatterns.test(normalized)) return "cancelled";
  return null;
}

/**
 * Verifica se há lembrete pendente para o contato e processa a resposta.
 * Retorna handled:false se não há lembrete pendente ou mensagem é ambígua.
 */
export async function handleReminderResponse(
  ctx: ReminderResponseContext
): Promise<ReminderResponseResult> {
  const { companyId, contactNumber, message } = ctx;

  const raw = await cacheLayer.get(reminderKey(companyId, contactNumber));
  if (!raw) return { handled: false };

  const intent = detectConfirmationIntent(message);
  if (!intent) return { handled: false };

  const pending: PendingReminder = JSON.parse(raw);
  const schedule = await Schedule.findByPk(pending.scheduleId);

  if (!schedule) {
    await cacheLayer.del(reminderKey(companyId, contactNumber));
    return { handled: true, action: intent };
  }

  if (intent === "confirmed") {
    await (schedule as any).update({
      reminderStatus: "confirmed",
      confirmedAt: new Date()
    });
    logger.info(`Reminder confirmed: schedule #${pending.scheduleId} by ${contactNumber}`);
  } else {
    await (schedule as any).update({
      reminderStatus: "cancelled",
      status: "CANCELADO"
    });
    logger.info(`Reminder cancelled: schedule #${pending.scheduleId} by ${contactNumber}`);
  }

  await cacheLayer.del(reminderKey(companyId, contactNumber));
  return { handled: true, action: intent };
}

/**
 * Registra lembrete pendente no Redis com TTL de 25h.
 * Chamado por reminderSender após enviar a mensagem ao cliente.
 */
export async function registerPendingReminder(
  companyId: number,
  contactNumber: string,
  scheduleId: number,
  googleEventId?: string
): Promise<void> {
  const payload: PendingReminder = { scheduleId, googleEventId };
  await cacheLayer.set(
    reminderKey(companyId, contactNumber),
    JSON.stringify(payload),
    "EX",
    25 * 3600
  );
}
