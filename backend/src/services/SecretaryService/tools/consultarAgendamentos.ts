/**
 * Tool: consultar_agendamentos
 * Lista agendamentos do dia ou de uma data específica.
 */

import { Op } from "sequelize";
import Schedule from "../../../models/Schedule";
import Contact from "../../../models/Contact";

// Mesmo guard de reagendarAgendamento — LLM pode alucinar "amanhã" ou "25/04/2026"
// e queremos retornar erro explícito ao admin em vez de uma busca vazia silenciosa.
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface ConsultarAgendamentosArgs {
  data?: string;
}

interface AgendamentoItem {
  id: number;
  servico: string;
  cliente: string;
  telefone: string;
  horario: string;
  status: string;
}

interface ConsultarAgendamentosResult {
  agendamentos: AgendamentoItem[];
  total: number;
  /** Presente quando args.data foi rejeitado por validação de formato. */
  erro?: string;
}

/**
 * Consulta agendamentos para uma data (padrão: hoje).
 *
 * Valida `args.data` ANTES de chamar o BD — alucinação do LLM resultaria em
 * `new Date("amanhã")` = Invalid Date, que faria a query rodar com lixo e
 * retornar vazio silenciosamente (Bug #20 do AgentService — "answer empty
 * confidently" em vez de pedir esclarecimento).
 */
export async function consultarAgendamentos(
  args: ConsultarAgendamentosArgs,
  companyId: number
): Promise<ConsultarAgendamentosResult> {
  let targetDate: Date;

  if (args.data) {
    if (!DATE_REGEX.test(args.data)) {
      return {
        agendamentos: [],
        total: 0,
        erro: `Data inválida "${args.data}". Use formato YYYY-MM-DD.`
      };
    }
    targetDate = new Date(`${args.data}T00:00:00`);
    if (isNaN(targetDate.getTime())) {
      return {
        agendamentos: [],
        total: 0,
        erro: `Data inválida "${args.data}".`
      };
    }
    // Round-trip check: V8 silenciosamente rola "2026-02-30" → "2026-03-02".
    const [yyyy, mm, dd] = args.data.split("-").map(Number);
    if (
      targetDate.getFullYear() !== yyyy ||
      targetDate.getMonth() + 1 !== mm ||
      targetDate.getDate() !== dd
    ) {
      return {
        agendamentos: [],
        total: 0,
        erro: `Data inválida "${args.data}" — esta data não existe no calendário.`
      };
    }
  } else {
    targetDate = new Date();
  }

  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const schedules = await Schedule.findAll({
    where: {
      companyId,
      sendAt: { [(Op as any).between]: [startOfDay, endOfDay] }
    },
    include: [
      { model: Contact, as: "contact", attributes: ["name", "number"] }
    ],
    order: [["sendAt", "ASC"]]
  });

  const agendamentos: AgendamentoItem[] = schedules.map((s: any) => ({
    id: s.id,
    servico: s.body ?? "",
    cliente: s.contact?.name ?? "Desconhecido",
    telefone: s.contact?.number ?? "",
    horario: s.sendAt ? new Date(s.sendAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "",
    status: s.status ?? "PENDENTE"
  }));

  return { agendamentos, total: agendamentos.length };
}

export const consultarAgendamentosDefinition = {
  name: "consultar_agendamentos",
  description: "Lista agendamentos do dia ou de uma data específica. Inclui horário, serviço e nome do cliente.",
  parameters: {
    type: "object",
    properties: {
      data: { type: "string", description: "Data no formato YYYY-MM-DD (padrão: hoje)" }
    },
    required: []
  }
};
