/**
 * Tool: buscar_ticket
 * Localiza tickets por nome de contato, número ou contexto textual.
 */

import { Op } from "sequelize";
import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";
import Queue from "../../../models/Queue";

interface BuscarTicketArgs {
  query: string;
}

interface TicketItem {
  id: number;
  cliente: string;
  contato: { nome: string; numero: string };
  fila: string | null;
  status: string;
  whatsappId: number;
}

interface BuscarTicketResult {
  encontrado: boolean;
  tickets: TicketItem[];
  mensagem?: string;
}

/**
 * Busca tickets abertos/pendentes pelo nome ou número do contato.
 * Retorna até 5 resultados ordenados por atualização recente.
 */
export async function buscarTicket(
  args: BuscarTicketArgs,
  companyId: number
): Promise<BuscarTicketResult> {
  const { query } = args;
  const termo = query.trim();

  const isNumber = /^[\d\s\+\-\(\)]+$/.test(termo);
  const contactWhere = isNumber
    ? { number: { [Op.like]: `%${termo.replace(/\D/g, "")}%` } }
    : { name: { [Op.iLike]: `%${termo}%` } };

  const tickets = await Ticket.findAll({
    where: {
      companyId,
      status: { [Op.in]: ["open", "pending"] }
    },
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["name", "number"],
        where: contactWhere
      },
      { model: Queue, as: "queue", attributes: ["name"] }
    ],
    order: [["updatedAt", "DESC"]],
    limit: 5
  });

  if (tickets.length === 0) {
    return {
      encontrado: false,
      tickets: [],
      mensagem: `Não encontrado: nenhum atendimento ativo para "${termo}".`
    };
  }

  const result: TicketItem[] = tickets.map((t: any) => ({
    id: t.id,
    cliente: t.contact?.name ?? "Desconhecido",
    contato: {
      nome: t.contact?.name ?? "",
      numero: t.contact?.number ?? ""
    },
    fila: t.queue?.name ?? null,
    status: t.status,
    whatsappId: t.whatsappId
  }));

  return { encontrado: true, tickets: result };
}

export const buscarTicketDefinition = {
  name: "buscar_ticket",
  description: "Localiza atendimentos ativos (open/pending) pelo nome ou telefone do cliente. Use quando o admin mencionar um cliente específico.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Nome parcial ou número de telefone do cliente" }
    },
    required: ["query"]
  }
};
