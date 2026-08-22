import * as Sentry from "@sentry/node";
import { WAMessage } from "baileys";
import AppError from "../../errors/AppError";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import formatBody from "../../helpers/Mustache";
import Whatsapp from "../../models/Whatsapp";
import { getChannelAdapter } from "../ChannelService/getChannelAdapter";
import { isCanalOficial } from "../ChannelService/types";
import { persistOutgoingMessage } from "../ChannelService/persistOutgoingMessage";
import { estaNaJanelaDeAtendimento } from "../ChannelService/serviceWindow";
import { pickTemplate } from "../ChannelService/templates/pickTemplate";

import Queue from "bull";
import { map_msg, buildContactAddress } from "../../utils/global";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
  isForwarded?: boolean;  
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg,
  isForwarded = false
}: Request): Promise<WAMessage | null> => {
  // ── Canal oficial (Cloud API / Twilio) ─────────────────────────────
  // Desvia ANTES de tocar em qualquer coisa da Baileys: GetTicketWbot
  // buscaria um socket que nao existe nestes canais.
  //
  // Leitura BARATA de proposito: ShowWhatsAppService traz filas e
  // integracoes por include e rodaria em TODO envio, inclusive Baileys —
  // query pesada a mais no caminho mais quente do sistema. Quando o ticket
  // ja vem com a conexao carregada, nem consulta.
  const conexao =
    ticket.whatsapp ?? (await Whatsapp.findByPk(ticket.whatsappId));

  if (!conexao) {
    throw new AppError("ERR_WAPP_NOT_FOUND");
  }

  if (isCanalOficial(conexao.channelType)) {
    const texto = formatBody(body, ticket.contact);

    const historico = await Message.findAll({
      where: { ticketId: ticket.id },
      attributes: ["fromMe", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 50
    });

    // Fora da janela de 24h a Meta so aceita template aprovado.
    let template;

    if (!estaNaJanelaDeAtendimento(historico)) {
      const aprovado = await pickTemplate(conexao.id, ticket.companyId, []);

      if (!aprovado) {
        logger.warn({
          fn: "SendWhatsAppMessage",
          ticketId: ticket.id,
          companyId: ticket.companyId,
          channelType: conexao.channelType,
          msg: "Janela de 24h fechada e nenhum template aprovado"
        });

        // Falha ALTA de proposito: tentar enviar livre faria a Meta recusar
        // e o sistema marcaria como enviada — cliente nunca receberia.
        throw new AppError("ERR_OUTSIDE_SERVICE_WINDOW", 400);
      }

      template = {
        name: aprovado.name,
        language: aprovado.language,
        params: []
      };
    }

    const enviado = await getChannelAdapter(conexao).sendText({
      to: buildContactAddress(ticket.contact, ticket.isGroup),
      body: texto,
      template
    });

    await persistOutgoingMessage({ ticket, body: texto, resultado: enviado });

    // null de proposito: verifyMessage tem guarda para isto e a mensagem ja
    // foi persistida acima.
    return null;
  }

  // ── Canal Baileys: caminho original, inalterado ────────────────────
  let options = {};
  const wbot = await GetTicketWbot(ticket);
  console.log('ticket.contact', ticket.contact);
  const number = buildContactAddress(ticket.contact, ticket.isGroup);
  console.log("number", number);
  if (quotedMsg) {
    const chatMessages = await Message.findOne({
      where: {
        id: quotedMsg.id
      }
    });

    if (chatMessages) {
      const msgFound = JSON.parse(chatMessages.dataJson);

      options = {
        quoted: {
          key: msgFound.key,
          message: msgFound.message
        }
      };
    }

  }

  const connection = process.env.REDIS_URI || "";

  const sendScheduledMessagesWbot = new Queue(
    "SendWbotMessages",
    connection
  );

  const messageData = {
    wbotId: wbot.id,
  number: number,
  text: formatBody(body, ticket.contact),
  options: { ...options }
};


  const sentMessage = sendScheduledMessagesWbot.add("SendMessageWbot", { messageData }, { delay: 500 });
  logger.info("Mensagem enviada via REDIS...");

  try {
    console.log('body:::::::::::::::::::::::::::', body)
    map_msg.set(ticket.contact.number, { lastSystemMsg: body })
    console.log('lastSystemMsg:::::::::::::::::::::::::::', ticket.contact.number)
    const sentMessage = await wbot.sendMessage(number, {
      text: formatBody(body, ticket.contact),
	  contextInfo: { forwardingScore: isForwarded ? 2 : 0, isForwarded: isForwarded ? true : false }
    },
      {
        ...options
      }
    );
    await ticket.update({ lastMessage: formatBody(body, ticket.contact) });
    console.log("Message sent", sentMessage);
    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
