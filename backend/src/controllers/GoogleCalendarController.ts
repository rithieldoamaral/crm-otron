import { Request, Response } from "express";
import * as Yup from "yup";
import { Op } from "sequelize";
import sequelize from "../database";
import AppError from "../errors/AppError";
import {
  getAuthorizationUrl, handleOAuthCallback,
  disconnectCalendar, disconnectProfessionalCalendar,
  MissingCalendarScopeError
} from "../services/GoogleCalendarService/oauth";
import Service from "../models/Service";
import ServiceProfessional from "../models/ServiceProfessional";
import UserCalendar from "../models/UserCalendar";
import UserWorkingHours from "../models/UserWorkingHours";
import User from "../models/User";
import CalendarProfessional from "../models/CalendarProfessional";
import ProfessionalCalendar from "../models/ProfessionalCalendar";
import ProfessionalWorkingHours from "../models/ProfessionalWorkingHours";

// ─── Schemas de validação ───────────────────────────────────────────────────

const ServiceCreateSchema = Yup.object().shape({
  name: Yup.string().required("Nome é obrigatório").min(2, "Mínimo 2 caracteres").max(120),
  durationMinutes: Yup.number().required().integer().min(5, "Duração mínima 5 minutos").max(480, "Duração máxima 8h"),
  description: Yup.string().max(500).optional(),
  professionalIds: Yup.array().of(Yup.number().integer().positive()).optional()
});

const ServiceUpdateSchema = Yup.object().shape({
  name: Yup.string().min(2).max(120).optional(),
  durationMinutes: Yup.number().integer().min(5).max(480).optional(),
  description: Yup.string().max(500).optional(),
  isActive: Yup.boolean().optional(),
  professionalIds: Yup.array().of(Yup.number().integer().positive()).optional()
});

const WorkingHoursSchema = Yup.array().of(
  Yup.object().shape({
    dayOfWeek: Yup.number().integer().min(0).max(6).required(),
    startTime: Yup.string().matches(/^\d{2}:\d{2}$/, "Formato HH:MM").required(),
    endTime: Yup.string().matches(/^\d{2}:\d{2}$/, "Formato HH:MM").required(),
    isWorking: Yup.boolean().required()
  })
).required();

/**
 * Valida que todos os userIds pertencem à empresa do requisitante.
 * Lança AppError se algum não pertence — impede vazamento cross-company.
 */
async function assertUsersInCompany(userIds: number[], companyId: number): Promise<void> {
  if (!userIds.length) return;
  const count = await User.count({ where: { id: { [Op.in]: userIds }, companyId } });
  if (count !== userIds.length) {
    throw new AppError("Um ou mais profissionais não pertencem a esta empresa", 403);
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

/**
 * GET /google-calendar/auth-url?userId=X
 * GET /google-calendar/auth-url?professionalId=X
 *
 * Retorna a URL de autorização OAuth do Google. Aceita userId (platform user)
 * OU professionalId (CalendarProfessional sem conta CRM).
 */
export const getAuthUrl = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const professionalId = req.query.professionalId ? Number(req.query.professionalId) : undefined;

  if (professionalId != null) {
    // Valida que o profissional pertence à empresa antes de gerar a URL
    const prof = await CalendarProfessional.findOne({ where: { id: professionalId, companyId } });
    if (!prof) throw new AppError("Profissional não encontrado", 404);
    const url = getAuthorizationUrl(null, companyId, professionalId);
    return res.status(200).json({ url });
  }

  const userId = Number(req.query.userId || req.user.id);
  const url = getAuthorizationUrl(userId, companyId);
  return res.status(200).json({ url });
};

/** GET /google-calendar/oauth-callback?code=X&state=Y
 * Google redirects here after the user grants permission.
 * Returns a self-closing HTML page that posts a message to the opener and closes the popup. */
export const oauthCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as { code: string; state: string; error?: string };
  const origin = process.env.FRONTEND_URL || "http://localhost:3000";

  // `errorCode` permite o frontend distinguir o motivo da falha. Hoje:
  //   - "MISSING_CALENDAR_SCOPE": usuário não autorizou Google Calendar
  //   - "GENERIC": qualquer outro erro de callback
  // Sem esse campo o usuário só vê "Erro ao conectar" e não sabe o que fazer.
  const closePopup = (connected: boolean, errorCode?: string, message?: string) => {
    res.setHeader("Content-Type", "text/html");
    const safeMsg = (message ?? "").replace(/[<>&"']/g, ""); // basic sanitize p/ JSON inline
    res.send(`<!DOCTYPE html><html><head><title>Google Calendar</title></head><body>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        type: 'GOOGLE_CALENDAR_OAUTH',
        connected: ${connected},
        error: ${!connected},
        errorCode: ${JSON.stringify(errorCode ?? null)},
        message: ${JSON.stringify(safeMsg)}
      }, '${origin}');
      try { window.opener.focus(); } catch(e) {}
    }
  } catch(e) {}
  // Give the message a tick to be delivered before closing
  setTimeout(function() { window.close(); }, 150);
</script>
<p style="font-family:sans-serif;text-align:center;margin-top:40px">${connected ? "Conectado! Pode fechar esta janela." : "Erro ao conectar. Pode fechar esta janela."}</p>
</body></html>`);
  };

  if (error) {
    console.error("[GoogleCalendar] OAuth denied by user:", error);
    closePopup(false, "USER_DENIED");
    return;
  }
  try {
    await handleOAuthCallback(code, state);
    closePopup(true);
  } catch (err: any) {
    const isScopeError = err instanceof MissingCalendarScopeError;
    console.error(
      `[GoogleCalendar] oauthCallback ${isScopeError ? "SCOPE FALTANTE" : "ERRO"}:`,
      err?.message ?? err
    );
    closePopup(
      false,
      isScopeError ? "MISSING_CALENDAR_SCOPE" : "GENERIC",
      isScopeError ? err.message : undefined
    );
  }
};

/**
 * DELETE /google-calendar/disconnect/:id?type=professional
 * DELETE /google-calendar/disconnect/:id          (default: platform user)
 *
 * Desconecta o Google Calendar. O param `type=professional` indica que o ID
 * é de um CalendarProfessional; sem ele, trata como platform userId.
 */
export const disconnectUser = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.userId);
  const isProfessional = req.query.type === "professional";

  if (isProfessional) {
    const prof = await CalendarProfessional.findOne({ where: { id, companyId } });
    if (!prof) throw new AppError("Profissional não encontrado", 404);
    await disconnectProfessionalCalendar(id, companyId);
  } else {
    await disconnectCalendar(id, companyId);
  }
  return res.status(200).json({ ok: true });
};

/**
 * GET /google-calendar/status
 *
 * Retorna status de conexão para todos os profissionais da empresa:
 * - Platform users (conta CRM) → type: "user"
 * - CalendarProfessionals (sem conta CRM) → type: "professional"
 *
 * O frontend usa `type` para saber qual endpoint chamar ao conectar/desconectar.
 */
export const getConnectionStatus = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;

  // Platform users
  const users = await User.findAll({ where: { companyId }, attributes: ["id", "name", "email"] });
  const calendars = await UserCalendar.findAll({ where: { companyId } });
  const calendarMap = Object.fromEntries(calendars.map((c: any) => [c.userId, c]));

  const userRows = users.map((u: any) => ({
    type: "user" as const,
    userId: u.id,
    name: u.name,
    email: u.email,
    connected: !!calendarMap[u.id]?.isActive,
    googleAccountEmail: calendarMap[u.id]?.googleAccountEmail ?? null,
    tokenExpiry: calendarMap[u.id]?.tokenExpiry ?? null
  }));

  // Standalone professionals (sem conta CRM)
  const professionals = await CalendarProfessional.findAll({ where: { companyId } });
  const profCalendars = await ProfessionalCalendar.findAll({ where: { companyId } });
  const profCalMap = Object.fromEntries(profCalendars.map((c: any) => [c.professionalId, c]));

  const professionalRows = professionals.map((p: any) => ({
    type: "professional" as const,
    userId: p.id,   // reutiliza campo userId no frontend como identificador genérico
    name: p.name,
    email: null,
    connected: !!profCalMap[p.id]?.isActive,
    googleAccountEmail: profCalMap[p.id]?.googleAccountEmail ?? null,
    tokenExpiry: profCalMap[p.id]?.tokenExpiry ?? null
  }));

  return res.status(200).json([...userRows, ...professionalRows]);
};

// ─── Services CRUD ────────────────────────────────────────────────────────────

/** GET /google-calendar/services
 * Por default retorna apenas serviços ativos (isActive=true).
 * Admins podem passar ?includeInactive=true para ver todos. */
export const listServices = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const includeInactive = req.query.includeInactive === "true";

  const where: any = { companyId };
  if (!includeInactive) where.isActive = true;

  const services = await Service.findAll({
    where,
    include: [{ model: ServiceProfessional, as: "serviceProfessionals", include: [{ model: User, as: "user", attributes: ["id", "name"] }] }]
  });
  return res.status(200).json(services);
};

/** POST /google-calendar/services */
export const createService = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;

  try {
    await ServiceCreateSchema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    throw new AppError(err.errors?.join("; ") ?? err.message, 400);
  }

  const { name, durationMinutes, description, professionalIds } = req.body as {
    name: string; durationMinutes: number; description?: string; professionalIds?: number[];
  };

  // Valida cross-company antes de criar — impede associar users de outras empresas
  if (professionalIds?.length) {
    await assertUsersInCompany(professionalIds, companyId);
  }

  const service = await sequelize.transaction(async (t) => {
    const created = await Service.create(
      { name, durationMinutes, description: description ?? "", companyId, isActive: true } as any,
      { transaction: t }
    );

    if (professionalIds?.length) {
      await ServiceProfessional.bulkCreate(
        professionalIds.map(userId => ({ serviceId: (created as any).id, userId, companyId })),
        { transaction: t }
      );
    }

    return created;
  });

  return res.status(201).json(service);
};

/** PUT /google-calendar/services/:id */
export const updateService = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.id);

  try {
    await ServiceUpdateSchema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    throw new AppError(err.errors?.join("; ") ?? err.message, 400);
  }

  const { name, durationMinutes, description, isActive, professionalIds } = req.body as {
    name?: string; durationMinutes?: number; description?: string; isActive?: boolean; professionalIds?: number[];
  };

  const service = await Service.findOne({ where: { id, companyId } });
  if (!service) throw new AppError("Serviço não encontrado", 404);

  if (professionalIds !== undefined && professionalIds.length) {
    await assertUsersInCompany(professionalIds, companyId);
  }

  await sequelize.transaction(async (t) => {
    await service.update({ name, durationMinutes, description, isActive } as any, { transaction: t });

    if (professionalIds !== undefined) {
      await ServiceProfessional.destroy({ where: { serviceId: id, companyId }, transaction: t });
      if (professionalIds.length) {
        await ServiceProfessional.bulkCreate(
          professionalIds.map(userId => ({ serviceId: id, userId, companyId })),
          { transaction: t }
        );
      }
    }
  });

  return res.status(200).json(service);
};

/** DELETE /google-calendar/services/:id — soft delete */
export const deleteService = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.id);
  const service = await Service.findOne({ where: { id, companyId } });
  if (!service) throw new AppError("Serviço não encontrado", 404);
  await service.update({ isActive: false } as any);
  return res.status(200).json({ ok: true });
};

// ─── Working Hours ─────────────────────────────────────────────────────────────

/**
 * GET /google-calendar/working-hours/:id?type=professional
 * GET /google-calendar/working-hours/:id          (default: platform user)
 */
export const getWorkingHours = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.userId);
  const isProfessional = req.query.type === "professional";

  if (isProfessional) {
    const rows = await ProfessionalWorkingHours.findAll({
      where: { professionalId: id, companyId },
      order: [["dayOfWeek", "ASC"]]
    });
    return res.status(200).json(rows);
  }

  const rows = await UserWorkingHours.findAll({ where: { userId: id, companyId }, order: [["dayOfWeek", "ASC"]] });
  return res.status(200).json(rows);
};

/**
 * PUT /google-calendar/working-hours/:id?type=professional
 * PUT /google-calendar/working-hours/:id          (default: platform user)
 *
 * Full replace — destrói e recria em transação para evitar estado inconsistente.
 */
export const saveWorkingHours = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.userId);
  const isProfessional = req.query.type === "professional";

  try {
    await WorkingHoursSchema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    throw new AppError(err.errors?.join("; ") ?? err.message, 400);
  }

  const days = req.body as Array<{ dayOfWeek: number; startTime: string; endTime: string; isWorking: boolean }>;

  if (isProfessional) {
    // Valida que o profissional pertence à empresa (impede cross-company)
    const prof = await CalendarProfessional.findOne({ where: { id, companyId } });
    if (!prof) throw new AppError("Profissional não encontrado", 404);

    await sequelize.transaction(async (t) => {
      await ProfessionalWorkingHours.destroy({ where: { professionalId: id, companyId }, transaction: t });
      if (days.length) {
        await ProfessionalWorkingHours.bulkCreate(
          days.map(d => ({ ...d, professionalId: id, companyId })),
          { transaction: t }
        );
      }
    });

    const saved = await ProfessionalWorkingHours.findAll({ where: { professionalId: id, companyId }, order: [["dayOfWeek", "ASC"]] });
    return res.status(200).json(saved);
  }

  // Platform user
  await assertUsersInCompany([id], companyId);

  await sequelize.transaction(async (t) => {
    await UserWorkingHours.destroy({ where: { userId: id, companyId }, transaction: t });
    if (days.length) {
      await UserWorkingHours.bulkCreate(
        days.map(d => ({ ...d, userId: id, companyId })),
        { transaction: t }
      );
    }
  });

  const saved = await UserWorkingHours.findAll({ where: { userId: id, companyId }, order: [["dayOfWeek", "ASC"]] });
  return res.status(200).json(saved);
};

// ─── CalendarProfessionals CRUD ──────────────────────────────────────────────

const ProfessionalCreateSchema = Yup.object().shape({
  name: Yup.string().required("Nome é obrigatório").min(2).max(150)
});

const ProfessionalUpdateSchema = Yup.object().shape({
  name: Yup.string().min(2).max(150).required()
});

/** GET /google-calendar/professionals */
export const listProfessionals = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const rows = await CalendarProfessional.findAll({
    where: { companyId },
    order: [["name", "ASC"]]
  });
  return res.status(200).json(rows);
};

/** POST /google-calendar/professionals */
export const createProfessional = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  try {
    await ProfessionalCreateSchema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    throw new AppError(err.errors?.join("; ") ?? err.message, 400);
  }
  const { name } = req.body as { name: string };
  const professional = await CalendarProfessional.create({ name, companyId });
  return res.status(201).json(professional);
};

/** PUT /google-calendar/professionals/:id */
export const updateProfessional = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.id);
  try {
    await ProfessionalUpdateSchema.validate(req.body, { abortEarly: false });
  } catch (err: any) {
    throw new AppError(err.errors?.join("; ") ?? err.message, 400);
  }
  const professional = await CalendarProfessional.findOne({ where: { id, companyId } });
  if (!professional) throw new AppError("Profissional não encontrado", 404);
  await professional.update({ name: req.body.name });
  return res.status(200).json(professional);
};

/** DELETE /google-calendar/professionals/:id */
export const deleteProfessional = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.id);
  const professional = await CalendarProfessional.findOne({ where: { id, companyId } });
  if (!professional) throw new AppError("Profissional não encontrado", 404);
  // Cascata via FK: ProfessionalCalendar e ProfessionalWorkingHours são apagados automaticamente
  await professional.destroy();
  return res.status(200).json({ ok: true });
};

/**
 * PUT /google-calendar/rename/:id?type=user|professional
 *
 * Renomeia qualquer participante do calendário de forma segura:
 * - type=professional → CalendarProfessional (sem conta CRM)
 * - type=user (default) → platform User (conta CRM)
 *
 * companyId vem exclusivamente do JWT — sem risco de cross-company.
 * Não usa UpdateUserService para evitar a exigência de companyId no body.
 */
export const renameProfessional = async (req: Request, res: Response): Promise<Response> => {
  const companyId = req.user.companyId;
  const id = Number(req.params.id);
  const { name } = req.body as { name: string };

  if (!name || name.trim().length < 2) {
    throw new AppError("Nome deve ter ao menos 2 caracteres", 400);
  }

  const trimmedName = name.trim();
  const isProfessional = req.query.type === "professional";

  if (isProfessional) {
    const prof = await CalendarProfessional.findOne({ where: { id, companyId } });
    if (!prof) throw new AppError("Profissional não encontrado", 404);
    await prof.update({ name: trimmedName });
    return res.status(200).json({ id: (prof as any).id, name: (prof as any).name });
  }

  // Platform user — valida companyId pelo JWT, sem depender do UpdateUserService
  const user = await User.findOne({ where: { id, companyId } });
  if (!user) throw new AppError("Usuário não encontrado", 404);
  await user.update({ name: trimmedName });
  return res.status(200).json({ id: (user as any).id, name: (user as any).name });
};
