/**
 * SystemLogController
 *
 * Expõe os logs de auditoria para o superadmin.
 * Acesso controlado via middleware isSuper em systemLogRoutes.ts.
 *
 * Endpoint: GET /api/logs
 * Query params:
 *   - companyId  (opcional) — filtra por empresa
 *   - action     (opcional) — filtra por tipo de ação (ex: "user.login")
 *   - dateFrom   (opcional) — YYYY-MM-DD
 *   - dateTo     (opcional) — YYYY-MM-DD
 *   - page       (padrão: 1)
 *   - limit      (padrão: 50, máx: 200)
 */

import { Request, Response } from "express";
import { Op } from "sequelize";
import SystemLog from "../models/SystemLog";
import User from "../models/User";
import Company from "../models/Company";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

export const index = async (req: Request, res: Response): Promise<Response> => {
  const {
    companyId,
    action,
    dateFrom,
    dateTo,
    page = "1",
    limit = String(PAGE_SIZE_DEFAULT)
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(limit, 10) || PAGE_SIZE_DEFAULT));
  const offset = (pageNum - 1) * limitNum;

  // Constrói o where dinamicamente
  const where: Record<string, unknown> = {};

  if (companyId) {
    where.companyId = parseInt(companyId, 10);
  }

  if (action) {
    where.action = action;
  }

  // Filtro de período
  if (dateFrom || dateTo) {
    const startDate = dateFrom
      ? new Date(`${dateFrom}T00:00:00`)
      : new Date(0);
    const endDate = dateTo
      ? new Date(`${dateTo}T23:59:59.999`)
      : new Date();

    where.createdAt = { [Op.between]: [startDate, endDate] };
  }

  const { count, rows } = await SystemLog.findAndCountAll({
    where,
    include: [
      { model: User, as: "user", attributes: ["id", "name", "email"] },
      { model: Company, as: "company", attributes: ["id", "name"] }
    ],
    order: [["createdAt", "DESC"]],
    limit: limitNum,
    offset
  });

  return res.json({
    logs: rows,
    total: count,
    page: pageNum,
    pages: Math.ceil(count / limitNum),
    limit: limitNum
  });
};
