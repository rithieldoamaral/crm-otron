import { Request, Response } from "express";

import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import {
  resolvePeriod,
  getUsageByCompany,
  getUsageByModel,
  getDailySeries
} from "../services/TokenGovernance/usageReports";
import {
  getBalance,
  grantCredit,
  evaluateThresholds
} from "../services/TokenGovernance/creditLedger";
import CreditLedger from "../models/CreditLedger";
import ModelPrice from "../models/ModelPrice";

/**
 * Painel de governança de tokens — SOMENTE superadmin.
 *
 * SEGURANÇA (CLAUDE.md XV.3): consumo e custo são dados comerciais sensíveis.
 * Nenhum cliente pode ver o de outro, nem o próprio custo bruto (que revelaria
 * a margem da plataforma). O gate real é o middleware `isSuper` aplicado a
 * TODAS as rotas deste controller — esconder a aba no frontend é UX, não
 * proteção (XV.1).
 *
 * Diferente dos relatórios comuns, aqui o `companyId` da query É legítimo:
 * o superadmin, por definição, consulta empresas que não são a dele. O gate
 * `isSuper` é o que torna isso seguro.
 */

type PeriodQuery = {
  startDate?: string;
  endDate?: string;
  companyId?: string;
};

const parseCompanyId = (raw?: string): number | undefined => {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("ERR_INVALID_COMPANY_ID", 400);
  }
  return parsed;
};

/**
 * GET /token-governance/overview
 * Visão geral: ranking de empresas por custo, com métricas derivadas.
 */
export const overview = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { startDate, endDate, companyId } = req.query as PeriodQuery;
  const period = resolvePeriod(startDate, endDate);
  const targetCompanyId = parseCompanyId(companyId);

  const companies = await getUsageByCompany({
    ...period,
    companyId: targetCompanyId
  });

  // Totais da plataforma: é o número que responde "quanto a operação inteira
  // está me custando este mês".
  const totals = companies.reduce(
    (acc, c) => ({
      costBrl: acc.costBrl + c.costBrl,
      priceBrl: acc.priceBrl + c.priceBrl,
      inputTokens: acc.inputTokens + c.inputTokens,
      outputTokens: acc.outputTokens + c.outputTokens,
      totalCalls: acc.totalCalls + Number(c.totalCalls),
      distinctTickets: acc.distinctTickets + c.distinctTickets
    }),
    {
      costBrl: 0,
      priceBrl: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCalls: 0,
      distinctTickets: 0
    }
  );

  return res.json({
    period: { startDate: period.startDate, endDate: period.endDate },
    totals: {
      ...totals,
      marginBrl: totals.priceBrl - totals.costBrl,
      costPerTicketBrl:
        totals.distinctTickets > 0 ? totals.costBrl / totals.distinctTickets : 0
    },
    companies
  });
};

/**
 * GET /token-governance/by-model
 * Quebra por modelo — mostra onde o custo está concentrado.
 */
export const byModel = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { startDate, endDate, companyId } = req.query as PeriodQuery;
  const period = resolvePeriod(startDate, endDate);

  const models = await getUsageByModel({
    ...period,
    companyId: parseCompanyId(companyId)
  });

  return res.json({ models });
};

/**
 * GET /token-governance/series
 * Série diária de custo, para o gráfico de tendência.
 */
export const series = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { startDate, endDate, companyId } = req.query as PeriodQuery;
  const period = resolvePeriod(startDate, endDate);

  const data = await getDailySeries({
    ...period,
    companyId: parseCompanyId(companyId)
  });

  return res.json({ series: data });
};

/**
 * GET /token-governance/credits/:companyId
 * Saldo, extrato e situação de limiar de uma empresa.
 */
export const credits = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = parseCompanyId(req.params.companyId);
  if (!companyId) {
    throw new AppError("ERR_INVALID_COMPANY_ID", 400);
  }

  const balance = await getBalance(companyId);

  const entries = await CreditLedger.findAll({
    where: { companyId },
    order: [["createdAt", "DESC"]],
    limit: 100
  });

  // Concedido e consumido saem do próprio razão, para o percentual bater
  // exatamente com o extrato que o superadmin vê ao lado.
  const granted = entries
    .filter(e => Number(e.amountBrl) > 0)
    .reduce((s, e) => s + Number(e.amountBrl), 0);
  const consumed = entries
    .filter(e => Number(e.amountBrl) < 0)
    .reduce((s, e) => s + Math.abs(Number(e.amountBrl)), 0);

  const threshold = evaluateThresholds({ granted, consumed });

  return res.json({
    companyId,
    balance,
    granted,
    consumed,
    threshold,
    entries
  });
};

/**
 * POST /token-governance/credits/:companyId
 * Concede crédito a uma empresa.
 */
export const addCredit = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const companyId = parseCompanyId(req.params.companyId);
  if (!companyId) {
    throw new AppError("ERR_INVALID_COMPANY_ID", 400);
  }

  const { amountBrl, description, referenceId } = req.body as {
    amountBrl: number;
    description: string;
    referenceId?: string;
  };

  const entry = await grantCredit({
    companyId,
    amountBrl: Number(amountBrl),
    description,
    referenceId,
    createdByUserId: Number(req.user.id)
  });

  // Movimentação financeira manual é evento auditável (CLAUDE.md V.2).
  logger.info({
    fn: "addCredit",
    companyId,
    amountBrl,
    grantedBy: req.user.id,
    msg: "Crédito concedido a empresa"
  });

  return res.status(201).json(entry);
};

/**
 * GET /token-governance/prices
 * Catálogo de preços por modelo — o superadmin cadastra os que faltam.
 */
export const listPrices = async (
  _req: Request,
  res: Response
): Promise<Response> => {
  const prices = await ModelPrice.findAll({
    order: [
      ["provider", "ASC"],
      ["model", "ASC"]
    ]
  });

  return res.json({ prices });
};

/**
 * PUT /token-governance/prices
 * Cadastra ou atualiza o preço de um modelo.
 *
 * Atualizar aqui NÃO reescreve consumo já registrado: cada linha de
 * `TokenUsages` congelou o preço vigente no momento do uso.
 */
export const upsertPrice = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const {
    provider,
    model,
    inputPricePerMillion,
    outputPricePerMillion,
    cachedInputPricePerMillion,
    source
  } = req.body as Record<string, any>;

  if (!provider || !model) {
    throw new AppError("ERR_MISSING_PROVIDER_OR_MODEL", 400);
  }

  const values = {
    inputPricePerMillion: Number(inputPricePerMillion) || 0,
    outputPricePerMillion: Number(outputPricePerMillion) || 0,
    cachedInputPricePerMillion: Number(cachedInputPricePerMillion) || 0,
    source:
      source || `Cadastrado pelo superadmin em ${new Date().toISOString()}`,
    effectiveFrom: new Date()
  };

  const existing = await ModelPrice.findOne({ where: { provider, model } });

  if (existing) {
    await existing.update(values);
    return res.json(existing);
  }

  const created = await ModelPrice.create({
    provider,
    model,
    ...values
  } as any);
  return res.status(201).json(created);
};
