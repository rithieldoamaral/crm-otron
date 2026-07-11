import { Request, Response } from "express";
import authConfig from "../config/auth";
import * as Yup from "yup";

import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";

import { head } from "lodash";
import fs from "fs";
import path from "path";
import User from "../models/User";
import Company from "../models/Company";

import UpdateSettingService from "../services/SettingServices/UpdateSettingService";
import ListSettingsService from "../services/SettingServices/ListSettingsService";
import ShowSettingsService from "../services/SettingServices/ShowSettingsService";
import { invalidateCompanyCache } from "../services/AgentService/settingsCache";
import { filterSensitiveSettings, isSensitiveKey } from "../helpers/FilterSensitiveSettings";
import { dbLog, LOG_ACTIONS } from "../services/SystemLogService/dbLogger";

const SUPER_ADMIN_COMPANY_ID = Number(process.env.SUPER_ADMIN_COMPANY_ID || 1);

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  // SEGURANÇA (2026-06-28): o gate de admin estava comentado e QUALQUER usuário
  // autenticado recebia todas as settings — incluindo agentApiKey/agentWhisperApiKey
  // (credenciais pagas). Bloquear o endpoint quebraria o frontend de usuários comuns
  // (settings operacionais); a correção é filtrar as chaves sensíveis para não-admin.
  const settings = await ListSettingsService({ companyId });
  const isAdmin = req.user.profile === "admin";

  return res.status(200).json(filterSensitiveSettings(settings as any, isAdmin));
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }
  const { settingKey: key } = req.params;
  const { value } = req.body;
  const { companyId, id: userId } = req.user;

  // Configurações globais devem ser salvas com SUPER_ADMIN_COMPANY_ID
  // e apenas superadmins podem modificar
  const globalSettings = [
    "giphyApiKey",
    "enablePasswordRecovery",
    "passwordRecoveryWhatsAppId",
    "passwordRecoveryMessage",
    "geminiApiToken",
    "geminiModel"
  ];

  let targetCompanyId = companyId;
  if (globalSettings.includes(key)) {
    const requestUser = await User.findByPk(userId);
    if (!requestUser?.super) {
      throw new AppError("Você não tem permissão para modificar esta configuração!", 403);
    }
    targetCompanyId = SUPER_ADMIN_COMPANY_ID;
  }

  const setting = await UpdateSettingService({
    key,
    value,
    companyId: targetCompanyId
  });

  // Invalida o cache de settings da empresa para que o próximo
  // handleClientAgent/sandbox reflita imediatamente o novo valor.
  // Sem isto, o agente usaria o nome/personalidade antigos por até 30s.
  invalidateCompanyCache(targetCompanyId);

  const io = getIO();
  io.to(`company-${targetCompanyId}-mainchannel`).emit(`company-${targetCompanyId}-settings`, {
    action: "update",
    setting
  });

  // Auditoria: NUNCA grava o valor de chaves sensíveis (API keys/tokens) no log,
  // só o nome da chave alterada — evita vazar segredo num registro de auditoria.
  dbLog({
    action: LOG_ACTIONS.SETTING_UPDATED,
    companyId: targetCompanyId,
    userId: +userId,
    entity: "Setting",
    details: { key, value: isSensitiveKey(key) ? "(valor sensível oculto)" : value },
    req
  });

  return res.status(200).json(setting);
};


export const show = async (
  req: Request,
  res: Response
): Promise<Response> => {

  //const { companyId } = req.user;
  const companyId = SUPER_ADMIN_COMPANY_ID;
  const { settingKey } = req.params;
  

  const retornoData = await ShowSettingsService({ settingKey, companyId });

  return res.status(200).json(retornoData);
};


export const mediaUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { body } = req.body;
  const { companyId } = req.user;

  const userId = req.user.id;
  const requestUser = await User.findByPk(userId);

  if (requestUser.super === false) {
    throw new AppError("você nao tem permissão para esta ação!");
  }

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  if (companyId !== SUPER_ADMIN_COMPANY_ID) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const files = req.files as Express.Multer.File[];
  const file = head(files);
  console.log(file);
  return res.send({ mensagem: "Arquivo Anexado" });
};


export const gerencianetCertUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, profile, id: userId } = req.user;

  const requestUser = await User.findByPk(userId);

  if (!requestUser?.super) {
    throw new AppError("você nao tem permissão para esta ação!");
  }

  if (profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  if (companyId !== SUPER_ADMIN_COMPANY_ID) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const file = req.file as Express.Multer.File | undefined;

  if (!file) {
    throw new AppError("Nenhum certificado foi enviado.", 400);
  }

  const certKey = path.parse(file.filename).name;

  const setting = await UpdateSettingService({
    key: "gerencianetPixCert",
    value: certKey,
    companyId: SUPER_ADMIN_COMPANY_ID
  });

  return res.status(200).json({
    filename: file.filename,
    setting
  });
};



export const docUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { body } = req.body;
  const { companyId } = req.user;

  const userId = req.user.id;
  const requestUser = await User.findByPk(userId);

  if (requestUser.super === false) {
    throw new AppError("você nao tem permissão para esta ação!");
  }

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  if (companyId !== SUPER_ADMIN_COMPANY_ID) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const files = req.files as Express.Multer.File[];
  const file = head(files);
  console.log(file);
  return res.send({ mensagem: "Arquivo Anexado" });
};
