/**
 * Tool: consultar_metricas
 * Snapshot operacional do negócio: tickets abertos/pendentes/em espera,
 * agendamentos de hoje, tickets fechados hoje e ontem.
 *
 * Por que esta tool existe: o admin não precisa abrir o dashboard para saber
 * "como estamos hoje?" — uma pergunta em linguagem natural entrega o resumo
 * completo. Queries paralelas via Promise.all para mínima latência.
 */

import { Op } from "sequelize";
import Ticket from "../../../models/Ticket";
import Schedule from "../../../models/Schedule";
import { getSettingsByCompany } from "../../AgentService/settingsCache";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ConsultarMetricasArgs {}

interface MetricasResult {
  /** Tickets com status "open" neste momento. */
  ticketsAbertos: number;
  /** Tickets com status "pending" (aguardando agente) neste momento. */
  ticketsPendentes: number;
  /**
   * Tickets "open" sem atualização há mais de `limiarEsperaMinutos` minutos.
   * Indica filas esquecidas ou clientes esperando sem resposta.
   */
  ticketsEmEsperaLonga: number;
  /** Total de agendamentos marcados para hoje (00h–23h59). */
  agendamentosHoje: number;
  /** Tickets encerrados no dia atual. */
  ticketsFechadosHoje: number;
  /** Tickets encerrados no dia anterior (referência de produtividade). */
  ticketsFechadosOntem: number;
  /** Limiar usado para calcular ticketsEmEsperaLonga, em minutos. */
  limiarEsperaMinutos: number;
}

/**
 * Retorna um snapshot operacional do negócio via queries paralelas.
 * Usa settingsCache para ler limiar de espera sem bater no banco a cada chamada.
 */
export async function consultarMetricas(
  _args: ConsultarMetricasArgs,
  companyId: number
): Promise<MetricasResult> {
  const settingsRows = await getSettingsByCompany(companyId);
  const settingsMap = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  // Se secretaryAlertWaitMinutes for 0 (desativado no alerta proativo),
  // para métricas usamos 60 min como fallback — 0 não seria informativo aqui.
  const rawLimiar = parseInt(settingsMap.secretaryAlertWaitMinutes ?? "0", 10);
  const limiarEsperaMinutos = rawLimiar > 0 ? rawLimiar : 60;

  const agora = new Date();
  const limiarTs = new Date(agora.getTime() - limiarEsperaMinutos * 60 * 1000);

  const inicioDiaHoje = new Date(agora);
  inicioDiaHoje.setHours(0, 0, 0, 0);
  const fimDiaHoje = new Date(agora);
  fimDiaHoje.setHours(23, 59, 59, 999);

  const inicioDiaOntem = new Date(agora);
  inicioDiaOntem.setDate(inicioDiaOntem.getDate() - 1);
  inicioDiaOntem.setHours(0, 0, 0, 0);
  const fimDiaOntem = new Date(agora);
  fimDiaOntem.setDate(fimDiaOntem.getDate() - 1);
  fimDiaOntem.setHours(23, 59, 59, 999);

  // Todas as queries em paralelo — latência total = slowest query, não soma.
  const [
    ticketsAbertos,
    ticketsPendentes,
    ticketsEmEsperaLonga,
    agendamentosHoje,
    ticketsFechadosHoje,
    ticketsFechadosOntem
  ] = await Promise.all([
    Ticket.count({ where: { companyId, status: "open" } }),
    Ticket.count({ where: { companyId, status: "pending" } }),
    Ticket.count({ where: { companyId, status: "open", updatedAt: { [Op.lt]: limiarTs } } }),
    Schedule.count({ where: { companyId, sendAt: { [(Op as any).between]: [inicioDiaHoje, fimDiaHoje] } } }),
    Ticket.count({ where: { companyId, status: "closed", updatedAt: { [(Op as any).between]: [inicioDiaHoje, fimDiaHoje] } } }),
    Ticket.count({ where: { companyId, status: "closed", updatedAt: { [(Op as any).between]: [inicioDiaOntem, fimDiaOntem] } } })
  ]);

  return {
    ticketsAbertos,
    ticketsPendentes,
    ticketsEmEsperaLonga,
    agendamentosHoje,
    ticketsFechadosHoje,
    ticketsFechadosOntem,
    limiarEsperaMinutos
  };
}

export const consultarMetricasDefinition = {
  name: "consultar_metricas",
  description:
    "Retorna snapshot operacional do negócio: tickets abertos, pendentes, em espera longa, " +
    "agendamentos de hoje, tickets fechados hoje e ontem. " +
    "Use quando o admin perguntar 'como estamos?', 'resumo do dia', 'situação atual', " +
    "'quantos atendimentos temos?', 'qual a fila hoje?'.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};
