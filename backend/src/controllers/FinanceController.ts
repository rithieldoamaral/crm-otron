/**
 * FinanceController — Endpoints REST para analytics financeiros.
 *
 * Rotas expostas (via financeRoutes.ts):
 *   GET /finance/summary            → summary    (KPIs: receita, ticket médio, crescimento)
 *   GET /finance/revenue-by-day     → byDay      (receita por dia)
 *   GET /finance/revenue-by-weekday → byWeekday  (receita por dia da semana)
 *   GET /finance/top-clients        → topClients (clientes por receita)
 *   GET /finance/top-services       → topServices (serviços por receita)
 *
 * Segurança:
 *   - Todas as rotas requerem `isAuth` (JWT válido)
 *   - Multi-tenancy: companyId sempre do JWT, nunca do body
 *
 * Query params comuns: startDate (ISO), endDate (ISO)
 * Query params específicos: limit (inteiro, max 50)
 */

import { Request, Response } from "express";
import {
  getFinanceSummary,
  getRevenueByDay,
  getRevenueByWeekday,
  getTopClients,
  getTopServices,
} from "../services/FinanceService";
import { clampLimit } from "../services/FinanceService/FinanceService.utils";

// ── summary ───────────────────────────────────────────────────────────────────

/**
 * KPIs do período: receita total, nº transações, ticket médio, crescimento.
 *
 * Query: startDate?, endDate?
 */
export const summary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate } = req.query as {
    startDate?: string;
    endDate?: string;
  };

  const data = await getFinanceSummary(companyId, startDate, endDate);
  return res.json(data);
};

// ── byDay ─────────────────────────────────────────────────────────────────────

/**
 * Receita agrupada por dia no período (ideal para gráfico de linha).
 *
 * Query: startDate?, endDate?
 */
export const byDay = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate } = req.query as {
    startDate?: string;
    endDate?: string;
  };

  const data = await getRevenueByDay(companyId, startDate, endDate);
  return res.json(data);
};

// ── byWeekday ─────────────────────────────────────────────────────────────────

/**
 * Receita agrupada por dia da semana (ideal para gráfico de barras).
 *
 * Query: startDate?, endDate?
 */
export const byWeekday = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate } = req.query as {
    startDate?: string;
    endDate?: string;
  };

  const data = await getRevenueByWeekday(companyId, startDate, endDate);
  return res.json(data);
};

// ── topClients ────────────────────────────────────────────────────────────────

/**
 * Top N clientes por receita gerada no período.
 *
 * Query: startDate?, endDate?, limit? (default 10, max 50)
 */
export const topClients = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate, limit } = req.query as {
    startDate?: string;
    endDate?: string;
    limit?: string;
  };

  const data = await getTopClients(
    companyId,
    startDate,
    endDate,
    clampLimit(limit)
  );
  return res.json(data);
};

// ── topServices ───────────────────────────────────────────────────────────────

/**
 * Top N serviços por receita gerada no período.
 *
 * Query: startDate?, endDate?, limit? (default 10, max 50)
 */
export const topServices = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { startDate, endDate, limit } = req.query as {
    startDate?: string;
    endDate?: string;
    limit?: string;
  };

  const data = await getTopServices(
    companyId,
    startDate,
    endDate,
    clampLimit(limit)
  );
  return res.json(data);
};
