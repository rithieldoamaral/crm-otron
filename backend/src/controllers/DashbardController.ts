import { Request, Response } from 'express';
import DashboardDataService, {
  DashboardData,
  Params,
} from '../services/ReportService/DashbardDataService';
import DashboardDataServiceV2 from '../services/ReportService/DashboardDataServiceV2';
import { TicketsAttendance } from '../services/ReportService/TicketsAttendance';
import { TicketsDayService } from '../services/ReportService/TicketsDayService';

type IndexQuery = {
  initialDate: string;
  finalDate: string;
  companyId: number | any;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const params: Params = req.query;
  const { companyId } = req.user;
  let daysInterval = 3;

  const dashboardData: DashboardData = await DashboardDataService(
    companyId,
    params,
  );
  return res.status(200).json(dashboardData);
};

/**
 * GET /dashboard/v2
 * Versão estendida com filtros de fila (queue_id) e atendente (user_id).
 * Mantém retrocompatibilidade total com os params do v1.
 */
export const indexV2 = async (req: Request, res: Response): Promise<Response> => {
  const params = req.query as any;
  const { companyId } = req.user;

  const dashboardData = await DashboardDataServiceV2(companyId, {
    days: params.days ? parseInt(params.days, 10) : undefined,
    date_from: params.date_from,
    date_to: params.date_to,
    queue_id: params.queue_id ? parseInt(params.queue_id, 10) : undefined,
    user_id: params.user_id ? parseInt(params.user_id, 10) : undefined,
  });

  return res.status(200).json(dashboardData);
};

export const reportsUsers = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { initialDate, finalDate, companyId } = req.query as IndexQuery;

  const { data } = await TicketsAttendance({
    initialDate,
    finalDate,
    companyId,
  });

  return res.json({ data });
};

export const reportsDay = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const { initialDate, finalDate, companyId } = req.query as IndexQuery;

  const { count, data } = await TicketsDayService({
    initialDate,
    finalDate,
    companyId,
  });

  return res.json({ count, data });
};
