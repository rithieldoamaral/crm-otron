/**
 * Testes unitários — FinanceService.utils.ts
 *
 * TDD: testes escritos ANTES da implementação conforme CLAUDE.md §II.1.
 *
 * Funções testadas:
 *   - calculateGrowthRate
 *   - calculateAverageTicket
 *   - getWeekdayName
 *   - applyDateRangeDefaults
 *   - buildPreviousPeriod
 */

import {
  calculateGrowthRate,
  calculateAverageTicket,
  getWeekdayName,
  applyDateRangeDefaults,
  buildPreviousPeriod,
  clampLimit,
} from "../FinanceService.utils";

// ── calculateGrowthRate ───────────────────────────────────────────────────────

describe("calculateGrowthRate", () => {
  it("calcula crescimento positivo corretamente", () => {
    expect(calculateGrowthRate(300, 200)).toBe(50);
  });

  it("calcula crescimento negativo corretamente", () => {
    expect(calculateGrowthRate(100, 200)).toBe(-50);
  });

  it("retorna 0 quando valores são iguais", () => {
    expect(calculateGrowthRate(100, 100)).toBe(0);
  });

  it("retorna null quando período anterior é zero (evita divisão por zero)", () => {
    expect(calculateGrowthRate(100, 0)).toBeNull();
  });

  it("retorna null quando ambos são zero", () => {
    expect(calculateGrowthRate(0, 0)).toBeNull();
  });

  it("arredonda para 1 casa decimal", () => {
    // 133/100 = 33% (exato)
    expect(calculateGrowthRate(133, 100)).toBe(33);
    // 150/120 = 25% (exato)
    expect(calculateGrowthRate(150, 120)).toBe(25);
    // 155/120 = 29.166... → 29.2
    expect(calculateGrowthRate(155, 120)).toBe(29.2);
  });

  it("funciona com valores decimais (receitas reais)", () => {
    // R$ 1.250,00 vs R$ 1.000,00 → 25%
    expect(calculateGrowthRate(1250, 1000)).toBe(25);
  });
});

// ── calculateAverageTicket ────────────────────────────────────────────────────

describe("calculateAverageTicket", () => {
  it("calcula ticket médio corretamente", () => {
    expect(calculateAverageTicket(400, 4)).toBe(100);
  });

  it("retorna null quando count é zero (evita divisão por zero)", () => {
    expect(calculateAverageTicket(400, 0)).toBeNull();
  });

  it("retorna 0 quando receita é zero com transações existentes", () => {
    expect(calculateAverageTicket(0, 5)).toBe(0);
  });

  it("arredonda para 2 casas decimais", () => {
    // 100 / 3 = 33.333... → 33.33
    expect(calculateAverageTicket(100, 3)).toBe(33.33);
  });

  it("funciona com valores grandes", () => {
    expect(calculateAverageTicket(12500, 25)).toBe(500);
  });
});

// ── getWeekdayName ────────────────────────────────────────────────────────────

describe("getWeekdayName", () => {
  it("retorna 'Domingo' para índice 0", () => {
    expect(getWeekdayName(0)).toBe("Domingo");
  });

  it("retorna 'Segunda' para índice 1", () => {
    expect(getWeekdayName(1)).toBe("Segunda");
  });

  it("retorna 'Terça' para índice 2", () => {
    expect(getWeekdayName(2)).toBe("Terça");
  });

  it("retorna 'Quarta' para índice 3", () => {
    expect(getWeekdayName(3)).toBe("Quarta");
  });

  it("retorna 'Quinta' para índice 4", () => {
    expect(getWeekdayName(4)).toBe("Quinta");
  });

  it("retorna 'Sexta' para índice 5", () => {
    expect(getWeekdayName(5)).toBe("Sexta");
  });

  it("retorna 'Sábado' para índice 6", () => {
    expect(getWeekdayName(6)).toBe("Sábado");
  });

  it("retorna 'Desconhecido' para índice inválido (7)", () => {
    expect(getWeekdayName(7)).toBe("Desconhecido");
  });

  it("retorna 'Desconhecido' para índice negativo", () => {
    expect(getWeekdayName(-1)).toBe("Desconhecido");
  });
});

// ── applyDateRangeDefaults ────────────────────────────────────────────────────

describe("applyDateRangeDefaults", () => {
  // Data de referência fixa para testes determinísticos
  const ref = new Date("2026-05-22T12:00:00Z");

  it("usa a data fornecida como startDate quando informada", () => {
    const { start } = applyDateRangeDefaults("2026-05-01", undefined, ref);
    expect(start.toISOString().startsWith("2026-05-01")).toBe(true);
  });

  it("usa a data fornecida como endDate quando informada", () => {
    const { end } = applyDateRangeDefaults(undefined, "2026-05-31", ref);
    expect(end.toISOString().startsWith("2026-05-31")).toBe(true);
  });

  it("default de start é o início do mês atual (dia 1, 00:00:00)", () => {
    const { start } = applyDateRangeDefaults(undefined, undefined, ref);
    // Mês de referência: maio 2026 → 2026-05-01T00:00:00
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(4); // 0-indexed: 4 = maio
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
  });

  it("default de end é a data de referência (agora)", () => {
    const { end } = applyDateRangeDefaults(undefined, undefined, ref);
    expect(end.getTime()).toBe(ref.getTime());
  });

  it("aceita ambas as datas explicitamente", () => {
    const { start, end } = applyDateRangeDefaults("2026-04-01", "2026-04-30", ref);
    expect(start.toISOString().startsWith("2026-04-01")).toBe(true);
    expect(end.toISOString().startsWith("2026-04-30")).toBe(true);
  });

  // ── Bug de timezone: endDate como YYYY-MM-DD deve cobrir o dia inteiro ─────
  // Antes do fix: endDate="2026-05-22" virava 2026-05-22T00:00:00Z (início).
  // Resultado: query BETWEEN start AND end perdia TODO o dia 22.

  it("endDate em YYYY-MM-DD é estendido para fim do dia (23:59:59.999Z)", () => {
    const { end } = applyDateRangeDefaults(undefined, "2026-05-22", ref);
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(4); // maio
    expect(end.getUTCDate()).toBe(22);
    expect(end.getUTCHours()).toBe(23);
    expect(end.getUTCMinutes()).toBe(59);
    expect(end.getUTCSeconds()).toBe(59);
  });

  it("startDate em YYYY-MM-DD é mantido em início do dia (00:00:00.000Z)", () => {
    const { start } = applyDateRangeDefaults("2026-05-01", undefined, ref);
    expect(start.getUTCFullYear()).toBe(2026);
    expect(start.getUTCMonth()).toBe(4);
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getUTCSeconds()).toBe(0);
  });

  it("endDate com timestamp explícito é preservado sem alteração", () => {
    const { end } = applyDateRangeDefaults(
      undefined,
      "2026-05-22T15:30:00Z",
      ref
    );
    expect(end.getUTCHours()).toBe(15);
    expect(end.getUTCMinutes()).toBe(30);
  });

  it("startDate inválido cai no default (1º do mês)", () => {
    const { start } = applyDateRangeDefaults("data-invalida", undefined, ref);
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCMonth()).toBe(4); // maio
  });

  it("endDate inválido cai no default (referência)", () => {
    const { end } = applyDateRangeDefaults(undefined, "data-invalida", ref);
    expect(end.getTime()).toBe(ref.getTime());
  });

  it("strings vazias caem no default", () => {
    const { start, end } = applyDateRangeDefaults("", "", ref);
    expect(start.getUTCDate()).toBe(1);
    expect(end.getTime()).toBe(ref.getTime());
  });

  it("cenário real: período 'maio inteiro' captura registro do dia 22 às 14h", () => {
    // Registro feito em 22/05 às 14:00 BRT (17:00 UTC)
    const registroOccurredAt = new Date("2026-05-22T17:00:00Z");
    const { start, end } = applyDateRangeDefaults("2026-05-01", "2026-05-22", ref);
    // Antes do fix: end = 00:00 UTC do dia 22, registro às 17:00 ficaria FORA do intervalo
    expect(registroOccurredAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(registroOccurredAt.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

// ── buildPreviousPeriod ───────────────────────────────────────────────────────

describe("buildPreviousPeriod", () => {
  it("período de 30 dias → anterior recua 30 dias", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-05-31T00:00:00Z");
    const { start: prevStart, end: prevEnd } = buildPreviousPeriod(start, end);
    // Duração = 30 dias → recua 30 dias
    expect(prevStart.toISOString().startsWith("2026-04-01")).toBe(true);
    expect(prevEnd.toISOString().startsWith("2026-05-01")).toBe(true);
  });

  it("período de 1 dia → anterior recua 1 dia", () => {
    const start = new Date("2026-05-22T00:00:00Z");
    const end = new Date("2026-05-23T00:00:00Z");
    const { start: prevStart, end: prevEnd } = buildPreviousPeriod(start, end);
    expect(prevStart.toISOString().startsWith("2026-05-21")).toBe(true);
    expect(prevEnd.toISOString().startsWith("2026-05-22")).toBe(true);
  });

  it("período de 7 dias → anterior recua 7 dias", () => {
    const start = new Date("2026-05-15T00:00:00Z");
    const end = new Date("2026-05-22T00:00:00Z");
    const { start: prevStart, end: prevEnd } = buildPreviousPeriod(start, end);
    expect(prevStart.toISOString().startsWith("2026-05-08")).toBe(true);
    expect(prevEnd.toISOString().startsWith("2026-05-15")).toBe(true);
  });

  it("preserva a duração exata do período original", () => {
    const start = new Date("2026-05-01T00:00:00Z");
    const end = new Date("2026-05-22T12:00:00Z");
    const { start: prevStart, end: prevEnd } = buildPreviousPeriod(start, end);
    const originalDuration = end.getTime() - start.getTime();
    const prevDuration = prevEnd.getTime() - prevStart.getTime();
    expect(prevDuration).toBe(originalDuration);
  });
});

// ── clampLimit ────────────────────────────────────────────────────────────────

describe("clampLimit", () => {
  it("retorna o valor numérico quando válido e dentro do max", () => {
    expect(clampLimit(5, 10, 3)).toBe(5);
  });

  it("converte string numérica", () => {
    expect(clampLimit("8", 20, 10)).toBe(8);
  });

  it("retorna default quando undefined", () => {
    expect(clampLimit(undefined, 20, 10)).toBe(10);
  });

  it("retorna default quando null", () => {
    expect(clampLimit(null, 20, 10)).toBe(10);
  });

  it("retorna default quando string não numérica", () => {
    expect(clampLimit("abc", 20, 10)).toBe(10);
  });

  it("retorna default quando zero", () => {
    expect(clampLimit(0, 20, 10)).toBe(10);
  });

  it("retorna default quando negativo", () => {
    expect(clampLimit(-5, 20, 10)).toBe(10);
  });

  it("respeita o teto máximo (clamp para max)", () => {
    expect(clampLimit(100, 20, 10)).toBe(20);
  });

  it("usa defaults de max=50 e def=10 quando omitidos", () => {
    expect(clampLimit(7)).toBe(7);
    expect(clampLimit(200)).toBe(50);
    expect(clampLimit(undefined)).toBe(10);
  });

  it("aceita float e arredonda para baixo", () => {
    expect(clampLimit(4.9, 10, 3)).toBe(4);
  });

  it("retorna default para Infinity e NaN", () => {
    expect(clampLimit(Infinity, 20, 10)).toBe(10);
    expect(clampLimit(NaN, 20, 10)).toBe(10);
  });

  it("retorna default para objeto/array", () => {
    expect(clampLimit({}, 20, 10)).toBe(10);
    expect(clampLimit([], 20, 10)).toBe(10);
  });
});
