/**
 * Tool: transferir_ticket
 * Transfere um ticket para outro usuário ou fila.
 */

import Ticket from "../../../models/Ticket";
import User from "../../../models/User";
import Queue from "../../../models/Queue";
import Contact from "../../../models/Contact";

interface TransferirTicketArgs {
  ticketId: number;
  usuarioId?: number;
  filaId?: number;
}

interface TransferirTicketResult {
  sucesso: boolean;
  mensagem?: string;
  erro?: string;
}

/**
 * Transfere um ticket para um agente ou fila específica.
 * Pelo menos um de usuarioId ou filaId deve ser fornecido.
 */
export async function transferirTicket(
  args: TransferirTicketArgs,
  companyId: number
): Promise<TransferirTicketResult> {
  const { ticketId, usuarioId, filaId } = args;

  if (!usuarioId && !filaId) {
    return { sucesso: false, erro: "Informe o destino: usuarioId ou filaId." };
  }

  const ticket = await Ticket.findOne({
    where: { id: ticketId, companyId },
    include: [{ model: Contact, as: "contact", attributes: ["name"] }]
  });

  if (!ticket) {
    return { sucesso: false, erro: `Ticket #${ticketId} não encontrado.` };
  }

  const clienteNome = (ticket as any).contact?.name ?? "cliente";
  const updateData: Record<string, unknown> = {};

  if (usuarioId) {
    const user = await User.findOne({ where: { id: usuarioId, companyId } });
    if (!user) {
      return { sucesso: false, erro: `Usuário #${usuarioId} não encontrado nesta empresa.` };
    }
    updateData.userId = usuarioId;
    updateData.status = "open";

    await ticket.update(updateData);
    return {
      sucesso: true,
      mensagem: `✅ Ticket #${ticketId} (${clienteNome}) transferido para ${(user as any).name}.`
    };
  }

  if (filaId) {
    const queue = await Queue.findOne({ where: { id: filaId, companyId } });
    if (!queue) {
      return { sucesso: false, erro: `Fila #${filaId} não encontrada nesta empresa.` };
    }
    updateData.queueId = filaId;

    await ticket.update(updateData);
    return {
      sucesso: true,
      mensagem: `✅ Ticket #${ticketId} (${clienteNome}) transferido para a fila ${(queue as any).name}.`
    };
  }
}

export const transferirTicketDefinition = {
  name: "transferir_ticket",
  description: "Transfere um ticket para outro usuário ou fila. Use quando o admin quiser redirecionar um atendimento.",
  parameters: {
    type: "object",
    properties: {
      ticketId: { type: "number", description: "ID do ticket a transferir" },
      usuarioId: { type: "number", description: "ID do usuário destino" },
      filaId: { type: "number", description: "ID da fila destino" }
    },
    required: ["ticketId"]
  }
};
