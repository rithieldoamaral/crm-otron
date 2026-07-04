/**
 * Tool: consultar_faturamento
 *
 * Permite ao agente secretária (AI) consultar os KPIs financeiros do período:
 * receita total, número de transações, ticket médio e crescimento vs período anterior.
 *
 * Exemplos de uso pelo agente:
 *   - "Qual foi o faturamento deste mês?"
 *   - "Quanto faturamos em abril?"
 *   - "Crescemos ou caímos em relação ao mês passado?"
 *
 * Fase 8 — Ferramentas financeiras da Secretária IA.
 */

import {
  getFinanceSummary,
} from "../../FinanceService";
import {
  formatCurrencyText,
  buildPeriodLabel,
} from "./FinanceTools.utils";

interface ConsultarFaturamentoArgs {
  /** Data de início do período (ISO "YYYY-MM-DD"). Default: 1º do mês atual. */
  startDate?: string;
  /** Data de fim do período (ISO "YYYY-MM-DD"). Default: hoje. */
  endDate?: string;
}

interface ConsultarFaturamentoResult {
  totalReceita: number;
  totalTransacoes: number;
  ticketMedio: number | null;
  crescimentoPercent: number | null;
  periodoAnteriorReceita: number;
  periodo: string;
  /** Resumo formatado pronto para enviar via WhatsApp */
  resumo: string;
}

/**
 * Consulta os KPIs financeiros do período para o agente secretária.
 *
 * @param args      - { startDate?, endDate? }
 * @param companyId - ID da empresa (JWT do agente)
 * @returns KPIs + resumo textual em PT-BR
 */
export async function consultarFaturamento(
  args: ConsultarFaturamentoArgs,
  companyId: number
): Promise<ConsultarFaturamentoResult> {
  const { startDate, endDate } = args;

  const summary = await getFinanceSummary(companyId, startDate, endDate);
  const periodo = buildPeriodLabel(startDate, endDate);

  // ── Linha de crescimento ──────────────────────────────────────────────────
  let linhaCresc = "";
  if (summary.growthRate === null) {
    linhaCresc = "Sem dados do período anterior para comparação.";
  } else if (summary.growthRate >= 0) {
    linhaCresc =
      `📈 Crescimento de *+${summary.growthRate}%* vs período anterior ` +
      `(${formatCurrencyText(summary.previousRevenue)}).`;
  } else {
    linhaCresc =
      `📉 Queda de *${summary.growthRate}%* vs período anterior ` +
      `(${formatCurrencyText(summary.previousRevenue)}).`;
  }

  const ticketMedioStr =
    summary.averageTicket != null
      ? formatCurrencyText(summary.averageTicket)
      : "—";

  const resumo =
    `💰 *Faturamento — ${periodo}*\n\n` +
    `• Receita total: *${formatCurrencyText(summary.totalRevenue)}*\n` +
    `• Transações: *${summary.transactionCount}*\n` +
    `• Ticket médio: *${ticketMedioStr}*\n\n` +
    linhaCresc;

  return {
    totalReceita: summary.totalRevenue,
    totalTransacoes: summary.transactionCount,
    ticketMedio: summary.averageTicket,
    crescimentoPercent: summary.growthRate,
    periodoAnteriorReceita: summary.previousRevenue,
    periodo,
    resumo,
  };
}

export const consultarFaturamentoDefinition = {
  name: "consultar_faturamento",
  description:
    "Consulta os KPIs financeiros do período: receita total, número de transações, ticket médio e crescimento percentual vs período anterior de igual duração. Use quando o gestor perguntar sobre faturamento, receita ou desempenho financeiro.",
  parameters: {
    type: "object",
    properties: {
      startDate: {
        type: "string",
        description:
          "Data de início do período no formato YYYY-MM-DD (ex: '2026-05-01'). Se omitido, usa o 1º dia do mês atual.",
      },
      endDate: {
        type: "string",
        description:
          "Data de fim do período no formato YYYY-MM-DD (ex: '2026-05-31'). Se omitido, usa hoje.",
      },
    },
    required: [],
  },
};
