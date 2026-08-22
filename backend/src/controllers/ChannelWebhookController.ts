import { Request, Response } from "express";

import Whatsapp from "../models/Whatsapp";
import { getChannelConfig } from "../services/ChannelService/channelConfig";
import { handleIncomingChannelMessage } from "../services/ChannelService/handleIncomingChannelMessage";
import {
  handleChannelStatus,
  parseStatusMeta,
  parseStatusTwilio
} from "../services/ChannelService/handleChannelStatus";
import {
  parsePayloadMeta,
  parsePayloadTwilio
} from "../services/ChannelService/parseIncoming";
import { isCanalOficial } from "../services/ChannelService/types";
import {
  conferirVerifyToken,
  verificarAssinaturaMeta,
  verificarAssinaturaTwilio
} from "../services/ChannelService/webhookSignature";
import { logger } from "../utils/logger";

/**
 * Webhook dos canais oficiais.
 *
 * ROTA PÚBLICA POR NECESSIDADE: a Meta e a Twilio chamam de fora, sem JWT.
 * Não há como exigir autenticação de sessão aqui. A proteção é a ASSINATURA —
 * é ela, e só ela, que separa mensagem real de injeção por `curl`.
 *
 * A empresa é resolvida a partir do `whatsappId` da URL, NUNCA de campo do
 * corpo (CLAUDE.md XV.3): o corpo é controlado por quem chama, então confiar
 * nele para decidir de qual empresa é a mensagem permitiria escrever no tenant
 * alheio.
 */

/**
 * GET — handshake de verificação da Meta.
 *
 * Ao cadastrar o webhook, a Meta chama com `hub.verify_token` e espera o
 * `hub.challenge` de volta. Só devolvemos se o token conferir; caso contrário
 * qualquer um cadastraria nosso endpoint no app dele.
 */
export const verify = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { whatsappId } = req.params;
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  const whatsapp = await Whatsapp.findByPk(whatsappId);

  if (!whatsapp || !isCanalOficial(whatsapp.channelType)) {
    return res.sendStatus(404);
  }

  const { verifyToken } = getChannelConfig(whatsapp);

  if (modo === "subscribe" && conferirVerifyToken(token, verifyToken)) {
    logger.info({
      fn: "ChannelWebhook.verify",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      msg: "Webhook verificado pela Meta"
    });

    // A Meta espera o desafio como texto puro, não JSON.
    return res.status(200).send(challenge);
  }

  // Tentativa de verificação com token errado é evento de segurança, não
  // ruído: registra para dar visibilidade a sondagem do endpoint (XV.5).
  logger.warn({
    fn: "ChannelWebhook.verify",
    whatsappId: whatsapp.id,
    companyId: whatsapp.companyId,
    msg: "Handshake recusado — verify_token não confere"
  });

  return res.sendStatus(403);
};

/**
 * POST — eventos (mensagens recebidas, status de entrega).
 *
 * Responde 200 ANTES de processar. A Meta espera resposta em segundos e
 * reenvia o evento se demorar — processar antes de responder produziria
 * reentrega e mensagem duplicada. O processamento roda depois, e falha nele
 * não pode alterar a resposta já enviada.
 */
export const receive = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { whatsappId } = req.params;

  const whatsapp = await Whatsapp.findByPk(whatsappId);

  if (!whatsapp || !isCanalOficial(whatsapp.channelType)) {
    return res.sendStatus(404);
  }

  const config = getChannelConfig(whatsapp);
  const ehTwilio = whatsapp.channelType === "twilio";

  // ── Verificação de assinatura: a única barreira desta rota ──────────
  const assinaturaValida = ehTwilio
    ? verificarAssinaturaTwilio(
        config.authToken,
        req.header("X-Twilio-Signature"),
        `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        req.body
      )
    : verificarAssinaturaMeta(
        (req as any).rawBody,
        req.header("X-Hub-Signature-256"),
        config.appSecret
      );

  if (!assinaturaValida) {
    logger.warn({
      fn: "ChannelWebhook.receive",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      channelType: whatsapp.channelType,
      msg: "Assinatura de webhook inválida — requisição recusada"
    });

    return res.sendStatus(403);
  }

  const mensagens = ehTwilio
    ? parsePayloadTwilio(req.body)
    : parsePayloadMeta(req.body);

  // Responde JÁ. Tudo abaixo roda depois, sem poder mudar esta resposta.
  res.sendStatus(200);

  // Eventos de STATUS chegam pela mesma rota das mensagens. Sem processá-los,
  // os tiques de entregue/lido nunca funcionariam no canal oficial.
  const statuses = ehTwilio
    ? parseStatusTwilio(req.body)
    : parseStatusMeta(req.body);

  // eslint-disable-next-line no-restricted-syntax
  for (const status of statuses) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await handleChannelStatus(status, whatsapp);
    } catch (err: any) {
      logger.error({
        fn: "ChannelWebhook.receive",
        whatsappId: whatsapp.id,
        companyId: whatsapp.companyId,
        channelMessageId: status.channelMessageId,
        err: err.message,
        msg: "Falha ao aplicar status de entrega"
      });
    }
  }

  // eslint-disable-next-line no-restricted-syntax
  for (const incoming of mensagens) {
    try {
      // Sequencial de propósito: duas mensagens do mesmo contato em paralelo
      // criariam dois tickets, porque ambas passariam pelo findOrCreate antes
      // de qualquer uma gravar.
      // eslint-disable-next-line no-await-in-loop
      await handleIncomingChannelMessage(incoming, whatsapp);
    } catch (err: any) {
      // Não re-lança: a resposta já foi enviada e um erro aqui não pode
      // derrubar o processamento das mensagens seguintes. Mas LOGA com
      // contexto — catch silencioso é proibido (CLAUDE.md II.5).
      logger.error({
        fn: "ChannelWebhook.receive",
        whatsappId: whatsapp.id,
        companyId: whatsapp.companyId,
        channelMessageId: incoming.channelMessageId,
        err: err.message,
        msg: "Falha ao processar mensagem recebida"
      });
    }
  }

  return res;
};
