/**
 * Testes TDD para FinanceTools.utils.ts — Fase 8.
 *
 * Cobre as funções puras LOCAIS das ferramentas financeiras da Secretária:
 *   - findMostProfitableWeekday
 *   - formatCurrencyText
 *   - buildPeriodLabel
 *
 * Nota: `clampLimit` foi promovida a utility compartilhada em FinanceService.utils.ts
 * (CLAUDE.md §II.4 — DRY) e testada em FinanceService.spec.ts.
 *
 * Sem I/O: zero imports de Sequelize, API ou modelos.
 */

import {
  findMostProfitableWeekday,
  formatCurrencyText,
  buildPeriodLabel,
} from "../FinanceTools.utils";
import type { RevenueByWeekdayItem } from "../../../FinanceService";

// ── findMostProfitableWeekday ─────────────────────────────────────────────────

describe("findMostProfitableWeekday", () => {
  it("retorna null para array vazio", () => {
    expect(findMostProfitableWeekday([])).toBeNull();
  });

  it("retorna o único item quando array tem 1 elemento", () => {
    const item: RevenueByWeekdayItem = {
      weekday: "Segunda",
      dayIndex: 1,
      revenue: 500,
      count: 5,
    };
    expect(findMostProfitableWeekday([item])).toEqual(item);
  });

  it("retorna o dia com maior revenue", () => {
    const items: RevenueByWeekdayItem[] = [
      { weekday: "Segunda", dayIndex: 1, revenue: 300, count: 3 },
      { weekday: "Quarta", dayIndex: 3, revenue: 1500, count: 10 },
      { weekday: "Sexta", dayIndex: 5, revenue: 900, count: 7 },
    ];
    const result = findMostProfitableWeekday(items);
    expect(result?.weekday).toBe("Quarta");
    expect(result?.revenue).toBe(1500);
  });

  it("retorna o primeiro item em caso de empate", () => {
    const items: RevenueByWeekdayItem[] = [
      { weekday: "Segunda", dayIndex: 1, revenue: 1000, count: 5 },
      { weekday: "Sexta", dayIndex: 5, revenue: 1000, count: 8 },
    ];
    const result = findMostProfitableWeekday(items);
    expect(result?.weekday).toBe("Segunda");
  });

  it("funciona com revenue igual a zero", () => {
    const items: RevenueByWeekdayItem[] = [
      { weekday: "Domingo", dayIndex: 0, revenue: 0, count: 0 },
      { weekday: "Sábado", dayIndex: 6, revenue: 0, count: 0 },
    ];
    const result = findMostProfitableWeekday(items);
    expect(result?.weekday).toBe("Domingo"); // primeiro elemento
  });

  it("lida com revenue negativo (dados corrompidos) sem explodir", () => {
    const items: RevenueByWeekdayItem[] = [
      { weekday: "Segunda", dayIndex: 1, revenue: -100, count: 0 },
      { weekday: "Terça", dayIndex: 2, revenue: 50, count: 2 },
    ];
    const result = findMostProfitableWeekday(items);
    expect(result?.weekday).toBe("Terça");
  });
});

// ── formatCurrencyText ────────────────────────────────────────────────────────

describe("formatCurrencyText", () => {
  it("formata zero corretamente", () => {
    expect(formatCurrencyText(0)).toBe("R$ 0,00");
  });

  it("formata valor simples sem separador de milhar", () => {
    expect(formatCurrencyText(199.9)).toBe("R$ 199,90");
  });

  it("formata valor com centavos exatos", () => {
    expect(formatCurrencyText(1234.56)).toBe("R$ 1.234,56");
  });

  it("formata valor inteiro (sem centavos fracionados)", () => {
    expect(formatCurrencyText(500)).toBe("R$ 500,00");
  });

  it("formata valor grande com múltiplos separadores de milhar", () => {
    expect(formatCurrencyText(1000000)).toBe("R$ 1.000.000,00");
  });

  it("formata valor fracionado sem arredondamento surpresa", () => {
    // 0.1 + 0.2 = 0.30000000000000004 — deve arredondar para 2 casas
    expect(formatCurrencyText(0.1 + 0.2)).toBe("R$ 0,30");
  });

  it("formata valor negativo (sem explodir)", () => {
    const result = formatCurrencyText(-50);
    expect(result).toContain("50");
    expect(result).toContain("R$");
  });
});

// ── buildPeriodLabel ──────────────────────────────────────────────────────────

describe("buildPeriodLabel", () => {
  it("retorna 'mês atual' quando ambas as datas são omitidas", () => {
    expect(buildPeriodLabel()).toBe("mês atual");
  });

  it("retorna 'mês atual' quando ambas as strings são vazias", () => {
    expect(buildPeriodLabel("", "")).toBe("mês atual");
  });

  it("formata intervalo com ambas as datas no padrão dd/mm/aaaa", () => {
    expect(buildPeriodLabel("2026-05-01", "2026-05-22")).toBe(
      "01/05/2026 → 22/05/2026"
    );
  });

  it("formata quando apenas startDate é fornecida", () => {
    expect(buildPeriodLabel("2026-04-01", "")).toBe("a partir de 01/04/2026");
  });

  it("formata quando apenas endDate é fornecida", () => {
    expect(buildPeriodLabel("", "2026-05-31")).toBe("até 31/05/2026");
  });

  it("lida com datas em diferentes meses e anos", () => {
    expect(buildPeriodLabel("2025-12-15", "2026-01-14")).toBe(
      "15/12/2025 → 14/01/2026"
    );
  });
});
