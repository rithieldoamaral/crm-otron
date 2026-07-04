/**
 * Tool: transferir_para_humano
 * Desativa o agente de IA no ticket e coloca em fila para atendente humano.
 * Preserva o histórico da conversa para o atendente ter contexto.
 */

import Ticket from "../../../models/Ticket";
import { getIO } from "../../../libs/socket";
import ShowTicketService from "../../TicketServices/ShowTicketService";

interface TransferirParaHumanoArgs {
  ticketId: number;
  motivo?: string;
}

interface TransferirParaHumanoResult {
  sucesso: boolean;
  mensagem: string;
  erro?: string;
}

/**
 * Desativa o chatbot/agente no ticket, transferindo para fila de atendimento humano.
 * Emite evento Socket.IO para notificar atendentes disponíveis em tempo real.
 *
 * @param args - { ticketId, motivo }
 * @param companyId - ID da empresa
 * @returns Confirmação da transferência ou erro
 */
export async function transferirParaHumano(
  args: TransferirParaHumanoArgs,
  companyId: number
): Promise<TransferirParaHumanoResult> {
  try {
    const { ticketId, motivo } = args;

    const ticket = await Ticket.findOne({
      where: { id: ticketId, companyId }
    });

    if (!ticket) {
      return {
        sucesso: false,
        mensagem: "Ticket não encontrado.",
        erro: `Ticket ID ${ticketId} não encontrado na empresa ${companyId}.`
      };
    }

    ticket.chatbot = false;
    ticket.userId = null;
    ticket.status = "pending"; // volta para "Aguardando" para um humano assumir
    await ticket.save();

    // Recarrega com relations (contact, queue, whatsapp.isAgentChannel) — sem isso
    // o frontend faz replace com payload incompleto e crasha em ticket.contact.name.
    const fullTicket = await ShowTicketService(ticket.id, companyId);

    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-ticket`, {
      action: "update",
      ticket: fullTicket
    });

    const motivoTexto = motivo ? ` Motivo: ${motivo}.` : "";
    return {
      sucesso: true,
      mensagem: `✅ Atendimento transferido para a fila.${motivoTexto} Um atendente assumirá em breve.`
    };
  } catch (error) {
    return {
      sucesso: false,
      mensagem: "Erro ao transferir atendimento.",
      erro: (error as Error).message
    };
  }
}

export const transferirParaHumanoDefinition = {
  name: "transferir_para_humano",
  description:
    "Transfere o atendimento para um atendente humano. Use quando o cliente pedir explicitamente, quando a situação for complexa demais para o agente, ou em emergências.",
  parameters: {
    type: "object",
    properties: {
      ticketId: {
        type: "number",
        description: "ID do ticket em andamento"
      },
      motivo: {
        type: "string",
        description: "Motivo da transferência (opcional, ajuda o atendente humano)"
      }
    },
    required: ["ticketId"]
  }
};
