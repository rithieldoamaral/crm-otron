/**
 * Tipos neutros da camada de canal (directives/canal_oficial_whatsapp.md §3.2).
 *
 * REGRA CENTRAL: nada aqui pode importar tipo de biblioteca de provedor. Nem
 * `WASocket`/`proto` da Baileys, nem tipo do SDK da Twilio, nem shape da Graph
 * API. É justamente esse isolamento que permite ao Agente, à Secretária e aos
 * serviços de ticket funcionarem sem saber qual canal está por trás.
 *
 * Se um dia um campo específico de provedor precisar atravessar esta fronteira,
 * ele vai em `raw` — nunca como campo tipado, que obrigaria todo mundo a
 * conhecer o provedor.
 */

/** Tipos de canal suportados. Espelha a coluna `Whatsapps.channelType`. */
export type ChannelType = "baileys" | "cloud_api" | "twilio";

/** Os canais oficiais da Meta — os que têm janela de 24h e exigem template. */
export const CANAIS_OFICIAIS: ChannelType[] = ["cloud_api", "twilio"];

/**
 * Um canal é oficial quando passa pela infraestrutura autorizada da Meta.
 *
 * Usado para decidir o que NÃO fazer: não simular digitação humana, não
 * enviar livremente fora da janela de 24h, não abrir sessão/QR.
 */
export const isCanalOficial = (tipo: ChannelType | string): boolean =>
  CANAIS_OFICIAIS.includes(tipo as ChannelType);

/** Tipos de mídia que a camada de canal sabe transportar. */
export type MediaType = "image" | "video" | "audio" | "document" | "sticker";

/** Mensagem a enviar, independente de canal. */
export interface OutgoingMessage {
  /**
   * Telefone de destino, já canonicalizado (`canonicalizePhone`).
   *
   * Cada provedor exige um formato diferente (JID com sufixo na Baileys,
   * E.164 na Cloud API, prefixo `whatsapp:` na Twilio). A conversão para o
   * formato do provedor é responsabilidade do ADAPTADOR, não de quem chama.
   */
  to: string;
  body?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  /** Caminho local do arquivo, quando a mídia ainda não tem URL pública. */
  mediaPath?: string;
  fileName?: string;
  /** Id da mensagem citada, no formato do próprio canal. */
  quotedChannelMessageId?: string;
  /**
   * Template aprovado, obrigatório fora da janela de 24h nos canais oficiais.
   * Ignorado pelo adaptador da Baileys, que não tem esse conceito.
   */
  template?: {
    name: string;
    language: string;
    params: string[];
  };
}

/** Mensagem recebida, normalizada a partir do payload do provedor. */
export interface IncomingMessage {
  /** Id da mensagem no provedor. Chave de idempotência do webhook. */
  channelMessageId: string;
  /** Remetente já canonicalizado. */
  from: string;
  body?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  fileName?: string;
  timestamp: Date;
  /** Payload original, preservado para auditoria e diagnóstico. */
  raw: unknown;
}

/** Resultado de um envio, no mínimo comum a todos os canais. */
export interface SendResult {
  channelMessageId: string;
  /** Objeto original do provedor — quem precisa de detalhe específico usa isto. */
  raw?: unknown;
}

/**
 * Contrato que todo canal implementa.
 *
 * `markAsRead` e `sendTyping` são OPCIONAIS de propósito: os canais oficiais
 * não têm indicador de digitação, e toda a humanização anti-banimento
 * (`humanTypingDelay`) existe para driblar detecção de automação em canal
 * NÃO-autorizado. Em canal oficial o tráfego é legítimo e o atraso artificial
 * só piora a experiência do cliente.
 *
 * Quem chama deve verificar a existência do método antes de usar, em vez de
 * assumir que todo canal sabe fazer tudo.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  /** Id da conexão (`Whatsapps.id`) que este adaptador representa. */
  readonly whatsappId: number;

  sendText(msg: OutgoingMessage): Promise<SendResult>;
  sendMedia(msg: OutgoingMessage): Promise<SendResult>;

  markAsRead?(channelMessageId: string, to: string): Promise<void>;
  sendTyping?(to: string, ligado: boolean): Promise<void>;
}
