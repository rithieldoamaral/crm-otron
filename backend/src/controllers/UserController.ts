import { Request, Response } from "express";
import { getIO } from "../libs/socket";

import CheckSettingsHelper from "../helpers/CheckSettings";
import AppError from "../errors/AppError";

import CreateUserService from "../services/UserServices/CreateUserService";
import ListUsersService from "../services/UserServices/ListUsersService";
import UpdateUserService from "../services/UserServices/UpdateUserService";
import ShowUserService from "../services/UserServices/ShowUserService";
import DeleteUserService from "../services/UserServices/DeleteUserService";
import SimpleListService from "../services/UserServices/SimpleListService";
import User from "../models/User";
import { dbLog, LOG_ACTIONS } from "../services/SystemLogService/dbLogger";
import resolveCompanyId from "../helpers/ResolveCompanyId";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;

  const { users, count, hasMore } = await ListUsersService({
    searchParam,
    pageNumber,
    companyId,
    profile
  });

  return res.json({ users, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const {
    email,
    password,
    name,
    profile,
    companyId: bodyCompanyId,
    queueIds,
    whatsappId,
    allTicket
  } = req.body;
  let userCompanyId: number | null = null;

  let requestUser: User = null;

  if (req.user !== undefined) {
    const { companyId: cId } = req.user;
    userCompanyId = cId;
    requestUser = await User.findByPk(req.user.id);
  }

  const newUserCompanyId = bodyCompanyId || userCompanyId;

  if (req.url === "/signup") {
    if ((await CheckSettingsHelper("userCreation")) === "disabled") {
      throw new AppError("ERR_USER_CREATION_DISABLED", 403);
    }
  } else if (req.user?.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  } else if (newUserCompanyId !== req.user?.companyId && !requestUser?.super) {
    throw new AppError("ERR_NO_SUPER", 403);
  }

  const user = await CreateUserService({
    email,
    password,
    name,
    profile,
    companyId: newUserCompanyId,
    queueIds,
    whatsappId,
    allTicket
  });

  const io = getIO();
  io.to(`company-${userCompanyId}-mainchannel`).emit(
    `company-${userCompanyId}-user`,
    {
      action: "create",
      user
    }
  );

  dbLog({
    action: LOG_ACTIONS.USER_CREATED,
    companyId: userCompanyId,
    userId: req.user?.id ? +req.user.id : undefined,
    entity: "User",
    entityId: user.id,
    req
  });

  return res.status(200).json(user);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { userId } = req.params;

  const user = await ShowUserService(userId);

  return res.status(200).json(user);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id: requestUserId, companyId } = req.user;
  const { userId } = req.params;
  const userData = req.body;

  const user = await UpdateUserService({
    userData,
    userId,
    companyId,
    requestUserId: +requestUserId
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "update",
    user
  });

  dbLog({
    action: LOG_ACTIONS.USER_UPDATED,
    companyId,
    userId: +requestUserId,
    entity: "User",
    entityId: user.id,
    req
  });

  return res.status(200).json(user);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { userId } = req.params;
  const { companyId } = req.user;

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  await DeleteUserService(userId, companyId);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-user`, {
    action: "delete",
    userId
  });

  dbLog({
    action: LOG_ACTIONS.USER_DELETED,
    companyId,
    userId: +req.user.id,
    entity: "User",
    entityId: +userId,
    req
  });

  return res.status(200).json({ message: "User deleted" });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const { companyId: queryCompanyId } = req.query;

  // SEGURANÇA (2026-07-27 — CLAUDE.md XV.3): antes, `companyId ? +companyId
  // : userCompanyId` fazia o valor do cliente vencer o da sessão, expondo
  // nome e e-mail dos usuários de qualquer empresa. O painel de super admin
  // (CompaniesManager) usa esse filtro de propósito, então o helper preserva
  // o acesso para super e o nega para os demais.
  const companyId = await resolveCompanyId(
    req,
    queryCompanyId as string | undefined
  );

  const users = await SimpleListService({ companyId });

  return res.status(200).json(users);
};
