import axios from "axios";

import AppError from "../../../errors/AppError";
import Whatsapp from "../../../models/Whatsapp";
import { logger } from "../../../utils/logger";
import { getChannelConfig } from "../channelConfig";
import { ChannelAdapter, OutgoingMessage, SendResult } from "../types";

/**
 * Adaptador da WhatsApp Cloud API — Meta direto, sem intermediário.
 *
 * SEM SDK DE PROPÓSITO: o SDK oficial da Meta para Node (`whatsapp`) está
 * ARQUIVADO desde junho/2023, somente-leitura, sem manutenção. Depender de
 * biblioteca abandonada para o caminho crítico de entrega de mensagem seria
 * pior que falar HTTP direto. Usamos `axios`, que já é dependência do projeto.
 *
 * A Graph API é REST simples: um POST por mensagem. O ganho de um SDK aqui
 * seria pequeno mesmo se ele fosse mantido.
 */

/**
 * Versão da Graph API fixada explicitamente.
 *
 * A Meta mantém cada versão por cerca de 2 anos e muda comportamento entre
 * versões. Sem fixar, o endpoint "mais recente" mudaria sob nossos pés — a
 * mesma classe de problema que o lockfile resolve para dependências (VI.4).
 */
const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Timeout de envio. Sem teto, uma indisponibilidade da Meta trava o worker. */
const TIMEOUT_MS = 20000;

export class CloudApiAdapter implements ChannelAdapter {
  public readonly type = "cloud_api" as const;

  public readonly whatsappId: number;

  private readonly whatsapp: Whatsapp;

  constructor(whatsapp: Whatsapp) {
    this.whatsapp = whatsapp;
    this.whatsappId = whatsapp.id;
  }

  /**
   * A Cloud API exige E.164 sem `+` e sem sufixo de JID.
   *
   * Aceita o endereço no formato da Baileys (`5548...@s.whatsapp.net`) porque
   * é o que os pontos de chamada existentes produzem — normalizar aqui evita
   * obrigar cada um deles a saber de qual canal se trata.
   */
  private static formatarDestino(to: string): string {
    return to.replace(/@.*$/, "").replace(/\D/g, "");
  }

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const { phoneNumberId, accessToken } = getChannelConfig(this.whatsapp);

    if (!phoneNumberId || !accessToken) {
      throw new AppError("ERR_CHANNEL_NOT_CONFIGURED", 400);
    }

    try {
      const { data } = await axios.post(
        `${GRAPH_BASE}/${phoneNumberId}/messages`,
        { messaging_product: "whatsapp", ...payload },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: TIMEOUT_MS
        }
      );

      return { channelMessageId: data?.messages?.[0]?.id ?? "", raw: data };
    } catch (err: any) {
      const erroMeta = err?.response?.data?.error;

      // Loga o motivo REAL da Meta (código + mensagem), nunca o token.
      // Sem isto, "falha ao enviar" não diz se foi janela de 24h, número
      // inválido, cota estourada ou credencial revogada — diagnósticos com
      // ações completamente diferentes.
      logger.error({
        fn: "CloudApiAdapter.post",
        whatsappId: this.whatsappId,
        companyId: this.whatsapp.companyId,
        metaCode: erroMeta?.code,
        metaSubcode: erroMeta?.error_subcode,
        metaMessage: erroMeta?.message,
        msg: "Falha ao enviar pela Cloud API"
      });

      throw new AppError(
        `ERR_CLOUD_API_SEND: ${erroMeta?.message || err.message}`,
        502
      );
    }
  }

  async sendText(msg: OutgoingMessage): Promise<SendResult> {
    const to = CloudApiAdapter.formatarDestino(msg.to);

    // Fora da janela de 24h só template é aceito. Quem decide qual template
    // usar é `pickTemplate`; aqui só respeitamos o que veio decidido.
    if (msg.template) {
      return this.post({
        to,
        type: "template",
        template: {
          name: msg.template.name,
          language: { code: msg.template.language },
          components: msg.template.params.length
            ? [
                {
                  type: "body",
                  parameters: msg.template.params.map(text => ({
                    type: "text",
                    text
                  }))
                }
              ]
            : []
        }
      });
    }

    return this.post({
      to,
      type: "text",
      text: { preview_url: false, body: msg.body ?? "" }
    });
  }

  async sendMedia(msg: OutgoingMessage): Promise<SendResult> {
    if (!msg.mediaUrl) {
      // A Cloud API aceita URL pública ou id de mídia previamente enviada.
      // Caminho de arquivo local não serve — a Meta precisa alcançar o
      // arquivo. Falhar aqui é melhor que enviar uma referência inválida.
      throw new AppError("ERR_CLOUD_API_MEDIA_REQUIRES_URL", 400);
    }

    const tipo = msg.mediaType ?? "document";
    const conteudo: Record<string, unknown> = { link: msg.mediaUrl };

    if (msg.body) conteudo.caption = msg.body;
    if (tipo === "document" && msg.fileName) conteudo.filename = msg.fileName;

    return this.post({
      to: CloudApiAdapter.formatarDestino(msg.to),
      type: tipo,
      [tipo]: conteudo
    });
  }

  /**
   * Marca a mensagem como lida (tique azul).
   *
   * Note que NÃO existe `sendTyping`: a Cloud API não tem indicador de
   * digitação. A ausência é intencional e o contrato a torna explícita —
   * quem chama verifica antes de usar.
   */
  async markAsRead(channelMessageId: string): Promise<void> {
    await this.post({ status: "read", message_id: channelMessageId });
  }
}
