/**
 * Tool: consultar_atendimentos
 * Lista tickets da empresa por status, fila e/ou data.
 */

import { Op } from "sequelize";
import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";
import Queue from "../../../models/Queue";

interface ConsultarAtendimentosArgs {
  status?: string;
  filaId?: number;
  data?: string;
}

interface AtendimentoItem {
  id: number;
  cliente: string;
  telefone: string;
  fila: string | null;
  ultimaMensagem: string;
  status: string;
}

interface ConsultarAtendimentosResult {
  atendimentos: AtendimentoItem[];
  total: number;
}

/**
 * Consulta atendimentos (tickets) da empresa com filtros opcionais.
 */
export async function consultarAtendimentos(
  args: ConsultarAtendimentosArgs,
  companyId: number
): Promise<ConsultarAtendimentosResult> {
  const { status = "open", filaId, data } = args;

  const where: Record<string, unknown> = { companyId, status };
  if (filaId) where.queueId = filaId;
  if (data) {
    const day = new Date(data);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    where.createdAt = { [Op.between]: [day, next] };
  }

  const tickets = await Ticket.findAll({
    where,
    include: [
      { model: Contact, as: "contact", attributes: ["name", "number"] },
      { model: Queue, as: "queue", attributes: ["name"] }
    ],
    order: [["updatedAt", "DESC"]],
    limit: 20
  });

  const atendimentos: AtendimentoItem[] = tickets.map((t: any) => ({
    id: t.id,
    cliente: t.contact?.name ?? "Desconhecido",
    telefone: t.contact?.number ?? "",
    fila: t.queue?.name ?? null,
    ultimaMensagem: t.lastMessage ?? "",
    status: t.status
  }));

  return { atendimentos, total: atendimentos.length };
}

export const consultarAtendimentosDefinition = {
  name: "consultar_atendimentos",
  description: "Lista atendimentos (tickets) da empresa. Filtre por status (open/pending/closed), fila ou data.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "pending", "closed"], description: "Status dos atendimentos (padrão: open)" },
      filaId: { type: "number", description: "ID da fila para filtrar" },
      data: { type: "string", description: "Data no formato YYYY-MM-DD para filtrar" }
    },
    required: []
  }
};
