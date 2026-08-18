/**
 * Testes TDD para usageReports — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * O foco aqui é a LÓGICA DERIVADA, separada da query de propósito: métrica
 * calculada errada é bug silencioso (o painel mostra um número plausível e
 * ninguém percebe), enquanto query quebrada falha alto.
 *
 * A métrica que importa neste domínio é CUSTO POR ATENDIMENTO. Token é
 * unidade interna; o número que revela problema é quanto custa cada conversa,
 * porque é ele que denuncia empresa com conversas anormalmente longas.
 */

// Mocka o MÓDULO DE BANCO, não o model: database/index.ts registra todos os
// models no boot, e mockar um model faria o registro receber um objeto
// simulado no lugar de uma classe. Estes testes exercitam só a lógica pura.
import {
  computeDerivedMetrics,
  resolvePeriod,
  UsageAggregateRow
} from "../usageReports";

jest.mock("../../../database", () => ({
  __esModule: true,
  default: { query: jest.fn() }
}));

jest.mock("../../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

const row = (over: Partial<UsageAggregateRow> = {}): UsageAggregateRow => ({
  companyId: 7,
  companyName: "Empresa Teste",
  totalCalls: 100,
  distinctTickets: 20,
  inputTokens: 2_200_000,
  outputTokens: 30_000,
  cachedInputTokens: 0,
  costBrl: 50,
  priceBrl: 50,
  pricingMissingCalls: 0,
  usageMissingCalls: 0,
  ...over
});

describe("computeDerivedMetrics", () => {
  it("calcula custo por atendimento — a métrica que denuncia conversa longa", () => {
    const [m] = computeDerivedMetrics([
      row({ costBrl: 50, distinctTickets: 20 })
    ]);

    expect(m.costPerTicketBrl).toBeCloseTo(2.5, 6);
  });

  it("não divide por zero quando não houve atendimento no período", () => {
    // Secretária opera fora de ticket: é possível haver consumo com
    // distinctTickets = 0. Dividir aqui geraria Infinity no painel.
    const [m] = computeDerivedMetrics([
      row({ costBrl: 10, distinctTickets: 0 })
    ]);

    expect(m.costPerTicketBrl).toBe(0);
    expect(Number.isFinite(m.costPerTicketBrl)).toBe(true);
  });

  it("calcula tokens por atendimento", () => {
    const [m] = computeDerivedMetrics([
      row({
        inputTokens: 2_000_000,
        outputTokens: 100_000,
        distinctTickets: 100
      })
    ]);

    expect(m.tokensPerTicket).toBeCloseTo(21_000, 4);
  });

  it("calcula a margem quando há markup aplicado", () => {
    const [m] = computeDerivedMetrics([row({ costBrl: 100, priceBrl: 130 })]);

    expect(m.marginBrl).toBeCloseTo(30, 6);
    expect(m.marginPercent).toBeCloseTo(30, 4);
  });

  it("margem é zero na fase em que o dono absorve o custo (markup 0)", () => {
    const [m] = computeDerivedMetrics([row({ costBrl: 100, priceBrl: 100 })]);

    expect(m.marginBrl).toBeCloseTo(0, 6);
    expect(m.marginPercent).toBe(0);
  });

  it("sinaliza a empresa quando algum modelo está sem preço cadastrado", () => {
    // Sem isso, custo 0 pareceria "empresa barata" quando na verdade é
    // "não sabemos quanto custou".
    const [m] = computeDerivedMetrics([row({ pricingMissingCalls: 12 })]);

    expect(m.hasPricingGaps).toBe(true);
  });

  it("sinaliza quando o provider não reportou uso em parte das chamadas", () => {
    const [m] = computeDerivedMetrics([row({ usageMissingCalls: 3 })]);

    expect(m.hasUsageGaps).toBe(true);
  });

  it("calcula o percentual de entrada servido por cache (alavanca de economia)", () => {
    const [m] = computeDerivedMetrics([
      row({ inputTokens: 750_000, cachedInputTokens: 250_000 })
    ]);

    // 250k de 1M total de entrada = 25%
    expect(m.cacheHitPercent).toBeCloseTo(25, 4);
  });

  it("cache é 0% enquanto o prompt caching não estiver ativado", () => {
    const [m] = computeDerivedMetrics([
      row({ inputTokens: 1_000_000, cachedInputTokens: 0 })
    ]);

    expect(m.cacheHitPercent).toBe(0);
  });

  it("ordena as empresas por custo decrescente — maior consumidor primeiro", () => {
    const metrics = computeDerivedMetrics([
      row({ companyId: 1, costBrl: 10 }),
      row({ companyId: 2, costBrl: 90 }),
      row({ companyId: 3, costBrl: 50 })
    ]);

    expect(metrics.map(m => m.companyId)).toEqual([2, 3, 1]);
  });

  it("devolve lista vazia sem quebrar quando não há consumo", () => {
    expect(computeDerivedMetrics([])).toEqual([]);
  });
});

describe("resolvePeriod", () => {
  it("usa o intervalo informado quando as duas datas vêm válidas", () => {
    const p = resolvePeriod("2026-08-01", "2026-08-31");

    expect(p.startDate.toISOString().slice(0, 10)).toBe("2026-08-01");
    // Fim do dia: senão o último dia do período ficaria de fora do relatório.
    expect(p.endDate.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(p.endDate.getUTCHours()).toBe(23);
  });

  it("cai para os últimos 30 dias quando nada é informado", () => {
    const p = resolvePeriod(undefined, undefined);
    const dias = (p.endDate.getTime() - p.startDate.getTime()) / 86_400_000;

    expect(dias).toBeGreaterThan(29);
    expect(dias).toBeLessThan(32);
  });

  it("rejeita data em formato inválido em vez de virar Invalid Date silencioso", () => {
    expect(() => resolvePeriod("ontem", "2026-08-31")).toThrow();
  });

  it("rejeita intervalo invertido", () => {
    expect(() => resolvePeriod("2026-08-31", "2026-08-01")).toThrow();
  });
});
