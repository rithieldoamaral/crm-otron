/**
 * Grava o consumo de UMA chamada ao LLM.
 *
 * Responsabilidade única (CLAUDE.md II.4): registrar consumo. Não decide
 * preço (delega a modelPricing), não mexe em crédito, não alerta ninguém.
 *
 * POR QUE ESTE SERVIÇO EXISTE:
 * O registro de tokens vivia dentro do laço de tool calls do AgentService,
 * então um turno com 3 tools contava o consumo 3 vezes e um turno sem tool
 * não contava nenhuma. Como a maioria dos turnos de atendimento é texto puro,
 * o total subcontava o grosso e inflava o resto. Ver
 * directives/token_governance.md.
 *
 * A regra que corrige isso é de chamada, não de código: este serviço é
 * invocado UMA vez logo após o retorno do provider, antes de qualquer
 * ramificação por tool call.
 */

import { randomUUID } from "crypto";
import TokenUsage from "../../models/TokenUsage";
import { resolvePrice, calculateCost } from "./modelPricing";
import { logger } from "../../utils/logger";

export interface RecordTokenUsageParams {
  companyId: number;
  ticketId?: number | null;
  /** De onde partiu a chamada */
  source: "agent" | "secretary" | "summary";
  provider: string;
  model: string;
  /** `usage` devolvido pelo provider. Ausente = provider não reportou. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  };
  /** Markup da empresa em pontos percentuais (0 = dono absorve o custo) */
  markupPercent?: number;
  usdToBrl?: number;
  finishReason?: string;
  /** Informe para tornar o retry idempotente; omita para gerar uma nova. */
  idempotencyKey?: string;
  /**
   * Quantas tools o modelo pediu neste turno. NÃO afeta o cálculo — é
   * contexto de diagnóstico, e serve de lembrete de que o consumo do turno
   * é um só, independente do número de tools.
   */
  toolCallCount?: number;
}

/**
 * Registra o consumo de uma chamada ao LLM.
 *
 * Nunca lança: falha de contabilidade não pode interromper o atendimento
 * (diretiva, regra 3). Erros são logados com contexto e a função devolve null.
 *
 * @param params - Dados da chamada, incluindo o `usage` do provider
 * @returns O registro criado, ou null se a gravação falhou/foi duplicata
 *
 * @example
 * const response = await provider.chatWithTools(...);
 * await recordTokenUsage({
 *   companyId, ticketId, source: "agent",
 *   provider: cfg.provider, model: cfg.model,
 *   usage: response.usage, finishReason: response.finishReason
 * });
 */
const recordTokenUsage = async (
  params: RecordTokenUsageParams
): Promise<TokenUsage | null> => {
  const {
    companyId,
    ticketId = null,
    source,
    provider,
    model,
    usage,
    markupPercent = 0,
    usdToBrl,
    idempotencyKey
  } = params;

  try {
    // Provider que não reporta uso é sinalizado, nunca estimado: número
    // chutado passaria por número medido no painel.
    const usageMissing = !usage;

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;

    const price = await resolvePrice(provider, model);

    const cost = calculateCost({
      inputTokens,
      outputTokens,
      cachedInputTokens,
      price,
      usdToBrl,
      markupPercent
    });

    return await TokenUsage.create({
      companyId,
      ticketId,
      source,
      provider,
      model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      // Preço congelado: alterar o catálogo amanhã não reescreve este valor.
      inputPricePerMillion: price.inputPricePerMillion,
      outputPricePerMillion: price.outputPricePerMillion,
      cachedInputPricePerMillion: price.cachedInputPricePerMillion,
      usdToBrlUsed: cost.usdToBrlUsed,
      markupPercent,
      costUsd: cost.costUsd,
      costBrl: cost.costBrl,
      priceBrl: cost.priceBrl,
      usageMissing,
      pricingMissing: cost.pricingMissing,
      idempotencyKey: idempotencyKey || randomUUID()
    } as any);
  } catch (err) {
    // Violação da chave única = retry da mesma chamada. É o mecanismo de
    // idempotência funcionando, não uma falha: não polui o log de erro.
    if ((err as Error)?.name === "SequelizeUniqueConstraintError") {
      logger.warn({
        fn: "recordTokenUsage",
        companyId,
        idempotencyKey,
        msg: "Consumo já registrado (retry) — ignorado"
      });
      return null;
    }

    // II.5: nada de catch silencioso. Contexto suficiente para diagnosticar
    // sem precisar reproduzir.
    logger.error({
      fn: "recordTokenUsage",
      companyId,
      ticketId,
      source,
      provider,
      model,
      err,
      msg: "Falha ao registrar consumo de tokens — atendimento segue normalmente"
    });
    return null;
  }
};

export default recordTokenUsage;
