/**
 * Testes TDD para recordTokenUsage — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * Este serviço existe para corrigir o bug que motivou o módulo inteiro:
 * `AgentAction.create` era chamado DENTRO do laço de tool calls, então
 *
 *   - turno com N tools  → N linhas, cada uma com o consumo INTEIRO → conta N×
 *   - turno só de texto  → nenhuma linha → consumo perdido
 *
 * Num agente de atendimento a maioria dos turnos é texto puro, então o
 * somatório subcontava o grosso e inflava o resto. Os dois primeiros testes
 * deste arquivo travam esse comportamento para sempre.
 */

import TokenUsage from "../../../models/TokenUsage";
import { resolvePrice, calculateCost } from "../modelPricing";
import recordTokenUsage from "../recordTokenUsage";

jest.mock("../../../models/TokenUsage", () => ({
  __esModule: true,
  default: { create: jest.fn() }
}));

jest.mock("../modelPricing", () => ({
  resolvePrice: jest.fn(),
  calculateCost: jest.fn(),
  USD_TO_BRL_FALLBACK: 5.08
}));

jest.mock("../../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

const mockedCreate = TokenUsage.create as jest.Mock;
const mockedResolvePrice = resolvePrice as jest.Mock;
const mockedCalculateCost = calculateCost as jest.Mock;

const baseParams = {
  companyId: 7,
  ticketId: 42,
  source: "agent" as const,
  provider: "anthropic",
  model: "claude-haiku-4-5",
  markupPercent: 0,
  usdToBrl: 5.08
};

describe("recordTokenUsage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreate.mockResolvedValue({ id: 1 });
    mockedResolvePrice.mockResolvedValue({
      inputPricePerMillion: 1,
      outputPricePerMillion: 5,
      cachedInputPricePerMillion: 0.1,
      pricingMissing: false
    });
    mockedCalculateCost.mockReturnValue({
      costUsd: 0.027,
      costBrl: 0.137,
      priceBrl: 0.137,
      usdToBrlUsed: 5.08,
      pricingMissing: false
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Os dois testes que existem por causa do bug
  // ══════════════════════════════════════════════════════════════════

  it("grava UMA linha por chamada, mesmo que o turno tenha várias tool calls", async () => {
    // Antes: 3 tools geravam 3 linhas com o consumo inteiro em cada uma.
    // O serviço é chamado uma vez por chamada ao LLM, independente de
    // quantas tools o modelo pediu naquele turno.
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 22_000, outputTokens: 300 },
      toolCallCount: 3
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      inputTokens: 22_000,
      outputTokens: 300
    });
  });

  it("grava o consumo de turno SEM nenhuma tool call (o consumo que sumia)", async () => {
    // A maioria dos turnos de atendimento é texto puro: "bom dia",
    // "quanto custa?", "ok obrigado". Antes, nada disso era contabilizado.
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 18_500, outputTokens: 120 },
      toolCallCount: 0
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      inputTokens: 18_500,
      outputTokens: 120
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Congelamento de preço
  // ══════════════════════════════════════════════════════════════════

  it("congela o preço usado na própria linha de consumo", async () => {
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 1000, outputTokens: 100 }
    });

    // Sem isso, mudar o preço do modelo amanhã reescreveria o custo de hoje.
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      inputPricePerMillion: 1,
      outputPricePerMillion: 5,
      cachedInputPricePerMillion: 0.1,
      usdToBrlUsed: 5.08
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Regra 3 da diretiva: contabilidade nunca derruba atendimento
  // ══════════════════════════════════════════════════════════════════

  it("NÃO propaga exceção quando a gravação falha", async () => {
    mockedCreate.mockRejectedValue(new Error("deadlock detected"));

    // Se isto lançasse, o cliente final ficaria sem resposta porque a
    // contabilidade falhou — inaceitável numa plataforma de atendimento.
    await expect(
      recordTokenUsage({
        ...baseParams,
        usage: { inputTokens: 1000, outputTokens: 100 }
      })
    ).resolves.toBeNull();
  });

  it("loga com contexto quando a gravação falha (proibido catch silencioso)", async () => {
    // eslint-disable-next-line global-require
    const { logger } = require("../../../utils/logger");
    mockedCreate.mockRejectedValue(new Error("deadlock detected"));

    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 1000, outputTokens: 100 }
    });

    expect(logger.error).toHaveBeenCalled();
    const logged = logger.error.mock.calls[0][0];
    expect(logged).toMatchObject({ companyId: 7, model: "claude-haiku-4-5" });
  });

  // ══════════════════════════════════════════════════════════════════
  // Edge cases da diretiva
  // ══════════════════════════════════════════════════════════════════

  it("marca usageMissing quando o provider não devolve usage — sem estimar", async () => {
    await recordTokenUsage({ ...baseParams, usage: undefined });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      usageMissing: true,
      inputTokens: 0,
      outputTokens: 0
    });
  });

  it("propaga pricingMissing quando o modelo não tem preço cadastrado", async () => {
    mockedResolvePrice.mockResolvedValue({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      cachedInputPricePerMillion: 0,
      pricingMissing: true
    });
    mockedCalculateCost.mockReturnValue({
      costUsd: 0,
      costBrl: 0,
      priceBrl: 0,
      usdToBrlUsed: 5.08,
      pricingMissing: true
    });

    await recordTokenUsage({
      ...baseParams,
      model: "modelo-lancado-ontem",
      usage: { inputTokens: 5000, outputTokens: 200 }
    });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      pricingMissing: true
    });
  });

  it("registra chamada que terminou em erro — entrada já foi consumida", async () => {
    // O provider cobra os tokens de entrada mesmo quando a geração falha.
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 21_000, outputTokens: 0 },
      finishReason: "error"
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      inputTokens: 21_000
    });
  });

  it("gera idempotencyKey distinta para chamadas distintas", async () => {
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 100, outputTokens: 10 }
    });
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 200, outputTokens: 20 }
    });

    const k1 = mockedCreate.mock.calls[0][0].idempotencyKey;
    const k2 = mockedCreate.mock.calls[1][0].idempotencyKey;
    expect(k1).toBeTruthy();
    expect(k1).not.toBe(k2);
  });

  it("reaproveita a idempotencyKey informada, para retry não duplicar débito", async () => {
    await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 100, outputTokens: 10 },
      idempotencyKey: "chamada-abc-123"
    });

    expect(mockedCreate.mock.calls[0][0].idempotencyKey).toBe(
      "chamada-abc-123"
    );
  });

  it("engole violação de chave única sem alarde — é retry, não erro", async () => {
    const uniqueErr: Error & { name: string } = new Error("duplicate key");
    uniqueErr.name = "SequelizeUniqueConstraintError";
    mockedCreate.mockRejectedValue(uniqueErr);
    // eslint-disable-next-line global-require
    const { logger } = require("../../../utils/logger");

    const result = await recordTokenUsage({
      ...baseParams,
      usage: { inputTokens: 100, outputTokens: 10 },
      idempotencyKey: "repetida"
    });

    expect(result).toBeNull();
    // Duplicata é o mecanismo funcionando, não uma falha para investigar.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("aceita ticketId nulo (Secretária opera fora de ticket)", async () => {
    await recordTokenUsage({
      ...baseParams,
      ticketId: null,
      source: "secretary",
      usage: { inputTokens: 3000, outputTokens: 150 }
    });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      ticketId: null,
      source: "secretary"
    });
  });
});
