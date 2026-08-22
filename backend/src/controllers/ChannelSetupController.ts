import { Request, Response } from "express";
import crypto from "crypto";

import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import {
  buildChannelConfig,
  ChannelConfig,
  getChannelConfig,
  maskChannelConfig
} from "../services/ChannelService/channelConfig";
import { getChannelAdapter } from "../services/ChannelService/getChannelAdapter";
import { ChannelType, isCanalOficial } from "../services/ChannelService/types";
import { validateCredentials } from "../services/ChannelService/validateCredentials";
import { logger } from "../utils/logger";

/**
 * Configuração de canais oficiais — apoio ao Assistente de Conexão.
 *
 * ISOLAMENTO MULTI-TENANT (CLAUDE.md XV.3): o `companyId` vem SEMPRE de
 * `req.user`. Uma conexão de outra empresa não é encontrada nem alterada por
 * aqui, porque o `companyId` entra no WHERE — não numa comparação posterior
 * que se pode esquecer.
 *
 * CREDENCIAIS NUNCA VOLTAM (XV.6 e IV.3): as respostas devolvem apenas a
 * máscara produzida por `maskChannelConfig`. O valor em texto puro entra, é
 * cifrado e não sai mais.
 */

/** Carrega a conexão garantindo que pertence à empresa da sessão. */
const carregarConexao = async (
  whatsappId: string,
  companyId: number
): Promise<Whatsapp> => {
  const whatsapp = await Whatsapp.findOne({
    where: { id: whatsappId, companyId }
  });

  if (!whatsapp) {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  return whatsapp;
};

/**
 * POST /channel/validate
 * Testa credenciais contra a API do provedor, sem salvar nada.
 *
 * Existe separado do salvamento para o assistente poder dar retorno imediato
 * a cada campo preenchido, em vez de só no final.
 */
export const validate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { channelType, config } = req.body as {
    channelType: ChannelType;
    config: ChannelConfig;
  };

  if (!isCanalOficial(channelType)) {
    throw new AppError("ERR_INVALID_CHANNEL_TYPE", 400);
  }

  const resultado = await validateCredentials(channelType, config);

  // Log sem credencial: registra QUE houve validação e o desfecho, jamais o
  // conteúdo do que foi validado.
  logger.info({
    fn: "ChannelSetup.validate",
    companyId: req.user.companyId,
    channelType,
    valido: resultado.valido,
    msg: "Validação de credencial de canal"
  });

  return res.json(resultado);
};

/**
 * PUT /channel/:whatsappId/config
 * Grava as credenciais (cifradas) e marca o tipo de canal.
 */
export const saveConfig = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { channelType, config } = req.body as {
    channelType: ChannelType;
    config: ChannelConfig;
  };

  if (!isCanalOficial(channelType)) {
    throw new AppError("ERR_INVALID_CHANNEL_TYPE", 400);
  }

  const whatsapp = await carregarConexao(req.params.whatsappId, companyId);

  // Valida ANTES de gravar: salvar credencial que não funciona deixaria a
  // conexão num estado que parece pronto e não está.
  const resultado = await validateCredentials(channelType, config);

  if (!resultado.valido) {
    throw new AppError(resultado.mensagem, 400);
  }

  // Gera o token de verificação do webhook aqui, e não no navegador: é um
  // segredo compartilhado com o provedor, e o frontend não precisa conhecê-lo.
  const anterior = getChannelConfig(whatsapp);
  const verifyToken =
    anterior.verifyToken || crypto.randomBytes(24).toString("hex");

  await whatsapp.update({
    channelType,
    channelConfig: buildChannelConfig({ ...config, verifyToken }),
    // Credencial validada é conexão utilizável. Canal oficial não tem sessão
    // para "conectar" — o status vem do teste, não de evento de socket.
    status: "CONNECTED"
  });

  logger.info({
    fn: "ChannelSetup.saveConfig",
    whatsappId: whatsapp.id,
    companyId,
    channelType,
    msg: "Credenciais de canal gravadas"
  });

  return res.json({
    whatsappId: whatsapp.id,
    channelType,
    detalhes: resultado.detalhes,
    channelConfig: maskChannelConfig(whatsapp)
  });
};

/**
 * GET /channel/:whatsappId/webhook-info
 * Devolve a URL e o token que o operador precisa cadastrar no provedor.
 */
export const webhookInfo = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const whatsapp = await carregarConexao(req.params.whatsappId, companyId);

  const { verifyToken } = getChannelConfig(whatsapp);

  // A URL é montada no servidor para o usuário não ter que descobrir o próprio
  // domínio — um dos pontos onde alguém sem conhecimento técnico trava.
  const base =
    process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;

  return res.json({
    url: `${base}/webhook/whatsapp/${whatsapp.id}`,
    verifyToken: verifyToken || "",
    // A Twilio não usa verify token; a UI esconde o campo com base nisto.
    precisaVerifyToken: whatsapp.channelType === "cloud_api"
  });
};

/**
 * POST /channel/:whatsappId/test-message
 * Envia uma mensagem de teste para o número informado.
 *
 * É a última etapa do assistente e a única prova real de que a configuração
 * funciona ponta a ponta. Credencial válida e webhook cadastrado ainda podem
 * não entregar (número não registrado, WABA suspensa) — só o envio revela.
 */
export const testMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { to } = req.body as { to: string };

  if (!to) {
    throw new AppError("ERR_TEST_NUMBER_REQUIRED", 400);
  }

  const whatsapp = await carregarConexao(req.params.whatsappId, companyId);

  if (!isCanalOficial(whatsapp.channelType)) {
    throw new AppError("ERR_FEATURE_OFFICIAL_ONLY", 400);
  }

  try {
    const enviado = await getChannelAdapter(whatsapp).sendText({
      to,
      body: "✅ Teste de conexão do Otron CRM. Se você recebeu esta mensagem, o canal oficial está funcionando."
    });

    return res.json({
      sucesso: true,
      channelMessageId: enviado.channelMessageId
    });
  } catch (err: any) {
    logger.warn({
      fn: "ChannelSetup.testMessage",
      whatsappId: whatsapp.id,
      companyId,
      err: err.message,
      msg: "Mensagem de teste não foi entregue"
    });

    // Devolve o motivo em vez de 500 genérico: é exatamente o que o assistente
    // precisa mostrar para o usuário corrigir.
    return res.status(400).json({ sucesso: false, mensagem: err.message });
  }
};
