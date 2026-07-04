/**
 * Tool: listar_agendamentos
 * Retorna os agendamentos de uma data específica para a empresa.
 */

import { Op } from "sequelize";
import Schedule from "../../../models/Schedule";
import Contact from "../../../models/Contact";

interface ListarAgendamentosArgs {
  data: string; // formato: YYYY-MM-DD
}

interface Agendamento {
  id: number;
  servico: string;
  horario: string;
  cliente: string;
  numeroCliente: string;
  status: string;
}

interface ListarAgendamentosResult {
  agendamentos: Agendamento[];
  total: number;
  mensagem: string;
  erro?: string;
}

/**
 * Lista agendamentos de um dia, ordenados por horário.
 *
 * @param args - { data } no formato YYYY-MM-DD
 * @param companyId - ID da empresa
 * @returns Lista de agendamentos com detalhes do cliente e horário
 */
export async function listarAgendamentos(
  args: ListarAgendamentosArgs,
  companyId: number
): Promise<ListarAgendamentosResult> {
  try {
    const { data } = args;
    const inicio = new Date(`${data}T00:00:00`);
    const fim = new Date(`${data}T23:59:59`);

    const schedules = await Schedule.findAll({
      where: {
        companyId,
        sendAt: { [Op.between]: [inicio, fim] as any }
      },
      include: [{ model: Contact, as: "contact", attributes: ["name", "number"] }],
      order: [["sendAt", "ASC"]]
    });

    if (schedules.length === 0) {
      return {
        agendamentos: [],
        total: 0,
        mensagem: `Nenhum agendamento para ${data}.`
      };
    }

    const agendamentos: Agendamento[] = schedules.map(s => ({
      id: s.id,
      servico: s.body,
      horario: s.sendAt
        ? new Date(s.sendAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit"
          })
        : "--:--",
      cliente: (s as any).Contact?.name ?? "Desconhecido",
      numeroCliente: (s as any).Contact?.number ?? "",
      status: s.status ?? "PENDENTE"
    }));

    return {
      agendamentos,
      total: agendamentos.length,
      mensagem: `${agendamentos.length} agendamento(s) para ${data}.`
    };
  } catch (error) {
    return {
      agendamentos: [],
      total: 0,
      mensagem: "Erro ao listar agendamentos.",
      erro: (error as Error).message
    };
  }
}

export const listarAgendamentosDefinition = {
  name: "listar_agendamentos",
  description:
    "Lista todos os agendamentos de um dia específico. Use 'hoje' ou uma data no formato YYYY-MM-DD.",
  parameters: {
    type: "object",
    properties: {
      data: {
        type: "string",
        description:
          "Data no formato YYYY-MM-DD (ex: 2026-04-20). Use a data atual para 'hoje'."
      }
    },
    required: ["data"]
  }
};
