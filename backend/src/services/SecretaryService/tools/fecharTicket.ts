/**
 * Tool: fechar_ticket
 * Encerra um atendimento pelo ID do ticket.
 */

import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";

interface FecharTicketArgs {
  ticketId: number;
}

interface FecharTicketResult {
  sucesso: boolean;
  mensagem?: string;
  erro?: string;
}

/**
 * Fecha um ticket ativo. Rejeita se já estiver fechado.
 */
export async function fecharTicket(
  args: FecharTicketArgs,
  companyId: number
): Promise<FecharTicketResult> {
  const ticket = await Ticket.findOne({
    where: { id: args.ticketId, companyId },
    include: [{ model: Contact, as: "contact", attributes: ["name"] }]
  });

  if (!ticket) {
    return { sucesso: false, erro: `Ticket #${args.ticketId} não encontrado.` };
  }

  if ((ticket as any).status === "closed") {
    return { sucesso: false, erro: `Ticket #${args.ticketId} já fechado.` };
  }

  await ticket.update({ status: "closed" });

  const clienteNome = (ticket as any).contact?.name ?? "cliente";
  return {
    sucesso: true,
    mensagem: `✅ Atendimento #${args.ticketId} de ${clienteNome} foi encerrado.`
  };
}

export const fecharTicketDefinition = {
  name: "fechar_ticket",
  description: "Encerra um atendimento ativo. Use quando o admin pedir para fechar/encerrar um atendimento.",
  parameters: {
    type: "object",
    properties: {
      ticketId: { type: "number", description: "ID do ticket a ser fechado" }
    },
    required: ["ticketId"]
  }
};
