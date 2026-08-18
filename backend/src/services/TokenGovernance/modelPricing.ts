/**
 * Preços de modelo e cálculo de custo.
 *
 * Responsabilidade única (CLAUDE.md II.4): resolver o preço de um par
 * provider+modelo e converter tokens em dinheiro. Não grava nada, não
 * consulta consumo, não sabe o que é crédito.
 *
 * Ver directives/token_governance.md.
 */

import ModelPrice from "../../models/ModelPrice";
import { logger } from "../../utils/logger";

/**
 * Cotação usada quando nenhuma é informada.
 *
 * É um FALLBACK, não a fonte de verdade: a cotação real vem das configurações
 * e é gravada em cada linha de consumo (`usdToBrlUsed`), para que o valor
 * continue auditável mesmo depois de o dólar mudar.
 */
export const USD_TO_BRL_FALLBACK = 5.08;

export interface ResolvedPrice {
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cachedInputPricePerMillion: number;
  /** true quando o modelo não tem preço cadastrado — custo vira 0, nunca chute */
  pricingMissing: boolean;
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  price: ResolvedPrice;
  usdToBrl?: number;
  /** Markup em pontos percentuais. 0 = o dono absorve o custo (fase atual). */
  markupPercent: number;
}

export interface CostResult {
  costUsd: number;
  costBrl: number;
  /** Valor imputado à empresa: custo + markup. Com markup 0, igual ao custo. */
  priceBrl: number;
  usdToBrlUsed: number;
  pricingMissing: boolean;
}

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Busca o preço vigente de um modelo.
 *
 * @param provider - Identificador do provider (ex: "anthropic")
 * @param model - Identificador do modelo na API do provider
 * @returns Preços por milhão de tokens; `pricingMissing` quando não cadastrado
 *
 * @example
 * const price = await resolvePrice("anthropic", "claude-haiku-4-5");
 * if (price.pricingMissing) { /* painel mostra "preço não cadastrado" *\/ }
 */
export const resolvePrice = async (
  provider: string,
  model: string
): Promise<ResolvedPrice> => {
  const missing: ResolvedPrice = {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    cachedInputPricePerMillion: 0,
    pricingMissing: true
  };

  try {
    const row = await ModelPrice.findOne({
      where: { provider, model },
      order: [["effectiveFrom", "DESC"]]
    });

    if (!row) {
      // Não é erro: modelo novo aparece antes de alguém cadastrar o preço.
      // O painel destaca esses casos para cadastro.
      logger.warn({
        fn: "resolvePrice",
        provider,
        model,
        msg: "Modelo sem preço cadastrado — consumo será registrado com custo 0"
      });
      return missing;
    }

    return {
      inputPricePerMillion: Number(row.inputPricePerMillion),
      outputPricePerMillion: Number(row.outputPricePerMillion),
      cachedInputPricePerMillion: Number(row.cachedInputPricePerMillion),
      pricingMissing: false
    };
  } catch (err) {
    // Diretiva, regra 3: contabilidade nunca derruba atendimento. Loga com
    // contexto suficiente para diagnosticar (II.5 — nada de catch silencioso)
    // e segue com custo 0, que aparece no painel como preço ausente.
    logger.error({
      fn: "resolvePrice",
      provider,
      model,
      err,
      msg: "Falha ao buscar preço do modelo"
    });
    return missing;
  }
};

/**
 * Converte tokens em custo e preço.
 *
 * Sem arredondamento: 1.000 tokens de entrada a US$1/milhão custam US$0,001, e
 * arredondar para centavos aqui zeraria o valor. Somado sobre milhares de
 * chamadas, o custo simplesmente sumiria. Arredondamento é problema da camada
 * de exibição.
 *
 * @param input - Tokens consumidos, preço vigente, cotação e markup
 * @returns Custo em USD e BRL, preço com markup e a cotação usada
 *
 * @example
 * const c = calculateCost({
 *   inputTokens: 22_000, outputTokens: 300, cachedInputTokens: 0,
 *   price, usdToBrl: 5.08, markupPercent: 0
 * });
 */
export const calculateCost = (input: CostInput): CostResult => {
  const {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    price,
    usdToBrl,
    markupPercent
  } = input;

  const usdToBrlUsed =
    typeof usdToBrl === "number" && usdToBrl > 0
      ? usdToBrl
      : USD_TO_BRL_FALLBACK;

  const costUsd =
    ((inputTokens || 0) / TOKENS_PER_MILLION) * price.inputPricePerMillion +
    ((outputTokens || 0) / TOKENS_PER_MILLION) * price.outputPricePerMillion +
    ((cachedInputTokens || 0) / TOKENS_PER_MILLION) *
      price.cachedInputPricePerMillion;

  const costBrl = costUsd * usdToBrlUsed;
  const priceBrl = costBrl * (1 + (markupPercent || 0) / 100);

  return {
    costUsd,
    costBrl,
    priceBrl,
    usdToBrlUsed,
    pricingMissing: price.pricingMissing
  };
};
