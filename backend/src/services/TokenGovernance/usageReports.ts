/**
 * Agregações de consumo para o painel do superadmin.
 *
 * Responsabilidade única (CLAUDE.md II.4): ler e resumir consumo. Não grava
 * nada, não mexe em crédito, não decide preço.
 *
 * A lógica derivada fica separada da query de propósito: métrica calculada
 * errada é bug silencioso (o painel mostra número plausível e ninguém
 * percebe), enquanto query quebrada falha alto. Só a parte pura é testável a
 * fundo, e é ela que carrega o risco.
 *
 * SEGURANÇA: todas as queries usam `replacements` (CLAUDE.md XV.4). A auditoria
 * de 2026-07-27 encontrou SQL injection exatamente em relatórios que
 * concatenavam parâmetro na string.
 */

import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";

/** Linha crua vinda da agregação por empresa. */
export interface UsageAggregateRow {
  companyId: number;
  companyName: string;
  totalCalls: number;
  /** Atendimentos distintos que geraram consumo no período */
  distinctTickets: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costBrl: number;
  priceBrl: number;
  pricingMissingCalls: number;
  usageMissingCalls: number;
}

export interface UsageMetrics extends UsageAggregateRow {
  /** A métrica que denuncia empresa com conversa anormalmente longa */
  costPerTicketBrl: number;
  tokensPerTicket: number;
  marginBrl: number;
  marginPercent: number;
  /** Percentual da entrada servido por cache — alavanca de economia */
  cacheHitPercent: number;
  /** Algum modelo sem preço cadastrado: custo 0 não significa "barato" */
  hasPricingGaps: boolean;
  hasUsageGaps: boolean;
}

const DEFAULT_PERIOD_DAYS = 30;

/**
 * Calcula as métricas derivadas e ordena por custo decrescente.
 *
 * @param rows - Linhas agregadas por empresa
 * @returns Métricas por empresa, maior consumidor primeiro
 *
 * @example
 * const metrics = computeDerivedMetrics(rows);
 * metrics[0] // empresa que mais custou no período
 */
export const computeDerivedMetrics = (
  rows: UsageAggregateRow[]
): UsageMetrics[] => {
  return rows
    .map(r => {
      const tickets = Number(r.distinctTickets) || 0;
      const costBrl = Number(r.costBrl) || 0;
      const priceBrl = Number(r.priceBrl) || 0;
      const inputTokens = Number(r.inputTokens) || 0;
      const outputTokens = Number(r.outputTokens) || 0;
      const cachedInputTokens = Number(r.cachedInputTokens) || 0;

      // Guarda de divisão por zero: a Secretária opera fora de ticket, então
      // é possível haver consumo com zero atendimentos. Infinity no painel
      // seria pior que 0.
      const costPerTicketBrl = tickets > 0 ? costBrl / tickets : 0;
      const tokensPerTicket =
        tickets > 0 ? (inputTokens + outputTokens) / tickets : 0;

      const marginBrl = priceBrl - costBrl;
      const marginPercent = costBrl > 0 ? (marginBrl / costBrl) * 100 : 0;

      const totalInput = inputTokens + cachedInputTokens;
      const cacheHitPercent =
        totalInput > 0 ? (cachedInputTokens / totalInput) * 100 : 0;

      return {
        ...r,
        costBrl,
        priceBrl,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        distinctTickets: tickets,
        costPerTicketBrl,
        tokensPerTicket,
        marginBrl,
        marginPercent,
        cacheHitPercent,
        hasPricingGaps: Number(r.pricingMissingCalls) > 0,
        hasUsageGaps: Number(r.usageMissingCalls) > 0
      };
    })
    .sort((a, b) => b.costBrl - a.costBrl);
};

/**
 * Normaliza o período consultado.
 *
 * @throws {AppError} ERR_INVALID_REPORT_DATE se a data for malformada
 * @throws {AppError} ERR_INVALID_DATE_RANGE se o intervalo estiver invertido
 */
export const resolvePeriod = (
  start?: string,
  end?: string
): { startDate: Date; endDate: Date } => {
  if (!start && !end) {
    const endDate = new Date();
    const startDate = new Date(
      endDate.getTime() - DEFAULT_PERIOD_DAYS * 86_400_000
    );
    return { startDate, endDate };
  }

  const isValid = (v?: string): boolean =>
    !!v &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(new Date(v).getTime());

  if (!isValid(start) || !isValid(end)) {
    throw new AppError("ERR_INVALID_REPORT_DATE", 400);
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  // Fim do dia: com T00:00 o último dia do período ficaria fora do relatório.
  const endDate = new Date(`${end}T23:59:59.999Z`);

  if (startDate > endDate) {
    throw new AppError("ERR_INVALID_DATE_RANGE", 400);
  }

  return { startDate, endDate };
};

const USAGE_BY_COMPANY_SQL = `
  SELECT
     tu."companyId"                              AS "companyId"
    ,c."name"                                    AS "companyName"
    ,COUNT(tu.id)                                AS "totalCalls"
    ,COUNT(DISTINCT tu."ticketId")               AS "distinctTickets"
    ,COALESCE(SUM(tu."inputTokens"), 0)          AS "inputTokens"
    ,COALESCE(SUM(tu."outputTokens"), 0)         AS "outputTokens"
    ,COALESCE(SUM(tu."cachedInputTokens"), 0)    AS "cachedInputTokens"
    ,COALESCE(SUM(tu."costBrl"), 0)              AS "costBrl"
    ,COALESCE(SUM(tu."priceBrl"), 0)             AS "priceBrl"
    ,COUNT(*) FILTER (WHERE tu."pricingMissing") AS "pricingMissingCalls"
    ,COUNT(*) FILTER (WHERE tu."usageMissing")   AS "usageMissingCalls"
  FROM "TokenUsages" tu
  JOIN "Companies" c ON c.id = tu."companyId"
  WHERE tu."createdAt" BETWEEN :startDate AND :endDate
    AND (CAST(:companyId AS INTEGER) IS NULL OR tu."companyId" = CAST(:companyId AS INTEGER))
  GROUP BY tu."companyId", c."name"
`;

/**
 * Consumo agregado por empresa no período.
 *
 * @param params - Intervalo e, opcionalmente, uma empresa específica
 * @returns Métricas por empresa, maior consumidor primeiro
 */
export const getUsageByCompany = async (params: {
  startDate: Date;
  endDate: Date;
  companyId?: number;
}): Promise<UsageMetrics[]> => {
  const { startDate, endDate, companyId } = params;

  try {
    const rows = await sequelize.query<UsageAggregateRow>(
      USAGE_BY_COMPANY_SQL,
      {
        type: QueryTypes.SELECT,
        replacements: { startDate, endDate, companyId: companyId ?? null }
      }
    );

    return computeDerivedMetrics(rows);
  } catch (err) {
    logger.error({
      fn: "getUsageByCompany",
      companyId,
      err,
      msg: "Falha ao agregar consumo por empresa"
    });
    throw err;
  }
};

const USAGE_BY_MODEL_SQL = `
  SELECT
     tu."provider"                        AS "provider"
    ,tu."model"                           AS "model"
    ,COUNT(tu.id)                         AS "totalCalls"
    ,COALESCE(SUM(tu."inputTokens"), 0)   AS "inputTokens"
    ,COALESCE(SUM(tu."outputTokens"), 0)  AS "outputTokens"
    ,COALESCE(SUM(tu."costBrl"), 0)       AS "costBrl"
    ,BOOL_OR(tu."pricingMissing")         AS "pricingMissing"
  FROM "TokenUsages" tu
  WHERE tu."createdAt" BETWEEN :startDate AND :endDate
    AND (CAST(:companyId AS INTEGER) IS NULL OR tu."companyId" = CAST(:companyId AS INTEGER))
  GROUP BY tu."provider", tu."model"
  ORDER BY COALESCE(SUM(tu."costBrl"), 0) DESC
`;

/** Quebra do consumo por modelo, para uma empresa ou para a base inteira. */
export const getUsageByModel = async (params: {
  startDate: Date;
  endDate: Date;
  companyId?: number;
}): Promise<
  Array<{
    provider: string;
    model: string;
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
    costBrl: number;
    pricingMissing: boolean;
  }>
> => {
  const { startDate, endDate, companyId } = params;

  const rows = await sequelize.query<any>(USAGE_BY_MODEL_SQL, {
    type: QueryTypes.SELECT,
    replacements: { startDate, endDate, companyId: companyId ?? null }
  });

  return rows.map(r => ({
    provider: r.provider,
    model: r.model,
    totalCalls: Number(r.totalCalls),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    costBrl: Number(r.costBrl),
    pricingMissing: Boolean(r.pricingMissing)
  }));
};

const DAILY_SERIES_SQL = `
  SELECT
     TO_CHAR(DATE_TRUNC('day', tu."createdAt"), 'YYYY-MM-DD') AS "day"
    ,COALESCE(SUM(tu."costBrl"), 0)                           AS "costBrl"
    ,COUNT(tu.id)                                             AS "totalCalls"
  FROM "TokenUsages" tu
  WHERE tu."createdAt" BETWEEN :startDate AND :endDate
    AND (CAST(:companyId AS INTEGER) IS NULL OR tu."companyId" = CAST(:companyId AS INTEGER))
  GROUP BY DATE_TRUNC('day', tu."createdAt")
  ORDER BY DATE_TRUNC('day', tu."createdAt") ASC
`;

/** Série diária de custo, para o gráfico de tendência. */
export const getDailySeries = async (params: {
  startDate: Date;
  endDate: Date;
  companyId?: number;
}): Promise<Array<{ day: string; costBrl: number; totalCalls: number }>> => {
  const { startDate, endDate, companyId } = params;

  const rows = await sequelize.query<any>(DAILY_SERIES_SQL, {
    type: QueryTypes.SELECT,
    replacements: { startDate, endDate, companyId: companyId ?? null }
  });

  return rows.map(r => ({
    day: r.day,
    costBrl: Number(r.costBrl),
    totalCalls: Number(r.totalCalls)
  }));
};
