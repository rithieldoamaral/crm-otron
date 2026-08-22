import CreateMessageService from "../MessageServices/CreateMessageService";
import Ticket from "../../models/Ticket";
import { SendResult } from "./types";

/**
 * Persiste no banco uma mensagem ENVIADA por canal oficial.
 *
 * POR QUE NÃO REUSAR `verifyMessage`: ele recebe `proto.IWebMessageInfo` e
 * extrai tudo dessa estrutura (`msg.key.id`, `msg.key.remoteJid`,
 * `getTypeMessage(msg)`...). Canal oficial não produz esse formato, e fabricar
 * um objeto que finge ser Baileys é exatamente a opção rejeitada na diretiva
 * (§3.1, opção A): campo não preenchido viraria `undefined` silencioso dentro
 * de 4.343 linhas.
 *
 * Aqui a origem do dado é a resposta do próprio provedor, sem tradução.
 *
 * @param params.ticket - Ticket ao qual a mensagem pertence.
 * @param params.body - Texto já formatado, como vai aparecer na tela.
 * @param params.resultado - Retorno do adaptador (traz o id no provedor).
 * @param params.mediaUrl - URL da mídia, quando houver.
 * @param params.mediaType - Tipo da mídia; "chat" para texto puro.
 * @returns A mensagem persistida.
 *
 * @example
 * const enviado = await canal.sendText({ to, body });
 * await persistOutgoingMessage({ ticket, body, resultado: enviado });
 */
export const persistOutgoingMessage = async ({
  ticket,
  body,
  resultado,
  mediaUrl,
  mediaType = "chat"
}: {
  ticket: Ticket;
  body: string;
  resultado: SendResult;
  mediaUrl?: string;
  mediaType?: string;
}) => {
  const messageData = {
    // Id do provedor. É a mesma chave usada para casar o webhook de status
    // (entregue/lido) com a mensagem já gravada.
    id: resultado.channelMessageId,
    ticketId: ticket.id,
    // Mensagem nossa não tem contactId, igual ao caminho do Baileys
    // (`msg.key.fromMe ? undefined : contact.id`).
    contactId: undefined,
    body,
    fromMe: true,
    // Enviada por nós já nasce lida, como no caminho existente.
    read: true,
    mediaUrl,
    mediaType,
    ack: 0
  };

  await ticket.update({ lastMessage: body });

  return CreateMessageService({
    messageData,
    companyId: ticket.companyId
  });
};
