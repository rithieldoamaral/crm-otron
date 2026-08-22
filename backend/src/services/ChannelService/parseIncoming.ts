import { canonicalizePhone } from "../SecretaryService/phoneMatch";
import { IncomingMessage, MediaType } from "./types";

/**
 * Conversão do payload de cada provedor para o tipo neutro `IncomingMessage`.
 *
 * Esta é a fronteira onde o formato específico do provedor MORRE: daqui para
 * dentro, nada no sistema sabe se a mensagem veio da Meta ou da Twilio.
 *
 * TODO telefone sai daqui canonicalizado. Precedente do projeto: o bug do
 * `agentOwnerNumber` (2026-08-20) nasceu exatamente de deixar formato de
 * telefone atravessar uma fronteira sem normalizar — a mensagem não chegava e
 * um contato duplicado era criado, em silêncio.
 */

/** Mapeia o tipo de mídia da Meta para o nosso vocabulário. */
const TIPOS_META: Record<string, MediaType> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
  sticker: "sticker"
};

/**
 * Extrai as mensagens de um payload de webhook da Cloud API.
 *
 * O payload da Meta é aninhado (`entry[].changes[].value.messages[]`) e pode
 * trazer VÁRIAS mensagens de uma vez, ou nenhuma — eventos de status de
 * entrega chegam pela mesma rota e não são mensagens.
 *
 * @param payload - Corpo do webhook, já parseado.
 * @returns Lista de mensagens normalizadas; vazia se o evento não trouxer nenhuma.
 *
 * @example
 * const recebidas = parsePayloadMeta(req.body);
 */
export const parsePayloadMeta = (payload: any): IncomingMessage[] => {
  const resultado: IncomingMessage[] = [];

  const entries = payload?.entry ?? [];

  // eslint-disable-next-line no-restricted-syntax
  for (const entry of entries) {
    // eslint-disable-next-line no-restricted-syntax
    for (const change of entry?.changes ?? []) {
      const mensagens = change?.value?.messages ?? [];

      // eslint-disable-next-line no-restricted-syntax
      for (const m of mensagens) {
        const tipo = m?.type as string;

        // `text` é o caso comum; os demais tipos trazem o conteúdo num objeto
        // com o mesmo nome do tipo (`image: { id, caption }`).
        const conteudoMidia = TIPOS_META[tipo] ? m[tipo] : undefined;

        resultado.push({
          channelMessageId: m?.id ?? "",
          from: canonicalizePhone(m?.from),
          body: m?.text?.body ?? conteudoMidia?.caption ?? "",
          // A Meta NÃO envia URL: envia um id que precisa ser trocado por uma
          // URL temporária (~5 min). Quem baixa é o handler, não o parser.
          mediaUrl: conteudoMidia?.id,
          mediaType: TIPOS_META[tipo],
          fileName: conteudoMidia?.filename,
          // O timestamp vem em SEGUNDOS (unix), não milissegundos. Sem o *1000
          // toda mensagem cairia em 1970 e a janela de 24h daria sempre fechada.
          timestamp: m?.timestamp
            ? new Date(Number(m.timestamp) * 1000)
            : new Date(),
          raw: m
        });
      }
    }
  }

  return resultado;
};

/**
 * Converte o corpo de um webhook da Twilio.
 *
 * A Twilio envia UMA mensagem por requisição, em formato de formulário
 * (`application/x-www-form-urlencoded`), com campos planos.
 *
 * @param body - Corpo do formulário já parseado.
 * @returns Lista com no máximo uma mensagem, para manter a mesma forma da Meta.
 */
export const parsePayloadTwilio = (body: any): IncomingMessage[] => {
  if (!body?.MessageSid || !body?.From) return [];

  const totalMidia = Number(body.NumMedia ?? 0);
  const temMidia = totalMidia > 0;

  const contentType: string = body.MediaContentType0 ?? "";
  let mediaType: MediaType | undefined;

  if (temMidia) {
    if (contentType.startsWith("image/")) mediaType = "image";
    else if (contentType.startsWith("video/")) mediaType = "video";
    else if (contentType.startsWith("audio/")) mediaType = "audio";
    else mediaType = "document";
  }

  return [
    {
      channelMessageId: body.MessageSid,
      // A Twilio prefixa com "whatsapp:"; canonicalizePhone já descarta tudo
      // que não é dígito, então o prefixo some naturalmente.
      from: canonicalizePhone(body.From),
      body: body.Body ?? "",
      // Diferente da Meta, a Twilio JÁ entrega URL — mas protegida por Basic
      // Auth com as credenciais da conta.
      mediaUrl: temMidia ? body.MediaUrl0 : undefined,
      mediaType,
      timestamp: new Date(),
      raw: body
    }
  ];
};
