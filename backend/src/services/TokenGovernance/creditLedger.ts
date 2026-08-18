/**
 * Razão de créditos: saldo, concessão, débito e avaliação de limiares.
 *
 * Responsabilidade única (CLAUDE.md II.4): mexer no razão. Não mede consumo,
 * não calcula preço, não envia notificação (só diz se deve alertar).
 *
 * DECISÃO DE PRODUTO (2026-08-17, aprovada pelo dono):
 * o bloqueio por falta de crédito NÃO é o comportamento padrão. Se o agente
 * parasse de responder ao acabar o saldo, quem ficaria no vácuo seria o
 * cliente DO cliente, no meio de uma conversa no WhatsApp. Numa plataforma de
 * atendimento isso sacrifica a reputação do cliente para proteger margem —
 * e ele culparia a plataforma, com razão.
 *
 * O bloqueio existe implementado, atrás de `enforcementEnabled`, desligado por
 * padrão. Ligar é decisão comercial futura, nunca default técnico.
 */

import CreditLedger from "../../models/CreditLedger";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

export const LEDGER_ENTRY_TYPES = {
  GRANT: "grant",
  CONSUMPTION: "consumption",
  ADJUSTMENT: "adjustment",
  EXPIRY: "expiry"
} as const;

/** Percentual do crédito consumido a partir do qual avisamos o superadmin. */
export const WARNING_THRESHOLD_PERCENT = 80;

/**
 * Saldo atual da empresa: SOMA dos lançamentos.
 *
 * Saldo NEGATIVO é válido e esperado — significa que a empresa consumiu além
 * do crédito. Como não bloqueamos, é justamente esse número que mostra o que
 * há a cobrar. Zerar no piso esconderia a dívida.
 *
 * @param companyId - Empresa consultada
 * @returns Saldo em BRL; 0 se não houver lançamentos ou se a consulta falhar
 */
export const getBalance = async (companyId: number): Promise<number> => {
  try {
    const total = await CreditLedger.sum("amountBrl", { where: { companyId } });
    // Sequelize.sum devolve null quando não há linhas.
    return Number(total) || 0;
  } catch (err) {
    logger.error({
      fn: "getBalance",
      companyId,
      err,
      msg: "Falha ao calcular saldo de créditos"
    });
    return 0;
  }
};

export interface GrantCreditParams {
  companyId: number;
  amountBrl: number;
  description: string;
  createdByUserId: number;
  referenceId?: string;
}

/**
 * Credita valor na conta da empresa (lançamento positivo).
 *
 * @throws {AppError} ERR_INVALID_CREDIT_AMOUNT se o valor não for positivo
 * @throws {AppError} ERR_MISSING_DESCRIPTION se faltar descrição
 *
 * @example
 * await grantCredit({
 *   companyId: 7, amountBrl: 500,
 *   description: "Compra de créditos - PIX", createdByUserId: admin.id
 * });
 */
export const grantCredit = async (
  params: GrantCreditParams
): Promise<CreditLedger> => {
  const { companyId, amountBrl, description, createdByUserId, referenceId } =
    params;

  // Retirada se faz por lançamento de ajuste, com motivo próprio — não por
  // "concessão negativa", que mascararia um estorno como se fosse crédito.
  if (!(amountBrl > 0)) {
    throw new AppError("ERR_INVALID_CREDIT_AMOUNT", 400);
  }

  if (!description || !description.trim()) {
    throw new AppError("ERR_MISSING_DESCRIPTION", 400);
  }

  return CreditLedger.create({
    companyId,
    type: LEDGER_ENTRY_TYPES.GRANT,
    amountBrl,
    description: description.trim(),
    referenceId: referenceId || null,
    createdByUserId
  } as any);
};

export interface RecordConsumptionParams {
  companyId: number;
  /** Valor POSITIVO do consumo; a função grava o lançamento negativo. */
  amountBrl: number;
  description: string;
  referenceId: string;
}

/**
 * Debita consumo do razão (lançamento negativo).
 *
 * Nunca lança: o consumo já aconteceu de fato: falhar aqui não desfaz a
 * chamada ao LLM, e propagar erro poderia interromper o atendimento.
 *
 * @returns O lançamento criado, ou null se a gravação falhou
 */
export const recordConsumption = async (
  params: RecordConsumptionParams
): Promise<CreditLedger | null> => {
  const { companyId, amountBrl, description, referenceId } = params;

  try {
    return await CreditLedger.create({
      companyId,
      type: LEDGER_ENTRY_TYPES.CONSUMPTION,
      // Convenção de sinal: consumo é negativo, para o saldo ser soma simples.
      amountBrl: -Math.abs(amountBrl),
      description,
      referenceId
    } as any);
  } catch (err) {
    logger.error({
      fn: "recordConsumption",
      companyId,
      amountBrl,
      referenceId,
      err,
      msg: "Falha ao debitar consumo no razão"
    });
    return null;
  }
};

export interface ThresholdInput {
  /** Total de crédito concedido à empresa */
  granted: number;
  /** Total consumido no período */
  consumed: number;
  /** Só true quando o dono ligar explicitamente a trava comercial */
  enforcementEnabled?: boolean;
}

export interface ThresholdResult {
  level: "no_plan" | "ok" | "warning" | "exhausted";
  percentUsed: number;
  shouldAlert: boolean;
  /** Sempre false enquanto enforcementEnabled não for ligado */
  shouldBlock: boolean;
}

/**
 * Avalia em que faixa de consumo a empresa está.
 *
 * @example
 * const r = evaluateThresholds({ granted: 500, consumed: 410 });
 * // → { level: "warning", percentUsed: 82, shouldAlert: true, shouldBlock: false }
 */
export const evaluateThresholds = (input: ThresholdInput): ThresholdResult => {
  const { granted, consumed, enforcementEnabled = false } = input;

  // Empresa sem crédito cadastrado não está "estourada": na fase atual o dono
  // absorve o custo e ninguém tem crédito. Tratar granted=0 como 100% usado
  // dispararia alerta para a base inteira, todo dia.
  if (!granted || granted <= 0) {
    return {
      level: "no_plan",
      percentUsed: 0,
      shouldAlert: false,
      shouldBlock: false
    };
  }

  const percentUsed = (consumed / granted) * 100;

  if (percentUsed >= 100) {
    return {
      level: "exhausted",
      percentUsed,
      shouldAlert: true,
      // A trava só fecha quando alguém decidir comercialmente ligá-la.
      shouldBlock: enforcementEnabled === true
    };
  }

  if (percentUsed >= WARNING_THRESHOLD_PERCENT) {
    return {
      level: "warning",
      percentUsed,
      shouldAlert: true,
      shouldBlock: false
    };
  }

  return { level: "ok", percentUsed, shouldAlert: false, shouldBlock: false };
};
