/**
 * Tool: top_servicos_por_receita
 *
 * Permite ao agente secretária (AI) identificar os serviços que mais geraram
 * receita para a empresa no período selecionado.
 *
 * Exemplos de uso pelo agente:
 *   - "Qual serviço dá mais receita para a empresa?"
 *   - "Top serviços em faturamento este mês."
 *   - "Quais são os serviços mais lucrativos?"
 *
 * Fase 8 — Ferramentas financeiras da Secretária IA.
 */

import { getTopServices } from "../../FinanceService";
import { formatCurrencyText, buildPeriodLabel, clampLimit } from "./FinanceTools.utils";

interface TopServicosPorReceitaArgs {
  startDate?: string;
  endDate?: string;
  /** Número de serviços a retornar (1-20, default: 5) */
  limit?: number | string;
}

interface ServicoItem {
  posicao: number;
  servico: string;
  receita: number;
  receitaFormatada: string;
  totalAtendimentos: number;
}

interface TopServicosPorReceitaResult {
  servicos: ServicoItem[];
  total: number;
  periodo: string;
  /** Resumo formatado pronto para enviar via WhatsApp */
  resumo: string;
}

/**
 * Retorna os serviços que mais geraram receita no período.
 *
 * @param args      - { startDate?, endDate?, limit? }
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Lista ranqueada + resumo textual em PT-BR
 */
export async function topServicosPorReceita(
  args: TopServicosPorReceitaArgs,
  companyId: number
): Promise<TopServicosPorReceitaResult> {
  const { startDate, endDate } = args;
  const limit = clampLimit(args.limit, 20, 5);

  const rows = await getTopServices(companyId, startDate, endDate, limit);
  const periodo = buildPeriodLabel(startDate, endDate);

  const servicos: ServicoItem[] = rows.map((r, i) => ({
    posicao: i + 1,
    servico: r.serviceType,
    receita: r.revenue,
    receitaFormatada: formatCurrencyText(r.revenue),
    totalAtendimentos: r.count,
  }));

  let resumo = "";
  if (servicos.length === 0) {
    resumo = `Nenhuma receita registrada no período *${periodo}*.`;
  } else {
    const emojis = ["🥇", "🥈", "🥉"];
    const linhas = servicos.map((s) => {
      const emoji = emojis[s.posicao - 1] ?? `${s.posicao}º`;
      return (
        `${emoji} *${s.servico}* — ${s.receitaFormatada}` +
        ` (${s.totalAtendimentos} atend${s.totalAtendimentos === 1 ? "." : "s."})`
      );
    });
    resumo =
      `💼 *Top ${servicos.length} serviços — ${periodo}*\n\n` +
      linhas.join("\n");
  }

  return { servicos, total: servicos.length, periodo, resumo };
}

export const topServicosPorReceitaDefinition = {
  name: "top_servicos_por_receita",
  description:
    "Retorna os tipos de serviço que mais geraram receita no período selecionado, em ordem decrescente. Use quando o gestor perguntar sobre serviços mais lucrativos, mais procurados ou com maior faturamento.",
  parameters: {
    type: "object",
    properties: {
      startDate: {
        type: "string",
        description: "Data de início no formato YYYY-MM-DD. Default: 1º do mês atual.",
      },
      endDate: {
        type: "string",
        description: "Data de fim no formato YYYY-MM-DD. Default: hoje.",
      },
      limit: {
        type: "number",
        description: "Quantidade de serviços a exibir (1-20). Default: 5.",
      },
    },
    required: [],
  },
};
