/**
 * Tool: top_clientes_por_valor
 *
 * Permite ao agente secretária (AI) identificar os clientes que mais geraram
 * receita para a empresa no período selecionado.
 *
 * Exemplos de uso pelo agente:
 *   - "Quem são nossos melhores clientes este mês?"
 *   - "Top 5 clientes por receita em maio."
 *   - "Quais clientes mais gastaram com a gente?"
 *
 * Fase 8 — Ferramentas financeiras da Secretária IA.
 */

import { getTopClients } from "../../FinanceService";
import { formatCurrencyText, buildPeriodLabel, clampLimit } from "./FinanceTools.utils";

interface TopClientesPorValorArgs {
  startDate?: string;
  endDate?: string;
  /** Número de clientes a retornar (1-20, default: 5) */
  limit?: number | string;
}

interface ClienteItem {
  posicao: number;
  nome: string;
  receita: number;
  receitaFormatada: string;
  totalTransacoes: number;
}

interface TopClientesPorValorResult {
  clientes: ClienteItem[];
  total: number;
  periodo: string;
  /** Resumo formatado pronto para enviar via WhatsApp */
  resumo: string;
}

/**
 * Retorna os clientes que mais geraram receita no período.
 *
 * @param args      - { startDate?, endDate?, limit? }
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Lista ranqueada + resumo textual em PT-BR
 */
export async function topClientesPorValor(
  args: TopClientesPorValorArgs,
  companyId: number
): Promise<TopClientesPorValorResult> {
  const { startDate, endDate } = args;
  const limit = clampLimit(args.limit, 20, 5);

  const rows = await getTopClients(companyId, startDate, endDate, limit);
  const periodo = buildPeriodLabel(startDate, endDate);

  const clientes: ClienteItem[] = rows.map((r, i) => ({
    posicao: i + 1,
    nome: r.name,
    receita: r.revenue,
    receitaFormatada: formatCurrencyText(r.revenue),
    totalTransacoes: r.transactionCount,
  }));

  let resumo = "";
  if (clientes.length === 0) {
    resumo = `Nenhuma receita registrada no período *${periodo}*.`;
  } else {
    const medals = ["🥇", "🥈", "🥉"];
    const linhas = clientes.map((c) => {
      const medalha = medals[c.posicao - 1] ?? `${c.posicao}º`;
      return (
        `${medalha} *${c.nome}* — ${c.receitaFormatada}` +
        ` (${c.totalTransacoes} transaç${c.totalTransacoes === 1 ? "ão" : "ões"})`
      );
    });
    resumo =
      `🏆 *Top ${clientes.length} clientes — ${periodo}*\n\n` +
      linhas.join("\n");
  }

  return { clientes, total: clientes.length, periodo, resumo };
}

export const topClientesPorValorDefinition = {
  name: "top_clientes_por_valor",
  description:
    "Retorna os clientes que mais geraram receita para a empresa no período selecionado, em ordem decrescente. Use quando o gestor perguntar sobre melhores clientes, clientes VIP ou ranking de receita por cliente.",
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
        description: "Quantidade de clientes a exibir (1-20). Default: 5.",
      },
    },
    required: [],
  },
};
