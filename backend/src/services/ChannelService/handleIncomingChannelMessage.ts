import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import { IncomingMessage } from "./types";

/**
 * Processa uma mensagem recebida por canal oficial.
 *
 * POR QUE NÃO REUSAR `handleMessage` DO LISTENER: aquele recebe
 * `proto.IWebMessageInfo` e extrai tudo dessa estrutura, dentro de um arquivo
 * de 4.343 linhas. Fabricar um objeto que finge ser Baileys é a opção A
 * rejeitada na diretiva (§3.1) — campo não preenchido viraria `undefined`
 * silencioso lá no meio.
 *
 * O que este handler REUSA são os serviços de negócio: contato, ticket e
 * mensagem são criados exatamente pelos mesmos serviços do caminho Baileys.
 * A duplicação é de orquestração, não de regra de negócio.
 *
 * IDEMPOTÊNCIA: a Meta reenvia o webhook quando não recebe 200 rápido. Sem a
 * checagem por `channelMessageId`, a mesma mensagem do cliente apareceria duas
 * vezes no ticket e o Agente responderia duas vezes.
 */
export const handleIncomingChannelMessage = async (
  incoming: IncomingMessage,
  whatsapp: Whatsapp
): Promise<void> => {
  const { companyId } = whatsapp;

  if (!incoming.channelMessageId || !incoming.from) {
    logger.warn({
      fn: "handleIncomingChannelMessage",
      whatsappId: whatsapp.id,
      companyId,
      msg: "Mensagem sem id ou remetente — ignorada"
    });
    return;
  }

  // Idempotência: o id do provedor é a chave. Se já existe, o webhook é
  // reentrega — sair aqui evita ticket duplicado e resposta em dobro do Agente.
  const jaExiste = await Message.findByPk(incoming.channelMessageId);

  if (jaExiste) {
    logger.info({
      fn: "handleIncomingChannelMessage",
      channelMessageId: incoming.channelMessageId,
      companyId,
      msg: "Webhook reentregue — mensagem já processada"
    });
    return;
  }

  const contact = await CreateOrUpdateContactService({
    // O canal oficial não entrega nome de perfil como o Baileys. O número
    // serve de nome inicial e é atualizado quando o atendente renomear.
    name: incoming.from,
    number: incoming.from,
    isGroup: false,
    companyId,
    whatsappId: whatsapp.id
  });

  const ticket = await FindOrCreateTicketService(
    contact,
    whatsapp.id,
    1,
    companyId
  );

  await CreateMessageService({
    messageData: {
      id: incoming.channelMessageId,
      ticketId: ticket.id,
      contactId: contact.id,
      body: incoming.body || "",
      fromMe: false,
      // Mensagem recebida nasce NÃO lida — é o que faz a contagem de
      // pendências e os alertas de espera funcionarem.
      read: false,
      mediaUrl: incoming.mediaUrl,
      mediaType: incoming.mediaType || "chat",
      ack: 0
    },
    companyId
  });

  await ticket.update({ lastMessage: incoming.body || "" });

  logger.info({
    fn: "handleIncomingChannelMessage",
    channelType: whatsapp.channelType,
    whatsappId: whatsapp.id,
    companyId,
    ticketId: ticket.id,
    msg: "Mensagem recebida por canal oficial"
  });
};
