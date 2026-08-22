import path from "path";

import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { transcribeAudioForCompany } from "../AgentService/transcriptionProvider";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import { addAgentMessageJob } from "../WbotServices/BullAgentService";
import { downloadChannelMedia } from "./downloadChannelMedia";
import { IncomingMessage } from "./types";

/**
 * Transcreve o áudio baixado para texto que o LLM consiga usar.
 *
 * O caminho inclui a subpasta da empresa porque é onde `downloadChannelMedia`
 * grava — mesmo detalhe que já causou bug no canal Secretária em 2026-06-28.
 *
 * Falha de transcrição NÃO impede o Agente de responder: ele recebe um texto
 * explicativo em vez de silêncio. Um cliente que manda áudio e não recebe nada
 * é pior que um cliente que recebe "não consegui ouvir seu áudio".
 */
const transcreverAudio = async (
  companyId: number,
  arquivoLocal: string | null,
  ticketId: number
): Promise<string> => {
  if (!arquivoLocal) {
    return "[mensagem de áudio — não foi possível baixar o arquivo]";
  }

  const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");
  const caminho = `${publicFolder}/company${companyId}/${arquivoLocal}`;

  const transcricao = await transcribeAudioForCompany(caminho, companyId).catch(
    (err: Error) => {
      logger.error({
        fn: "handleIncomingChannelMessage.transcreverAudio",
        companyId,
        ticketId,
        err: err.message,
        msg: "Transcrição de áudio falhou"
      });
      return null;
    }
  );

  return (
    transcricao ??
    "[mensagem de áudio — configure o provedor Whisper nas configurações do agente]"
  );
};

/**
 * Enfileira o job do Agente, se a conexão for canal do agente.
 *
 * AS CONDIÇÕES ESPELHAM O CAMINHO BAILEYS (`wbotMessageListener`, bloco do
 * canal agente): não ser grupo, a conexão ser `isAgentChannel`, e haver texto
 * ou áudio. Divergir aqui faria o Agente se comportar diferente conforme o
 * canal — exatamente o que a camada de adaptador existe para impedir.
 *
 * NÃO envia indicador de "digitando": canal oficial não tem esse recurso, e a
 * humanização anti-banimento (`humanTypingDelay`) existe para driblar detecção
 * de automação em canal NÃO-autorizado. Aqui o tráfego é legítimo.
 */
const acionarAgenteSePreciso = async (
  incoming: IncomingMessage,
  whatsapp: Whatsapp,
  ticket: { id: number },
  contact: { id: number; number: string },
  arquivoLocal: string | null
): Promise<void> => {
  const ehAudio = incoming.mediaType === "audio";

  // Grupo não entra: canal oficial não trata grupos, mas a condição fica
  // explícita para espelhar o Baileys e não depender dessa suposição.
  if (!whatsapp.isAgentChannel) return;
  if (!incoming.body && !ehAudio) return;

  let userMessage = incoming.body || "";

  if (ehAudio) {
    userMessage = await transcreverAudio(
      whatsapp.companyId,
      arquivoLocal,
      ticket.id
    );
  }

  await addAgentMessageJob({
    companyId: whatsapp.companyId,
    ticketId: ticket.id,
    contactId: contact.id,
    contactNumber: contact.number,
    userMessage,
    whatsappId: whatsapp.id,
    queueId: whatsapp.queues?.[0]?.id
  });
};

/**
 * Processa uma mensagem recebida por canal oficial.
 *
 * POR QUE NÃO REUSAR `handleMessage` DO LISTENER: aquele recebe
 * `proto.IWebMessageInfo` e extrai tudo dessa estrutura, dentro de um arquivo
 * de 4.343 linhas. Fabricar um objeto que finge ser Baileys é a opção A
 * rejeitada na diretiva (§3.1) — campo não preenchido viraria `undefined`
 * silencioso lá no meio.
 *
 * O que este handler REUSA são os serviços de negócio: contato, ticket,
 * mensagem, transcrição e a fila do Agente são exatamente os mesmos do caminho
 * Baileys. A duplicação é de orquestração, não de regra de negócio.
 *
 * IDEMPOTÊNCIA: a Meta reenvia o webhook quando não recebe 200 rápido. Sem a
 * checagem por `channelMessageId`, a mesma mensagem apareceria duas vezes no
 * ticket e o Agente responderia duas vezes ao cliente.
 *
 * ISOLAMENTO MULTI-TENANT (CLAUDE.md XV.3): o `companyId` sai SEMPRE da
 * conexão resolvida no servidor, nunca do payload — que, numa rota pública, é
 * controlado por quem chama.
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

  // Idempotência: o id do provedor é a chave. Se já existe, é reentrega.
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

  // A mídia é baixada AGORA porque a URL da Cloud API expira em ~5 minutos.
  // Buscar depois significaria anexo perdido — e, em áudio, o Agente sem o
  // que transcrever.
  const arquivoLocal = incoming.mediaUrl
    ? await downloadChannelMedia(incoming, whatsapp)
    : null;

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
      // Grava o arquivo LOCAL, não a referência do provedor: a referência
      // expira e deixaria o anexo quebrado no histórico.
      mediaUrl: arquivoLocal || undefined,
      mediaType: incoming.mediaType || "chat",
      ack: 0
    },
    companyId
  });

  await ticket.update({ lastMessage: incoming.body || "📎 Mídia" });

  logger.info({
    fn: "handleIncomingChannelMessage",
    channelType: whatsapp.channelType,
    whatsappId: whatsapp.id,
    companyId,
    ticketId: ticket.id,
    msg: "Mensagem recebida por canal oficial"
  });

  await acionarAgenteSePreciso(
    incoming,
    whatsapp,
    ticket,
    contact,
    arquivoLocal
  );
};
