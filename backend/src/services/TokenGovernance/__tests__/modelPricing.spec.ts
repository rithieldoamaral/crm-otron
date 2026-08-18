/**
 * Testes TDD para modelPricing — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * Regra central (directives/token_governance.md): o preço usado num registro
 * de consumo é CONGELADO naquele registro. Recalcular consumo antigo com o
 * preço de hoje reescreveria histórico financeiro e invalidaria qualquer
 * valor já informado ao cliente. Provedor chinês muda preço com frequência.
 *
 * Regra 2: modelo sem preço cadastrado NÃO é chutado. Grava custo 0 com
 * `pricingMissing`, e o painel mostra "preço não cadastrado". Estimativa
 * silenciosa produz número errado com aparência de número certo.
 */

import ModelPrice from "../../../models/ModelPrice";
import {
  calculateCost,
  resolvePrice,
  USD_TO_BRL_FALLBACK
} from "../modelPricing";

jest.mock("../../../models/ModelPrice", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

jest.mock("../../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

const mockedFindOne = ModelPrice.findOne as jest.Mock;

describe("resolvePrice", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna o preço cadastrado para o par provider+modelo", async () => {
    mockedFindOne.mockResolvedValue({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputPricePerMillion: 1.0,
      outputPricePerMillion: 5.0,
      cachedInputPricePerMillion: 0.1
    });

    const price = await resolvePrice("anthropic", "claude-haiku-4-5");

    expect(price.pricingMissing).toBe(false);
    expect(price.inputPricePerMillion).toBe(1.0);
    expect(price.outputPricePerMillion).toBe(5.0);
    expect(price.cachedInputPricePerMillion).toBe(0.1);
  });

  it("marca pricingMissing quando o modelo não está cadastrado — sem chutar preço", async () => {
    mockedFindOne.mockResolvedValue(null);

    const price = await resolvePrice("qwen", "modelo-lancado-ontem");

    expect(price.pricingMissing).toBe(true);
    expect(price.inputPricePerMillion).toBe(0);
    expect(price.outputPricePerMillion).toBe(0);
  });

  it("marca pricingMissing quando o banco falha, sem propagar a exceção", async () => {
    // Contabilidade não pode derrubar atendimento (diretiva, regra 3).
    mockedFindOne.mockRejectedValue(new Error("connection refused"));

    const price = await resolvePrice("anthropic", "claude-haiku-4-5");

    expect(price.pricingMissing).toBe(true);
    expect(price.inputPricePerMillion).toBe(0);
  });
});

describe("calculateCost", () => {
  const price = {
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
    cachedInputPricePerMillion: 0.1,
    pricingMissing: false
  };

  it("calcula custo em USD a partir dos tokens e do preço por milhão", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.0,
      markupPercent: 0
    });

    // 1M input a $1 + 1M output a $5 = $6
    expect(result.costUsd).toBeCloseTo(6.0, 6);
  });

  it("cobra o token cacheado pelo preço de cache, não pelo de entrada", () => {
    // A alavanca de economia do módulo: com caching, 1M de prefixo repetido
    // custa 0,10 em vez de 1,00. O painel precisa refletir isso.
    const result = calculateCost({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
      price,
      usdToBrl: 5.0,
      markupPercent: 0
    });

    expect(result.costUsd).toBeCloseTo(0.1, 6);
  });

  it("converte para BRL usando a cotação informada", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.08,
      markupPercent: 0
    });

    expect(result.costUsd).toBeCloseTo(1.0, 6);
    expect(result.costBrl).toBeCloseTo(5.08, 6);
  });

  it("com markup 0, preço cobrado é igual ao custo (fase em que o dono absorve)", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.0,
      markupPercent: 0
    });

    expect(result.priceBrl).toBeCloseTo(result.costBrl, 6);
  });

  it("aplica markup percentual sobre o custo", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.0,
      markupPercent: 30
    });

    // custo 5,00 BRL + 30% = 6,50
    expect(result.costBrl).toBeCloseTo(5.0, 6);
    expect(result.priceBrl).toBeCloseTo(6.5, 6);
  });

  it("devolve custo 0 quando o preço não está cadastrado", () => {
    const result = calculateCost({
      inputTokens: 500_000,
      outputTokens: 500_000,
      cachedInputTokens: 0,
      price: {
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
        cachedInputPricePerMillion: 0,
        pricingMissing: true
      },
      usdToBrl: 5.0,
      markupPercent: 0
    });

    expect(result.costUsd).toBe(0);
    expect(result.costBrl).toBe(0);
    expect(result.pricingMissing).toBe(true);
  });

  it("trata token zerado sem gerar NaN", () => {
    const result = calculateCost({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.0,
      markupPercent: 0
    });

    expect(result.costUsd).toBe(0);
    expect(result.costBrl).toBe(0);
    expect(result.priceBrl).toBe(0);
  });

  it("usa a cotação de fallback quando nenhuma é informada, sem quebrar", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: undefined,
      markupPercent: 0
    });

    expect(result.costBrl).toBeCloseTo(USD_TO_BRL_FALLBACK, 6);
    expect(result.usdToBrlUsed).toBe(USD_TO_BRL_FALLBACK);
  });

  it("registra a cotação efetivamente usada, para o valor ser auditável depois", () => {
    const result = calculateCost({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.42,
      markupPercent: 0
    });

    expect(result.usdToBrlUsed).toBe(5.42);
  });

  it("não perde centavos em volumes pequenos (arredondamento só na exibição)", () => {
    // 1.000 tokens de entrada a $1/1M = $0,001. Arredondar para 2 casas aqui
    // zeraria o valor e, somado em milhares de chamadas, sumiria com o custo.
    const result = calculateCost({
      inputTokens: 1_000,
      outputTokens: 0,
      cachedInputTokens: 0,
      price,
      usdToBrl: 5.0,
      markupPercent: 0
    });

    expect(result.costUsd).toBeCloseTo(0.001, 9);
    expect(result.costBrl).toBeCloseTo(0.005, 9);
    expect(result.costBrl).toBeGreaterThan(0);
  });
});
