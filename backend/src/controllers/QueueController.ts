import { Request, Response } from "express";
import { head } from "lodash";
import fs from "fs";
import path from "path";
import { getIO } from "../libs/socket";
import CreateQueueService from "../services/QueueService/CreateQueueService";
import DeleteQueueService from "../services/QueueService/DeleteQueueService";
import ListQueuesService from "../services/QueueService/ListQueuesService";
import ShowQueueService from "../services/QueueService/ShowQueueService";
import UpdateQueueService from "../services/QueueService/UpdateQueueService";
import Queue from "../models/Queue";
import AppError from "../errors/AppError";
import resolveCompanyId from "../helpers/ResolveCompanyId";

type QueueFilter = {
  companyId: number;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId: queryCompanyId } = req.query as unknown as QueueFilter;

  // SEGURANÇA (2026-07-27 — CLAUDE.md XV.3): antes, qualquer companyId da
  // query sobrescrevia o da sessão, então um usuário autenticado listava
  // as filas de outra empresa só trocando `?companyId=`. O helper mantém
  // o acesso cruzado para super admin e o nega para os demais.
  const companyId = await resolveCompanyId(req, queryCompanyId);

  const queues = await ListQueuesService({ companyId });

  return res.status(200).json(queues);
};

export const mediaUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { queueId } = req.params;
  const files = req.files as Express.Multer.File[];
  const file = head(files);

  try {
    const queue = await Queue.findByPk(queueId);

    queue.update({
      mediaPath: file.filename,
      mediaName: file.originalname
    });

    return res.send({ mensagem: "Arquivo Salvo" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};

export const deleteMedia = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { queueId } = req.params;

  try {
    const queue = await Queue.findByPk(queueId);
    const filePath = path.resolve(
      "public",
      `company${queue.companyId}`,
      queue.mediaPath
    );
    const fileExists = fs.existsSync(filePath);
    if (fileExists) {
      fs.unlinkSync(filePath);
    }

    queue.mediaPath = null;
    queue.mediaName = null;
    await queue.save();
    return res.send({ mensagem: "Arquivo excluído" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const {
    name,
    color,
    greetingMessage,
    outOfHoursMessage,
    schedules,
    orderQueue,
    integrationId,
    promptId,
    linkToGroup
  } = req.body;
  const { companyId } = req.user;
  console.log("queue", integrationId, promptId);
  const queue = await CreateQueueService({
    name,
    color,
    greetingMessage,
    companyId,
    outOfHoursMessage,
    schedules,
    orderQueue: orderQueue === "" ? null : orderQueue,
    integrationId: integrationId === "" ? null : integrationId,
    promptId: promptId === "" ? null : promptId,
    linkToGroup: linkToGroup || false
  });

  const io = getIO();
  io.emit(`company-${companyId}-queue`, {
    action: "update",
    queue
  });

  return res.status(200).json(queue);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { queueId } = req.params;
  const { companyId } = req.user;

  const queue = await ShowQueueService(queueId, companyId);

  return res.status(200).json(queue);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { queueId } = req.params;
  const { companyId } = req.user;
  const {
    name,
    color,
    greetingMessage,
    outOfHoursMessage,
    schedules,
    orderQueue,
    integrationId,
    promptId,
    linkToGroup
  } = req.body;
  const queue = await UpdateQueueService(
    queueId,
    {
      name,
      color,
      greetingMessage,
      outOfHoursMessage,
      schedules,
      orderQueue: orderQueue === "" ? null : orderQueue,
      integrationId: integrationId === "" ? null : integrationId,
      promptId: promptId === "" ? null : promptId,
      linkToGroup: linkToGroup || false
    },
    companyId
  );

  const io = getIO();
  io.emit(`company-${companyId}-queue`, {
    action: "update",
    queue
  });

  return res.status(201).json(queue);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { queueId } = req.params;
  const { companyId } = req.user;

  await DeleteQueueService(queueId, companyId);

  const io = getIO();
  io.emit(`company-${companyId}-queue`, {
    action: "delete",
    queueId: +queueId
  });

  return res.status(200).send();
};
