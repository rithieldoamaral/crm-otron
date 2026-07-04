/**
 * Tool: dia_mais_lucrativo
 *
 * Permite ao agente secretária (AI) identificar qual dia da semana gerou
 * mais receita no período, com o ranking completo dos 7 dias.
 *
 * Exemplos de uso pelo agente:
 *   - "Qual é o dia mais lucrativo da semana?"
 *   - "Que dia da semana a gente fatura mais?"
 *   - "Ranking de receita por dia da semana neste mês."
 *
 * Fase 8 — Ferramentas financeiras da Secretária IA.
 */

import { getRevenueByWeekday } from "../../FinanceService";
import {
  findMostProfitableWeekday,
  formatCurrencyText,
  buildPeriodLabel,
} from "./FinanceTools.utils";

interface DiaMaisLucrativoArgs {
  startDate?: string;
  endDate?: string;
}

interface DiaItem {
  posicao: number;
  dia: string;
  dayIndex: number;
  receita: number;
  receitaFormatada: string;
  totalAtendimentos: number;
}

interface DiaMaisLucrativoResult {
  diaMaisLucrativo: string | null;
  receitaDiaMaisLucrativo: number | null;
  ranking: DiaItem[];
  periodo: string;
  /** Resumo formatado pronto para enviar via WhatsApp */
  resumo: string;
}

/**
 * Retorna o dia da semana com maior receita e o ranking completo.
 *
 * @param args      - { startDate?, endDate? }
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Dia mais lucrativo + ranking + resumo textual em PT-BR
 */
export async function diaMaisLucrativo(
  args: DiaMaisLucrativoArgs,
  companyId: number
): Promise<DiaMaisLucrativoResult> {
  const { startDate, endDate } = args;

  const rows = await getRevenueByWeekday(companyId, startDate, endDate);
  const periodo = buildPeriodLabel(startDate, endDate);
  const melhor = findMostProfitableWeekday(rows);

  // Ordenar por receita decrescente para montar ranking
  const ordenado = [...rows].sort((a, b) => b.revenue - a.revenue);

  const ranking: DiaItem[] = ordenado.map((r, i) => ({
    posicao: i + 1,
    dia: r.weekday,
    dayIndex: r.dayIndex,
    receita: r.revenue,
    receitaFormatada: formatCurrencyText(r.revenue),
    totalAtendimentos: r.count,
  }));

  let resumo = "";
  if (!melhor || melhor.revenue === 0) {
    resumo = `Sem dados de receita no período *${periodo}*.`;
  } else {
    const rankingLinhas = ranking
      .slice(0, 5) // exibe top 5 no WhatsApp para não poluir
      .map((d) => {
        const emoji = d.posicao === 1 ? "⭐" : `${d.posicao}º`;
        return `${emoji} *${d.dia}* — ${d.receitaFormatada} (${d.totalAtendimentos} atend.)`;
      });

    resumo =
      `📅 *Dia mais lucrativo — ${periodo}*\n\n` +
      `🏆 *${melhor.weekday}* com ${formatCurrencyText(melhor.revenue)}\n\n` +
      `Ranking da semana:\n${rankingLinhas.join("\n")}`;
  }

  return {
    diaMaisLucrativo: melhor?.weekday ?? null,
    receitaDiaMaisLucrativo: melhor?.revenue ?? null,
    ranking,
    periodo,
    resumo,
  };
}

export const diaMaisLucrativoDefinition = {
  name: "dia_mais_lucrativo",
  description:
    "Identifica qual dia da semana gerou mais receita no período e retorna o ranking completo dos dias. Use quando o gestor quiser saber os dias mais movimentados ou para otimizar escala de funcionários.",
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
    },
    required: [],
  },
};
