import { Request, Response } from "express";
import { QueryTypes } from "sequelize";

import sequelize from "../database";
import { relatorioAgente } from "../services/SecretaryService/tools/relatorioAgente";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";

type RequestQueryProps = {
  initialDate: string;
  finalDate: string;
};

/**
 * Extrai e valida os parâmetros de um relatório.
 *
 * SEGURANÇA (auditoria 2026-07-27 — CLAUDE.md XV.3 e XV.4): o `companyId`
 * vem SEMPRE de `req.user`, nunca da query string. As rotas de relatório
 * usam apenas `isAuth`, então ler a empresa do request permitia que
 * qualquer usuário autenticado consultasse os dados de outra empresa
 * (IDOR) — basta trocar `?companyId=`. Autenticação não é autorização.
 *
 * As datas são validadas aqui e devolvidas para uso como `replacements`
 * do Sequelize. Nenhum dos três valores pode ser concatenado no SQL.
 *
 * @param req - Request do Express, já autenticado por `isAuth`
 * @returns companyId da sessão + datas validadas
 * @throws {AppError} ERR_MISSING_REPORT_PARAMS (400) se faltar data
 * @throws {AppError} ERR_INVALID_REPORT_DATE (400) se a data for malformada
 */
const parseReportParams = (
  req: Request
): { companyId: number; initialDate: string; finalDate: string } => {
  const { companyId } = req.user;
  const { initialDate, finalDate } = req.query as RequestQueryProps;

  if (!initialDate || !finalDate) {
    throw new AppError("ERR_MISSING_REPORT_PARAMS", 400);
  }

  // Aceita YYYY-MM-DD e ISO 8601 completo. A validação não é a defesa
  // contra SQLi (essa é o replacement); é para o usuário receber 400 em
  // vez de um erro de sintaxe do Postgres vazando estrutura interna.
  const isValidDate = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(value) &&
    !Number.isNaN(new Date(value).getTime());

  if (!isValidDate(initialDate) || !isValidDate(finalDate)) {
    throw new AppError("ERR_INVALID_REPORT_DATE", 400);
  }

  return { companyId: Number(companyId), initialDate, finalDate };
};

export const appointmentsAtendent = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, initialDate, finalDate } = parseReportParams(req);

  try {
    const resultAppointmentsByAttendents = await sequelize.query(
      `
        SELECT
           u."name" as user_name
          ,COUNT(t.*) as total_tickets
        FROM "Users" u
        LEFT JOIN "TicketTraking" tt ON tt."userId" = u.id
        LEFT JOIN "Tickets" t ON t.id = tt."ticketId" AND t."createdAt" BETWEEN :initialDate AND :finalDate
        where u."companyId" = :companyId
        GROUP BY u."name"
        ORDER BY total_tickets ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId, initialDate, finalDate }
      }
    );

    const resultTicketsByQueues = await sequelize.query(
      `
        SELECT
          q."name"
          ,COUNT(DISTINCT t.id) as total_tickets
        FROM "Queues" q
        LEFT JOIN "Messages" m ON m."queueId" = q.id
        LEFt JOIN "Tickets" t ON t.id = m."ticketId"  AND t."createdAt" BETWEEN :initialDate AND :finalDate
        WHERE q."companyId" = :companyId
        GROUP BY q."name"
        ORDER BY total_tickets ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId, initialDate, finalDate }
      }
    );

    return res.json({
      appointmentsByAttendents: resultAppointmentsByAttendents,
      ticketsByQueues: resultTicketsByQueues
    });
  } catch (err) {
    logger.error({
      fn: "appointmentsAtendent",
      companyId,
      initialDate,
      finalDate,
      err
    });
    throw err;
  }
};

export const rushHour = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, initialDate, finalDate } = parseReportParams(req);

  try {
    const resultAppointmentsByHours = await sequelize.query(
      `
        SELECT
          extract (hour from m."createdAt") AS message_hour,
          COUNT(m.id) AS message_count
        FROM "Messages" m
        LEFT JOIN "Tickets" t ON t.id = m."ticketId"
        WHERE t."companyId" = :companyId
          AND m."createdAt" BETWEEN :initialDate AND :finalDate
        GROUP BY
          extract (hour from m."createdAt")
        ORDER BY
          extract (hour from m."createdAt")
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId, initialDate, finalDate }
      }
    );

    return res.json(resultAppointmentsByHours);
  } catch (err) {
    logger.error({ fn: "rushHour", companyId, initialDate, finalDate, err });
    throw err;
  }
};

export const departamentRatings = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, initialDate, finalDate } = parseReportParams(req);

  try {
    const resultDepartamentRating = await sequelize.query(
      `
        SELECT
          m."ticketId"
          ,q."name"
          ,round(avg(ur.rate), 2) AS total_rate
        FROM "Messages" m
        LEFT JOIN "Tickets" t ON t.id = m."ticketId"
        LEFT JOIN "UserRatings" ur ON ur."ticketId" = t.id
        LEFT JOIN "Queues" q ON q.id = m."queueId"
        WHERE m."queueId" IS NOT NULL
          AND m."companyId" = :companyId
          AND ur."createdAt" BETWEEN :initialDate AND :finalDate
        GROUP BY m."ticketId", q."name"
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { companyId, initialDate, finalDate }
      }
    );

    return res.json(resultDepartamentRating);
  } catch (err) {
    logger.error({
      fn: "departamentRatings",
      companyId,
      initialDate,
      finalDate,
      err
    });
    throw err;
  }
};

export const agentReport = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const periodo = (req.query.periodo as string) || "hoje";
  const agente = req.query.agente as string | undefined;

  try {
    const result = await relatorioAgente(
      { periodo: periodo as any, agente },
      companyId
    );
    return res.json(result);
  } catch (err) {
    logger.error({ fn: "agentReport", companyId, periodo, err });
    throw err;
  }
};
