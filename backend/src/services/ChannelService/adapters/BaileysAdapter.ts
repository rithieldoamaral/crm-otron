import { getWbot } from "../../../libs/wbot";
import { ChannelAdapter, OutgoingMessage, SendResult } from "../types";

/**
 * Adaptador do canal Baileys — embrulha o comportamento que JÁ EXISTE.
 *
 * REGRA DESTA CLASSE: não introduzir comportamento novo. Ela existe para dar
 * ao Baileys a mesma interface dos canais oficiais, de forma que o resto do
 * sistema pare de falar com o socket diretamente. Qualquer melhoria de
 * comportamento aqui seria mudança disfarçada de refatoração — e este é o
 * caminho que já está em produção (directives/canal_oficial_whatsapp.md §6,
 * critério de sucesso da Fase 1: "a suíte inteira continua verde e o
 * comportamento do Baileys é idêntico").
 *
 * O endereço de destino chega no formato que a Baileys espera (JID, com
 * sufixo `@s.whatsapp.net` ou `@g.us`), montado por `buildContactAddress`.
 * Este adaptador NÃO reformata — só repassa. Reformatar aqui divergiria do
 * que os 19 pontos de chamada existentes fazem hoje.
 */
export class BaileysAdapter implements ChannelAdapter {
  public readonly type = "baileys" as const;

  public readonly whatsappId: number;

  constructor(whatsappId: number) {
    this.whatsappId = whatsappId;
  }

  /**
   * A sessão é resolvida a cada chamada, e não guardada no construtor, porque
   * o socket é recriado em reconexão. Guardar uma referência antiga enviaria
   * por um socket morto depois de qualquer queda de conexão.
   */
  private socket(): any {
    return getWbot(this.whatsappId);
  }

  async sendText(msg: OutgoingMessage): Promise<SendResult> {
    const enviada = await this.socket().sendMessage(msg.to, {
      text: msg.body ?? ""
    });

    return { channelMessageId: enviada?.key?.id ?? "", raw: enviada };
  }

  /**
   * Envio de mídia mínimo, para o contrato ficar completo.
   *
   * O caminho rico de mídia (conversão de áudio, sticker, thumbnail, legenda
   * separada) continua em `SendWhatsAppMedia`, que tem centenas de linhas de
   * tratamento por tipo de arquivo. Duplicar aquilo aqui seria reescrever
   * lógica testada em produção — o oposto do objetivo desta fase.
   */
  async sendMedia(msg: OutgoingMessage): Promise<SendResult> {
    const conteudo: Record<string, unknown> = {};
    const origem = msg.mediaUrl
      ? { url: msg.mediaUrl }
      : { url: msg.mediaPath as string };

    if (msg.mediaType === "image") conteudo.image = origem;
    else if (msg.mediaType === "video") conteudo.video = origem;
    else if (msg.mediaType === "audio") conteudo.audio = origem;
    else {
      conteudo.document = origem;
      conteudo.fileName = msg.fileName;
    }

    if (msg.body) conteudo.caption = msg.body;

    const enviada = await this.socket().sendMessage(msg.to, conteudo);

    return { channelMessageId: enviada?.key?.id ?? "", raw: enviada };
  }

  /**
   * Indicador de "digitando".
   *
   * Só existe neste adaptador. É peça da mitigação anti-banimento de
   * 2026-07-26: sem renovar a presença, uma espera longa faria a mensagem
   * surgir do nada, padrão MAIS suspeito que responder rápido demais.
   */
  async sendTyping(to: string, ligado: boolean): Promise<void> {
    await this.socket().sendPresenceUpdate(ligado ? "composing" : "paused", to);
  }
}
