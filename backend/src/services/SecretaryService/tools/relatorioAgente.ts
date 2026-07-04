/**
 * Tool: relatorio_agente
 * Snapshot de desempenho por agente ou por todo o time.
 *
 * Métricas calculadas:
 *   - Tickets fechados no período
 *   - Tempo médio de 1ª resposta (minutos) — amostra de até 20 tickets
 *   - Tickets ainda abertos
 *   - Flag se está acima da meta de tempo de resposta (configurável)
 *
 * Por que amostra de 20 tickets para tempo médio: o cálculo preciso exigiria
 * varrer todas as mensagens de todos os tickets fechados — caro em volume.
 * 20 tickets representativos do período já dão um indicador confiável para
 * o admin tomar decisões operacionais.
 */

import { Op } from "sequelize";
import User from "../../../models/User";
import Ticket from "../../../models/Ticket";
import Message from "../../../models/Message";
import { getSettingsByCompany } from "../../AgentService/settingsCache";

const RESPOSTA_GOAL_DEFAULT = 15; // minutos
const AMOSTRA_TICKETS = 20;       // máximo de tickets para calcular tempo médio

interface RelatorioAgenteArgs {
  /** Filtrar por nome parcial (ex: "Carlos"). Omitir para ver todos. */
  agente?: string;
  /** "hoje" (default), "semana" (7 dias) ou "mes" (30 dias). */
  periodo?: "hoje" | "semana" | "mes";
}

interface AgenteMetrica {
  id: number;
  nome: string;
  ticketsFechados: number;
  /** Média de minutos até a 1ª resposta do agente. null se sem dados. */
  tempoMedioRespostaMinutos: number | null;
  ticketsAbertos: number;
  /** true quando tempoMedioRespostaMinutos > metaRespostaMinutos. */
  acimaMetaResposta: boolean;
}

interface RelatorioAgenteResult {
  periodo: string;
  metaRespostaMinutos: number;
  agentes: AgenteMetrica[];
}

/** Retorna o início do período para filtrar updatedAt. */
function getPeriodoInicio(periodo: string): Date {
  const now = new Date();
  switch (periodo) {
    case "semana": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case "mes": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d;
    }
    default: { // "hoje"
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
}

function getPeriodoLabel(periodo: string): string {
  switch (periodo) {
    case "semana": return "Semana (últimos 7 dias)";
    case "mes": return "Mês (últimos 30 dias)";
    default: return "Hoje";
  }
}

/**
 * Calcula o tempo médio de primeira resposta (em minutos) para uma amostra
 * de tickets fechados. Retorna null quando não há mensagens de agente registradas.
 *
 * `companyId` é passado explicitamente para defense-in-depth: redundante por
 * transitividade (o ticket já foi filtrado), mas protege contra eventual bug
 * em outra query upstream que vaze IDs de ticket de outra empresa.
 */
async function calcularTempoMedioResposta(
  closedTickets: any[],
  companyId: number
): Promise<number | null> {
  let totalMin = 0;
  let count = 0;

  // Paralelo: busca primeira mensagem do agente para cada ticket da amostra
  await Promise.all(
    closedTickets.map(async (ticket) => {
      const firstMsg = await Message.findOne({
        where: { ticketId: ticket.id, companyId, fromMe: true },
        order: [["createdAt", "ASC"]]
      });
      if (firstMsg) {
        const diffMin =
          (new Date((firstMsg as any).createdAt).getTime() - new Date(ticket.createdAt).getTime()) /
          60_000;
        if (diffMin >= 0) {
          totalMin += diffMin;
          count++;
        }
      }
    })
  );

  return count > 0 ? Math.round(totalMin / count) : null;
}

/**
 * Retorna relatório de desempenho por agente.
 * Queries paralelas por agente para minimizar latência total.
 */
export async function relatorioAgente(
  args: RelatorioAgenteArgs,
  companyId: number
): Promise<RelatorioAgenteResult> {
  const periodo = args.periodo ?? "hoje";
  const periodoInicio = getPeriodoInicio(periodo);

  const settingsRows = await getSettingsByCompany(companyId);
  const settingsMap = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
  const metaResposta = parseInt(settingsMap.secretaryResponseTimeGoal ?? "0", 10) || RESPOSTA_GOAL_DEFAULT;

  // Busca usuários da empresa (com filtro opcional de nome)
  const userWhere: any = { companyId };
  if (args.agente) {
    userWhere.name = { [Op.iLike]: `%${args.agente}%` };
  }
  const users = await User.findAll({
    where: userWhere,
    attributes: ["id", "name"],
    order: [["name", "ASC"]]
  });

  if (users.length === 0) {
    return { periodo: getPeriodoLabel(periodo), metaRespostaMinutos: metaResposta, agentes: [] };
  }

  // Calcula métricas por agente em paralelo
  const agentes: AgenteMetrica[] = await Promise.all(
    (users as any[]).map(async (user) => {
      const [fechados, abertos, closedTickets] = await Promise.all([
        Ticket.count({
          where: { companyId, userId: user.id, status: "closed", updatedAt: { [Op.gte]: periodoInicio } }
        }),
        Ticket.count({
          where: { companyId, userId: user.id, status: "open" }
        }),
        Ticket.findAll({
          where: { companyId, userId: user.id, status: "closed", updatedAt: { [Op.gte]: periodoInicio } },
          attributes: ["id", "createdAt"],
          order: [["updatedAt", "DESC"]],
          limit: AMOSTRA_TICKETS
        })
      ]);

      const tempoMedioResposta = await calcularTempoMedioResposta(closedTickets as any[], companyId);

      return {
        id: user.id,
        nome: user.name,
        ticketsFechados: fechados,
        tempoMedioRespostaMinutos: tempoMedioResposta,
        ticketsAbertos: abertos,
        acimaMetaResposta: tempoMedioResposta !== null && tempoMedioResposta > metaResposta
      };
    })
  );

  // Ordena por ticketsFechados decrescente (mais produtivo primeiro)
  agentes.sort((a, b) => b.ticketsFechados - a.ticketsFechados);

  return {
    periodo: getPeriodoLabel(periodo),
    metaRespostaMinutos: metaResposta,
    agentes
  };
}

export const relatorioAgenteDefinition = {
  name: "relatorio_agente",
  description:
    "Desempenho do time ou de um agente específico: tickets fechados, tempo médio de " +
    "1ª resposta e tickets abertos. Destaca quem está acima da meta de resposta. " +
    "Use quando o admin perguntar 'como o time está indo?', 'desempenho do Carlos hoje', " +
    "'quem fechou mais tickets essa semana?', 'quem está demorando mais para responder?'.",
  parameters: {
    type: "object",
    properties: {
      agente: { type: "string", description: "Nome parcial do agente (omitir para ver todos)" },
      periodo: {
        type: "string",
        enum: ["hoje", "semana", "mes"],
        description: "Período de análise (default: hoje)"
      }
    },
    required: []
  }
};
