import { Request, Response } from "express";

import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import WhatsappTemplate from "../models/WhatsappTemplate";
import { syncTemplates } from "../services/ChannelService/templates/syncTemplates";
import { isCanalOficial } from "../services/ChannelService/types";

/**
 * Templates dos canais oficiais — somente leitura e sincronização.
 *
 * O CRM não cria nem submete template para aprovação (decisão registrada na
 * diretiva): isso acontece no painel da Meta, que é onde a aprovação sempre
 * aconteceria de qualquer forma. Aqui o operador vê o que já existe e manda
 * atualizar o espelho local.
 *
 * ISOLAMENTO MULTI-TENANT (CLAUDE.md XV.3): o `companyId` vem SEMPRE de
 * `req.user`, nunca da query. Uma conexão de outra empresa não pode ser lida
 * nem sincronizada por aqui.
 */

/** Carrega a conexão garantindo que ela pertence à empresa da sessão. */
const carregarConexaoDaEmpresa = async (
  whatsappId: string,
  companyId: number
): Promise<Whatsapp> => {
  const whatsapp = await Whatsapp.findOne({
    // companyId no WHERE, não conferido depois: assim é impossível esquecer
    // a comparação e devolver recurso de outro tenant.
    where: { id: whatsappId, companyId }
  });

  if (!whatsapp) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  return whatsapp;
};

/**
 * GET /whatsapp-templates/:whatsappId
 * Lista os templates espelhados de uma conexão.
 */
export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  const whatsapp = await carregarConexaoDaEmpresa(
    req.params.whatsappId,
    companyId
  );

  const templates = await WhatsappTemplate.findAll({
    where: { whatsappId: whatsapp.id, companyId },
    order: [
      ["status", "ASC"],
      ["name", "ASC"]
    ]
  });

  return res.json({ templates });
};

/**
 * POST /whatsapp-templates/:whatsappId/sync
 * Busca no provedor e atualiza o espelho local.
 */
export const sync = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  const whatsapp = await carregarConexaoDaEmpresa(
    req.params.whatsappId,
    companyId
  );

  if (!isCanalOficial(whatsapp.channelType)) {
    // Baileys não tem template: o conceito só existe no canal oficial.
    throw new AppError("ERR_FEATURE_BAILEYS_ONLY", 400);
  }

  const total = await syncTemplates(whatsapp);

  const templates = await WhatsappTemplate.findAll({
    where: { whatsappId: whatsapp.id, companyId },
    order: [["name", "ASC"]]
  });

  return res.json({ total, templates });
};
