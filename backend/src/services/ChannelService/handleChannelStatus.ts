import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";

/**
 * Atualiza o "ack" (tiques de entrega/leitura) a partir do webhook de status.
 *
 * POR QUE EXISTE (item 5 da auditoria): o webhook do canal oficial recebe
 * eventos de status pela MESMA rota das mensagens. Antes eles eram descartados
 * corretamente (não viravam ticket fantasma), mas ninguém atualizava o `ack` —
 * então os tiques de "entregue" e "lido" simplesmente não funcionavam no canal
 * oficial, enquanto funcionam no Baileys.
 *
 * MAPEAMENTO DE ACK: o CRM usa a escala do WhatsApp/Baileys, e os provedores
 * usam nomes. A tradução precisa ser explícita, porque um número errado aqui
 * mostraria "lido" numa mensagem que nem saiu — pior que não mostrar nada.
 *
 *   0 = pendente   1 = enviado   2 = entregue   3 = lido   4 = reproduzido
 */

/** Escala de ack do CRM (mesma do Baileys). */
export const ACK = {
  PENDENTE: 0,
  ENVIADO: 1,
  ENTREGUE: 2,
  LIDO: 3,
  REPRODUZIDO: 4
} as const;

/** Status da Cloud API → ack do CRM. */
const ACK_META: Record<string, number> = {
  sent: ACK.ENVIADO,
  delivered: ACK.ENTREGUE,
  read: ACK.LIDO,
  // "failed" NÃO vira ack: a mensagem não avançou, regrediu. Tratado à parte.
  failed: ACK.PENDENTE
};

/** Status da Twilio → ack do CRM. */
const ACK_TWILIO: Record<string, number> = {
  queued: ACK.PENDENTE,
  sending: ACK.PENDENTE,
  sent: ACK.ENVIADO,
  delivered: ACK.ENTREGUE,
  read: ACK.LIDO,
  failed: ACK.PENDENTE,
  undelivered: ACK.PENDENTE
};

/** Status normalizado, independente de provedor. */
export interface StatusRecebido {
  channelMessageId: string;
  /** Status cru do provedor. */
  status: string;
  /** Motivo do erro, quando o provedor informa. */
  erro?: string;
}

/**
 * Extrai eventos de status de um payload da Cloud API.
 *
 * Os status chegam em `entry[].changes[].value.statuses[]`, na mesma rota das
 * mensagens — por isso o parser de mensagens precisa ignorá-los e este
 * precisa lê-los.
 */
export const parseStatusMeta = (payload: any): StatusRecebido[] => {
  const resultado: StatusRecebido[] = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of payload?.entry ?? []) {
    // eslint-disable-next-line no-restricted-syntax
    for (const change of entry?.changes ?? []) {
      // eslint-disable-next-line no-restricted-syntax
      for (const s of change?.value?.statuses ?? []) {
        resultado.push({
          channelMessageId: s?.id ?? "",
          status: s?.status ?? "",
          erro: s?.errors?.[0]?.title
        });
      }
    }
  }

  return resultado;
};

/** Extrai o status de um callback da Twilio. */
export const parseStatusTwilio = (body: any): StatusRecebido[] => {
  // A Twilio manda status no MESMO endpoint das mensagens; o que distingue é
  // ter MessageStatus e não ter Body.
  if (!body?.MessageSid || !body?.MessageStatus) return [];

  return [
    {
      channelMessageId: body.MessageSid,
      status: body.MessageStatus,
      erro: body.ErrorMessage || body.ErrorCode
    }
  ];
};

/**
 * Aplica um status recebido à mensagem correspondente.
 *
 * @param status - Status normalizado.
 * @param whatsapp - Conexão de origem (define o mapeamento e a empresa).
 *
 * @example
 * for (const s of parseStatusMeta(req.body)) await handleChannelStatus(s, whatsapp);
 */
export const handleChannelStatus = async (
  status: StatusRecebido,
  whatsapp: Whatsapp
): Promise<void> => {
  if (!status.channelMessageId || !status.status) return;

  const mapa = whatsapp.channelType === "twilio" ? ACK_TWILIO : ACK_META;
  const novoAck = mapa[status.status.toLowerCase()];

  // Status desconhecido: registra e sai. Inventar um ack seria pior que não
  // atualizar — mostraria estado errado ao atendente.
  if (novoAck === undefined) {
    logger.info({
      fn: "handleChannelStatus",
      companyId: whatsapp.companyId,
      status: status.status,
      msg: "Status de entrega desconhecido — ignorado"
    });
    return;
  }

  const mensagem = await Message.findByPk(status.channelMessageId);

  // Status de mensagem que não é nossa (ou já removida): normal, não é erro.
  if (!mensagem) return;

  // Falha de entrega é evento que o operador precisa ver: o cliente NÃO
  // recebeu, e sem log isso passa despercebido até alguém reclamar.
  const falhou = ["failed", "undelivered"].includes(
    status.status.toLowerCase()
  );

  if (falhou) {
    logger.warn({
      fn: "handleChannelStatus",
      companyId: whatsapp.companyId,
      ticketId: mensagem.ticketId,
      channelMessageId: status.channelMessageId,
      erro: status.erro,
      msg: "Provedor não conseguiu entregar a mensagem"
    });
  }

  // Nunca REGRIDE o ack: webhooks chegam fora de ordem, e um "sent" atrasado
  // não pode apagar um "read" que já chegou.
  if (mensagem.ack >= novoAck && !falhou) return;

  await mensagem.update({ ack: novoAck });

  // Atualiza a tela do atendente em tempo real, igual ao caminho Baileys.
  getIO()
    .to(mensagem.ticketId.toString())
    .emit(`company-${whatsapp.companyId}-appMessage`, {
      action: "update",
      message: mensagem
    });
};
