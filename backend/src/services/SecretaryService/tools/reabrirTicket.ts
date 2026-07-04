/**
 * Tool: reabrir_ticket
 * Reabre um ticket fechado para continuar o atendimento.
 *
 * Status final: "open" (não "pending") — o admin quer que o agente veja
 * e retome a conversa imediatamente, não que fique na fila de distribuição.
 *
 * Casos de uso: ticket fechado por engano, cliente voltou com nova dúvida
 * relacionada, ou admin precisa adicionar uma nota e continuar.
 */

import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";

interface ReopenTicketArgs {
  /** ID do ticket a reabrir. */
  ticketId: number;
}

interface ReopenTicketResult {
  sucesso: boolean;
  mensagem?: string;
  erro?: string;
}

/**
 * Reabre um ticket fechado, alterando o status para "open".
 * Rejeita se o ticket não existir ou já estiver aberto/pendente.
 */
export async function reabrirTicket(
  args: ReopenTicketArgs,
  companyId: number
): Promise<ReopenTicketResult> {
  const ticket = await Ticket.findOne({
    where: { id: args.ticketId, companyId },
    include: [{ model: Contact, as: "contact", attributes: ["name"] }]
  });

  if (!ticket) {
    return { sucesso: false, erro: `Ticket #${args.ticketId} não encontrado.` };
  }

  const t = ticket as any;

  if (t.status !== "closed") {
    return {
      sucesso: false,
      erro: `Ticket #${args.ticketId} não está fechado (status atual: ${t.status}).`
    };
  }

  await t.update({ status: "open" });

  const clienteNome = t.contact?.name ?? "cliente";
  return {
    sucesso: true,
    mensagem: `✅ Ticket #${args.ticketId} (${clienteNome}) reaberto com sucesso.`
  };
}

export const reabrirTicketDefinition = {
  name: "reabrir_ticket",
  description:
    "Reabre um ticket fechado para continuar o atendimento. " +
    "Use quando o admin precisar retomar uma conversa encerrada por engano, " +
    "ou quando o cliente voltou com uma questão relacionada ao atendimento anterior.",
  parameters: {
    type: "object",
    properties: {
      ticketId: { type: "number", description: "ID do ticket a reabrir" }
    },
    required: ["ticketId"]
  }
};
