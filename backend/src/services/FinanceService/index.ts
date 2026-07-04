/**
 * FinanceService — Analytics financeiros a partir de ServiceHistory.
 *
 * Responsabilidades:
 *   - `getFinanceSummary`       — KPIs do período (receita, ticket médio, crescimento)
 *   - `getRevenueByDay`         — Receita agrupada por dia
 *   - `getRevenueByWeekday`     — Receita agrupada por dia da semana
 *   - `getTopClients`           — Clientes que mais geraram receita
 *   - `getTopServices`          — Serviços que mais geraram receita
 *
 * Multi-tenancy: todas as queries filtram por `companyId` do JWT.
 * Fonte de dados: tabela `ServiceHistories` (somente registros com value > 0).
 * Lógica pura: `FinanceService.utils.ts` (testável sem Sequelize).
 *
 * Diretiva: Fase 7 — Módulo Financeiro Real.
 */

import { Op, fn, col } from "sequelize";
import ServiceHistory from "../../models/ServiceHistory";
import Contact from "../../models/Contact";
import {
  calculateGrowthRate,
  calculateAverageTicket,
  getWeekdayName,
  applyDateRangeDefaults,
  buildPreviousPeriod,
} from "./FinanceService.utils";

// ── Types de saída ────────────────────────────────────────────────────────────

export interface FinanceSummary {
  totalRevenue: number;
  transactionCount: number;
  averageTicket: number | null;
  /** % crescimento vs período anterior de igual duração. null se anterior = R$0 */
  growthRate: number | null;
  previousRevenue: number;
  startDate: string;
  endDate: string;
}

export interface RevenuByDayItem {
  date: string; // "2026-05-01"
  revenue: number;
  count: number;
}

export interface RevenueByWeekdayItem {
  weekday: string; // "Segunda"
  dayIndex: number; // 0–6
  revenue: number;
  count: number;
}

export interface TopClientItem {
  contactId: number;
  name: string;
  revenue: number;
  transactionCount: number;
}

export interface TopServiceItem {
  serviceType: string;
  revenue: number;
  count: number;
}

// ── Helper interno ────────────────────────────────────────────────────────────

/**
 * Soma a receita de um período com base em ServiceHistory.value.
 * Considera apenas registros com value IS NOT NULL e value > 0.
 */
async function sumRevenue(
  companyId: number,
  start: Date,
  end: Date
): Promise<{ total: number; count: number }> {
  const rows = await ServiceHistory.findAll({
    where: {
      companyId,
      value: { [Op.gt]: 0 },
      occurredAt: { [Op.between]: [start, end] as any },
    },
    attributes: [
      [fn("COALESCE", fn("SUM", col("value")), 0), "total"],
      [fn("COUNT", col("id")), "count"],
    ],
    raw: true,
  });

  const row = rows[0] as any;
  return {
    total: Number(row?.total ?? 0),
    count: Number(row?.count ?? 0),
  };
}

// ── getFinanceSummary ─────────────────────────────────────────────────────────

/**
 * Retorna os KPIs financeiros do período: receita, ticket médio e crescimento.
 *
 * @param companyId  - ID da empresa (JWT)
 * @param startDate  - Início do período (ISO string). Default: 1º do mês atual
 * @param endDate    - Fim do período (ISO string). Default: agora
 * @returns FinanceSummary com crescimento vs período anterior de igual duração
 */
export async function getFinanceSummary(
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<FinanceSummary> {
  const { start, end } = applyDateRangeDefaults(startDate, endDate);
  const { start: prevStart, end: prevEnd } = buildPreviousPeriod(start, end);

  const [current, previous] = await Promise.all([
    sumRevenue(companyId, start, end),
    sumRevenue(companyId, prevStart, prevEnd),
  ]);

  return {
    totalRevenue: current.total,
    transactionCount: current.count,
    averageTicket: calculateAverageTicket(current.total, current.count),
    growthRate: calculateGrowthRate(current.total, previous.total),
    previousRevenue: previous.total,
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

// ── getRevenueByDay ───────────────────────────────────────────────────────────

/**
 * Retorna a receita agrupada por dia no período.
 * Dias sem receita não aparecem (apenas dias com pelo menos 1 transação).
 *
 * @param companyId  - ID da empresa (JWT)
 * @param startDate  - Início (ISO). Default: 1º do mês atual
 * @param endDate    - Fim (ISO). Default: agora
 * @returns Array ordenado por data ASC
 */
export async function getRevenueByDay(
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<RevenuByDayItem[]> {
  const { start, end } = applyDateRangeDefaults(startDate, endDate);

  const rows = await ServiceHistory.findAll({
    where: {
      companyId,
      value: { [Op.gt]: 0 },
      occurredAt: { [Op.between]: [start, end] as any },
    },
    attributes: [
      [fn("DATE", col("occurredAt")), "date"],
      [fn("COALESCE", fn("SUM", col("value")), 0), "revenue"],
      [fn("COUNT", col("id")), "count"],
    ],
    group: [fn("DATE", col("occurredAt"))],
    order: [[fn("DATE", col("occurredAt")), "ASC"]],
    raw: true,
  });

  return (rows as any[]).map((r) => ({
    date: String(r.date),
    revenue: Number(r.revenue),
    count: Number(r.count),
  }));
}

// ── getRevenueByWeekday ───────────────────────────────────────────────────────

/**
 * Retorna a receita agrupada por dia da semana no período.
 * Útil para identificar os dias mais lucrativos da semana.
 *
 * @param companyId  - ID da empresa (JWT)
 * @param startDate  - Início (ISO). Default: 1º do mês atual
 * @param endDate    - Fim (ISO). Default: agora
 * @returns Array com os 7 dias da semana, ordenado por dayIndex ASC
 */
export async function getRevenueByWeekday(
  companyId: number,
  startDate?: string,
  endDate?: string
): Promise<RevenueByWeekdayItem[]> {
  const { start, end } = applyDateRangeDefaults(startDate, endDate);

  // DAYOFWEEK() retorna 1=Dom, 2=Seg...7=Sab (MySQL/MariaDB)
  // Convertemos para 0=Dom, 1=Seg...6=Sab para compatibilidade com JS Date.getDay()
  const rows = await ServiceHistory.findAll({
    where: {
      companyId,
      value: { [Op.gt]: 0 },
      occurredAt: { [Op.between]: [start, end] as any },
    },
    attributes: [
      [fn("DAYOFWEEK", col("occurredAt")), "rawDayIndex"],
      [fn("COALESCE", fn("SUM", col("value")), 0), "revenue"],
      [fn("COUNT", col("id")), "count"],
    ],
    group: [fn("DAYOFWEEK", col("occurredAt"))],
    order: [[fn("DAYOFWEEK", col("occurredAt")), "ASC"]],
    raw: true,
  });

  return (rows as any[]).map((r) => {
    // DAYOFWEEK: 1=Dom→0, 2=Seg→1, ..., 7=Sab→6
    const dayIndex = Number(r.rawDayIndex) - 1;
    return {
      weekday: getWeekdayName(dayIndex),
      dayIndex,
      revenue: Number(r.revenue),
      count: Number(r.count),
    };
  });
}

// ── getTopClients ─────────────────────────────────────────────────────────────

/**
 * Retorna os clientes que mais geraram receita no período.
 *
 * @param companyId  - ID da empresa (JWT)
 * @param startDate  - Início (ISO). Default: 1º do mês atual
 * @param endDate    - Fim (ISO). Default: agora
 * @param limit      - Número máximo de clientes. Default: 10
 * @returns Array ordenado por receita DESC
 */
export async function getTopClients(
  companyId: number,
  startDate?: string,
  endDate?: string,
  limit = 10
): Promise<TopClientItem[]> {
  const { start, end } = applyDateRangeDefaults(startDate, endDate);

  const rows = await ServiceHistory.findAll({
    where: {
      companyId,
      value: { [Op.gt]: 0 },
      occurredAt: { [Op.between]: [start, end] as any },
    },
    attributes: [
      "contactId",
      [fn("COALESCE", fn("SUM", col("ServiceHistory.value")), 0), "revenue"],
      [fn("COUNT", col("ServiceHistory.id")), "transactionCount"],
    ],
    include: [
      {
        model: Contact,
        attributes: ["name"],
        required: false,
      },
    ],
    group: ["ServiceHistory.contactId", "contact.id"],
    order: [[fn("SUM", col("ServiceHistory.value")), "DESC"]],
    limit: Math.min(limit, 50),
    raw: true,
    nest: true,
  });

  return (rows as any[]).map((r) => ({
    contactId: r.contactId,
    name: r.contact?.name ?? `Contato #${r.contactId}`,
    revenue: Number(r.revenue),
    transactionCount: Number(r.transactionCount),
  }));
}

// ── getTopServices ────────────────────────────────────────────────────────────

/**
 * Retorna os tipos de serviço que mais geraram receita no período.
 * Agrupa por `serviceType` (campo texto em ServiceHistory).
 *
 * @param companyId  - ID da empresa (JWT)
 * @param startDate  - Início (ISO). Default: 1º do mês atual
 * @param endDate    - Fim (ISO). Default: agora
 * @param limit      - Número máximo de serviços. Default: 10
 * @returns Array ordenado por receita DESC
 */
export async function getTopServices(
  companyId: number,
  startDate?: string,
  endDate?: string,
  limit = 10
): Promise<TopServiceItem[]> {
  const { start, end } = applyDateRangeDefaults(startDate, endDate);

  const rows = await ServiceHistory.findAll({
    where: {
      companyId,
      value: { [Op.gt]: 0 },
      occurredAt: { [Op.between]: [start, end] as any },
      serviceType: { [Op.ne]: null },
    },
    attributes: [
      "serviceType",
      [fn("COALESCE", fn("SUM", col("value")), 0), "revenue"],
      [fn("COUNT", col("id")), "count"],
    ],
    group: ["serviceType"],
    order: [[fn("SUM", col("value")), "DESC"]],
    limit: Math.min(limit, 50),
    raw: true,
  });

  return (rows as any[]).map((r) => ({
    serviceType: r.serviceType ?? "Sem categoria",
    revenue: Number(r.revenue),
    count: Number(r.count),
  }));
}
