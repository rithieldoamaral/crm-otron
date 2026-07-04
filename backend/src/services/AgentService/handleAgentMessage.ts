/**
 * handleAgentMessage — processa uma mensagem recebida no canal agente.
 * Responsabilidade única: orquestrar a interação ticket ↔ agente IA,
 * incluindo atualização de status e fallback em caso de erro.
 */

import Ticket from "../../models/Ticket";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { handleClientAgent } from "./index";

export interface AgentMessageContext {
  companyId: number;
  ticket: Ticket;
  contactId: number;
  contactNumber: string;
  userMessage: string;
  whatsappId: number;
  queueId?: number;
}

export interface AgentMessageResult {
  handled: boolean;
  reply?: string;
  error?: string;
}

/**
 * Processa mensagem para o canal agente:
 * 1. Seta ticket para open+chatbot (em atendimento)
 * 2. Chama o loop agêntico
 * 3. Em falha: reverte para pending (aguardando humano)
 */
export async function handleAgentMessage(
  ctx: AgentMessageContext,
  sendFn: (number: string, text: string) => Promise<void>
): Promise<AgentMessageResult> {
  const { companyId, ticket, contactId, contactNumber, userMessage, whatsappId, queueId } = ctx;

  try {
    await ticket.update({ status: "open", chatbot: true, queueId });
    await emitTicketUpdate(companyId, ticket.id);

    const { reply } = await handleClientAgent({
      companyId,
      ticketId: ticket.id,
      contactId,
      contactName: (ticket as any).contact?.name || (ticket as any).contact?.pushName || contactNumber,
      contactNumber,
      userMessage,
      whatsappId
    });

    await sendFn(contactNumber, reply);
    return { handled: true, reply };
  } catch (err) {
    logger.error(
      `[handleAgentMessage] ticket=${ticket.id} company=${companyId} falhou: ${(err as Error).message}`
    );
    // Falha no agente: reverte para "Aguardando" para humano assumir
    try {
      await ticket.update({ status: "pending", chatbot: false });
      await emitTicketUpdate(companyId, ticket.id);
    } catch {
      // best-effort
    }
    return { handled: true, error: (err as Error).message };
  }
}

// Recarrega o ticket com todas as relações (incluindo whatsapp.isAgentChannel)
// antes de emitir — sem isso o frontend faz replace com payload incompleto
// e o badge "AGENTE IA" pisca para "SEM FILA" a cada update.
async function emitTicketUpdate(companyId: number, ticketId: number): Promise<void> {
  try {
    const fullTicket = await ShowTicketService(ticketId, companyId);
    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-ticket`, {
      action: "update",
      ticket: fullTicket
    });
  } catch (err) {
    // Socket ou DB indisponível em testes — não-fatal
    logger.warn(`[handleAgentMessage] emitTicketUpdate falhou para ticket=${ticketId}: ${(err as Error).message}`);
  }
}
