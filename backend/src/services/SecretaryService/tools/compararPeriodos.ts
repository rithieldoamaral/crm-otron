/**
 * Tool: comparar_periodos
 *
 * Permite ao agente secretária (AI) comparar a receita entre dois períodos
 * explicitamente definidos pelo gestor (ex: abril vs março, semana 1 vs semana 2).
 *
 * Diferença de `consultar_faturamento`: aqui o gestor escolhe AMBOS os períodos.
 * Em `consultar_faturamento` o período anterior é calculado automaticamente.
 *
 * Exemplos de uso pelo agente:
 *   - "Compare o faturamento de março com abril."
 *   - "Primeira quinzena vs segunda quinzena de maio."
 *   - "Quanto crescemos de 2025 para 2026?"
 *
 * Fase 8 — Ferramentas financeiras da Secretária IA.
 */

import { getFinanceSummary } from "../../FinanceService";
import { formatCurrencyText, buildPeriodLabel } from "./FinanceTools.utils";

interface CompararPeriodosArgs {
  /** Início do período 1 (ISO "YYYY-MM-DD") */
  periodo1Start: string;
  /** Fim do período 1 (ISO "YYYY-MM-DD") */
  periodo1End: string;
  /** Início do período 2 (ISO "YYYY-MM-DD") */
  periodo2Start: string;
  /** Fim do período 2 (ISO "YYYY-MM-DD") */
  periodo2End: string;
}

interface PeriodoInfo {
  label: string;
  receita: number;
  receitaFormatada: string;
  totalTransacoes: number;
  ticketMedio: number | null;
  ticketMedioFormatado: string;
}

interface CompararPeriodosResult {
  periodo1: PeriodoInfo;
  periodo2: PeriodoInfo;
  crescimentoPercent: number | null;
  periodo2EhMaior: boolean | null;
  /** Resumo formatado pronto para enviar via WhatsApp */
  resumo: string;
}

/**
 * Compara a receita entre dois períodos explicitamente definidos.
 *
 * @param args      - Quatro datas: periodo1Start/End e periodo2Start/End
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Comparação com crescimento % + resumo textual em PT-BR
 */
export async function compararPeriodos(
  args: CompararPeriodosArgs,
  companyId: number
): Promise<CompararPeriodosResult> {
  const { periodo1Start, periodo1End, periodo2Start, periodo2End } = args;

  // Busca os dois períodos em paralelo para performance
  const [s1, s2] = await Promise.all([
    getFinanceSummary(companyId, periodo1Start, periodo1End),
    getFinanceSummary(companyId, periodo2Start, periodo2End),
  ]);

  const label1 = buildPeriodLabel(periodo1Start, periodo1End);
  const label2 = buildPeriodLabel(periodo2Start, periodo2End);

  const p1: PeriodoInfo = {
    label: label1,
    receita: s1.totalRevenue,
    receitaFormatada: formatCurrencyText(s1.totalRevenue),
    totalTransacoes: s1.transactionCount,
    ticketMedio: s1.averageTicket,
    ticketMedioFormatado: s1.averageTicket != null
      ? formatCurrencyText(s1.averageTicket)
      : "—",
  };

  const p2: PeriodoInfo = {
    label: label2,
    receita: s2.totalRevenue,
    receitaFormatada: formatCurrencyText(s2.totalRevenue),
    totalTransacoes: s2.transactionCount,
    ticketMedio: s2.averageTicket,
    ticketMedioFormatado: s2.averageTicket != null
      ? formatCurrencyText(s2.averageTicket)
      : "—",
  };

  // Calcula crescimento de período 1 → período 2
  let crescimentoPercent: number | null = null;
  let periodo2EhMaior: boolean | null = null;
  if (s1.totalRevenue > 0) {
    const raw = ((s2.totalRevenue - s1.totalRevenue) / s1.totalRevenue) * 100;
    crescimentoPercent = Math.round(raw * 10) / 10; // 1 casa decimal
    periodo2EhMaior = s2.totalRevenue >= s1.totalRevenue;
  } else if (s2.totalRevenue > 0) {
    // Período 1 zerado mas período 2 tem receita
    crescimentoPercent = null;
    periodo2EhMaior = true;
  }

  // ── Resumo WhatsApp ───────────────────────────────────────────────────────
  const tendencia =
    crescimentoPercent === null
      ? "Sem base para comparação (período 1 sem receita)."
      : periodo2EhMaior
      ? `📈 *+${crescimentoPercent}%* em relação ao período anterior.`
      : `📉 *${crescimentoPercent}%* em relação ao período anterior.`;

  const resumo =
    `📊 *Comparativo de períodos*\n\n` +
    `*${label1}*\n` +
    `  Receita: ${p1.receitaFormatada} | ${p1.totalTransacoes} transaç${p1.totalTransacoes === 1 ? "ão" : "ões"} | TM: ${p1.ticketMedioFormatado}\n\n` +
    `*${label2}*\n` +
    `  Receita: ${p2.receitaFormatada} | ${p2.totalTransacoes} transaç${p2.totalTransacoes === 1 ? "ão" : "ões"} | TM: ${p2.ticketMedioFormatado}\n\n` +
    tendencia;

  return { periodo1: p1, periodo2: p2, crescimentoPercent, periodo2EhMaior, resumo };
}

export const compararPeriodosDefinition = {
  name: "comparar_periodos",
  description:
    "Compara a receita entre dois períodos explicitamente definidos pelo gestor (ex: março vs abril, 1ª quinzena vs 2ª quinzena). Diferente de 'consultar_faturamento' onde o período anterior é automático — aqui o gestor especifica os dois intervalos.",
  parameters: {
    type: "object",
    properties: {
      periodo1Start: {
        type: "string",
        description: "Início do 1º período (YYYY-MM-DD). Ex: '2026-04-01'.",
      },
      periodo1End: {
        type: "string",
        description: "Fim do 1º período (YYYY-MM-DD). Ex: '2026-04-30'.",
      },
      periodo2Start: {
        type: "string",
        description: "Início do 2º período (YYYY-MM-DD). Ex: '2026-05-01'.",
      },
      periodo2End: {
        type: "string",
        description: "Fim do 2º período (YYYY-MM-DD). Ex: '2026-05-31'.",
      },
    },
    required: ["periodo1Start", "periodo1End", "periodo2Start", "periodo2End"],
  },
};
