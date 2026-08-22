import twilio from "twilio";

import AppError from "../../../errors/AppError";
import Whatsapp from "../../../models/Whatsapp";
import { logger } from "../../../utils/logger";
import { getChannelConfig } from "../channelConfig";
import { ChannelAdapter, OutgoingMessage, SendResult } from "../types";

/**
 * Adaptador da Twilio — canal oficial da Meta, intermediado.
 *
 * POR QUE SDK AQUI E NÃO NA CLOUD API: o SDK da Twilio é mantido e maduro, ao
 * contrário do da Meta (arquivado em 2023). Além do envio, ele traz
 * `validateRequest`, que valida a assinatura do webhook — implementar essa
 * verificação à mão é exatamente o tipo de código de segurança onde errar é
 * fácil e o erro é silencioso.
 *
 * A Twilio cobra por mensagem ALÉM da tarifa da Meta. Isso é decisão comercial
 * registrada na diretiva, não afeta este adaptador.
 */
export class TwilioAdapter implements ChannelAdapter {
  public readonly type = "twilio" as const;

  public readonly whatsappId: number;

  private readonly whatsapp: Whatsapp;

  constructor(whatsapp: Whatsapp) {
    this.whatsapp = whatsapp;
    this.whatsappId = whatsapp.id;
  }

  /**
   * A Twilio exige o prefixo `whatsapp:` e E.164 COM `+`.
   *
   * Aceita entrada em formato de JID da Baileys pelo mesmo motivo do
   * CloudApiAdapter: os pontos de chamada existentes produzem JID, e a
   * conversão é responsabilidade do adaptador, não de quem chama.
   */
  private static formatarDestino(to: string): string {
    if (to.startsWith("whatsapp:")) return to;

    return `whatsapp:+${to.replace(/@.*$/, "").replace(/\D/g, "")}`;
  }

  private cliente() {
    const { accountSid, authToken } = getChannelConfig(this.whatsapp);

    if (!accountSid || !authToken) {
      throw new AppError("ERR_CHANNEL_NOT_CONFIGURED", 400);
    }

    return twilio(accountSid, authToken);
  }

  private async enviar(payload: Record<string, unknown>): Promise<SendResult> {
    const { fromNumber } = getChannelConfig(this.whatsapp);

    if (!fromNumber) {
      throw new AppError("ERR_CHANNEL_NOT_CONFIGURED", 400);
    }

    try {
      const enviada = await this.cliente().messages.create({
        from: TwilioAdapter.formatarDestino(fromNumber),
        ...payload
      } as any);

      return { channelMessageId: enviada.sid, raw: enviada };
    } catch (err: any) {
      // Código e mensagem da Twilio, jamais o Auth Token.
      logger.error({
        fn: "TwilioAdapter.enviar",
        whatsappId: this.whatsappId,
        companyId: this.whatsapp.companyId,
        twilioCode: err?.code,
        twilioStatus: err?.status,
        twilioMessage: err?.message,
        msg: "Falha ao enviar pela Twilio"
      });

      throw new AppError(
        `ERR_TWILIO_SEND: ${err?.message || "desconhecido"}`,
        502
      );
    }
  }

  async sendText(msg: OutgoingMessage): Promise<SendResult> {
    const to = TwilioAdapter.formatarDestino(msg.to);

    // Na Twilio o template aprovado é referenciado por ContentSid. Quando o
    // template vem com parâmetros, eles seguem como variáveis nomeadas por
    // posição ("1", "2", ...), que é o formato que a Twilio espera.
    if (msg.template) {
      return this.enviar({
        to,
        contentSid: msg.template.name,
        contentVariables: JSON.stringify(
          Object.fromEntries(
            msg.template.params.map((valor, i) => [String(i + 1), valor])
          )
        )
      });
    }

    return this.enviar({ to, body: msg.body ?? "" });
  }

  async sendMedia(msg: OutgoingMessage): Promise<SendResult> {
    if (!msg.mediaUrl) {
      // Como na Cloud API: a Twilio precisa BUSCAR o arquivo, então caminho
      // local no nosso disco não serve.
      throw new AppError("ERR_TWILIO_MEDIA_REQUIRES_URL", 400);
    }

    return this.enviar({
      to: TwilioAdapter.formatarDestino(msg.to),
      body: msg.body ?? "",
      mediaUrl: [msg.mediaUrl]
    });
  }

  // Sem sendTyping e sem markAsRead: a Twilio não expõe indicador de digitação
  // nem confirmação de leitura para WhatsApp. A ausência é declarada pelo
  // contrato, e quem chama verifica antes de usar.
}
