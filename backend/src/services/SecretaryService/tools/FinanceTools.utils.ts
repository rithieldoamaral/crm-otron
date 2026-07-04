/**
 * FinanceTools.utils.ts — Fase 8.
 *
 * Funções puras (zero I/O) compartilhadas pelos 5 tools financeiros da Secretária:
 *   - consultar_faturamento
 *   - top_clientes_por_valor
 *   - top_servicos_por_receita
 *   - dia_mais_lucrativo
 *   - comparar_periodos
 *
 * Sem imports de Sequelize, modelos ou APIs: 100% testável em Jest puro.
 */

import type { RevenueByWeekdayItem } from "../../FinanceService";

// `clampLimit` foi promovida a utility compartilhada em FinanceService.utils.ts
// (CLAUDE.md §II.4 — DRY: usada também por FinanceController).
// Re-exportada aqui para manter a API pública das tools intacta.
export { clampLimit } from "../../FinanceService/FinanceService.utils";

// ── findMostProfitableWeekday ─────────────────────────────────────────────────

/**
 * Retorna o dia da semana com a maior receita no array fornecido.
 * Em caso de empate retorna o primeiro elemento com o maior valor.
 *
 * @param weekdays - Array de receita por dia da semana
 * @returns O item de maior receita, ou null se o array estiver vazio
 *
 * @example
 * const best = findMostProfitableWeekday(weekdays);
 * // → { weekday: "Quarta", dayIndex: 3, revenue: 1500, count: 10 }
 */
export function findMostProfitableWeekday(
  weekdays: RevenueByWeekdayItem[]
): RevenueByWeekdayItem | null {
  if (weekdays.length === 0) return null;

  // Reduce em vez de sort para preservar a ordem original em empates
  return weekdays.reduce((best, current) =>
    current.revenue > best.revenue ? current : best
  );
}

// ── formatCurrencyText ────────────────────────────────────────────────────────

/**
 * Formata um valor numérico como moeda BRL para texto (WhatsApp).
 * Usa toLocaleString com pt-BR; resultado: "R$ 1.234,56".
 *
 * @param value - Valor numérico em reais
 * @returns String formatada em BRL (ex: "R$ 500,00")
 *
 * @example
 * formatCurrencyText(1234.56) // "R$ 1.234,56"
 * formatCurrencyText(0)       // "R$ 0,00"
 */
export function formatCurrencyText(value: number): string {
  // toLocaleString("pt-BR") emite U+00A0 (non-breaking space) entre "R$" e o número.
  // Normalizamos para espaço ASCII para que o output seja previsível em testes e
  // legível em clientes WhatsApp que não renderizam NBSP corretamente.
  return Number(value)
    .toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/ /g, " ");
}

// ── buildPeriodLabel ──────────────────────────────────────────────────────────

/**
 * Gera um label humanizado do período para uso nas respostas da Secretária.
 * Datas no formato ISO "YYYY-MM-DD" são convertidas para "dd/mm/aaaa".
 *
 * @param startDate - Data de início (ISO ou vazia)
 * @param endDate   - Data de fim (ISO ou vazia)
 * @returns Label humanizado do período
 *
 * @example
 * buildPeriodLabel("2026-05-01", "2026-05-22") // "01/05/2026 → 22/05/2026"
 * buildPeriodLabel("2026-04-01", "")            // "a partir de 01/04/2026"
 * buildPeriodLabel("", "2026-05-31")            // "até 31/05/2026"
 * buildPeriodLabel()                            // "mês atual"
 */
export function buildPeriodLabel(startDate?: string, endDate?: string): string {
  const hasStart = Boolean(startDate && startDate.trim());
  const hasEnd = Boolean(endDate && endDate.trim());

  const fmt = (iso: string): string => {
    // ISO "YYYY-MM-DD" → "dd/mm/aaaa"
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  if (!hasStart && !hasEnd) return "mês atual";
  if (hasStart && hasEnd) return `${fmt(startDate!)} → ${fmt(endDate!)}`;
  if (hasStart) return `a partir de ${fmt(startDate!)}`;
  return `até ${fmt(endDate!)}`;
}
