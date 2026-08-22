import crypto from "crypto";
import twilio from "twilio";

/**
 * Verificação de assinatura dos webhooks de canal.
 *
 * POR QUE ISTO É O ARQUIVO MAIS CRÍTICO DA FASE 3: a rota de webhook é
 * PÚBLICA por necessidade — a Meta e a Twilio precisam alcançá-la de fora, sem
 * JWT. A assinatura é a ÚNICA coisa que separa "mensagem real do cliente" de
 * "qualquer pessoa na internet injetando conversa no CRM de qualquer empresa".
 *
 * Sem esta verificação, um atacante criaria tickets, faria o Agente de IA
 * responder e consumiria a cota paga do cliente, tudo com um `curl`. Isto é
 * CLAUDE.md XV.1 aplicado ao caso mais literal possível: a rota não pode ser
 * protegida por estar escondida, porque ela não está escondida — o endereço é
 * dado ao provedor de propósito.
 *
 * COMPARAÇÃO EM TEMPO CONSTANTE: `timingSafeEqual`, nunca `===`. Comparação
 * comum sai no primeiro byte diferente, e a diferença de tempo entre "errou no
 * byte 1" e "errou no byte 30" vaza informação suficiente para forjar a
 * assinatura byte a byte.
 */

/**
 * Valida a assinatura de um webhook da Meta (Cloud API).
 *
 * A Meta assina o corpo BRUTO com HMAC-SHA256 usando o App Secret, e envia o
 * resultado no cabeçalho `X-Hub-Signature-256`, prefixado por "sha256=".
 *
 * @param rawBody - Corpo exatamente como chegou. Reserializar o JSON quebra a
 *   assinatura: espaçamento e ordem de chaves mudariam o hash.
 * @param assinatura - Conteúdo do cabeçalho `X-Hub-Signature-256`.
 * @param appSecret - App Secret do app da Meta.
 * @returns true somente se a assinatura conferir.
 *
 * @example
 * if (!verificarAssinaturaMeta(req.rawBody, req.header("X-Hub-Signature-256"), secret)) {
 *   return res.sendStatus(403);
 * }
 */
export const verificarAssinaturaMeta = (
  rawBody: Buffer | string | undefined,
  assinatura: string | undefined,
  appSecret: string | undefined
): boolean => {
  // Faltando qualquer peça, NÃO valida. Nunca "passa porque não deu para
  // conferir" — seria uma porta aberta acionável por omissão de cabeçalho.
  if (!rawBody || !assinatura || !appSecret) return false;

  if (!assinatura.startsWith("sha256=")) return false;

  const esperado = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const recebido = assinatura.slice("sha256=".length);

  // timingSafeEqual exige buffers do mesmo tamanho; tamanhos diferentes já
  // significam assinatura inválida.
  const bufEsperado = Buffer.from(esperado, "hex");
  const bufRecebido = Buffer.from(recebido, "hex");

  if (bufEsperado.length !== bufRecebido.length) return false;

  return crypto.timingSafeEqual(bufEsperado, bufRecebido);
};

/**
 * Valida a assinatura de um webhook da Twilio.
 *
 * A Twilio assina a URL completa somada aos parâmetros do formulário, com o
 * Auth Token. O algoritmo tem detalhes (ordenação de parâmetros, concatenação)
 * onde errar é fácil e o erro é silencioso — por isso usa-se `validateRequest`
 * do SDK oficial em vez de reimplementar.
 *
 * @param authToken - Auth Token da conta Twilio.
 * @param assinatura - Conteúdo do cabeçalho `X-Twilio-Signature`.
 * @param url - URL pública EXATA que a Twilio chamou, incluindo protocolo.
 * @param params - Corpo do formulário já parseado.
 * @returns true somente se a assinatura conferir.
 */
export const verificarAssinaturaTwilio = (
  authToken: string | undefined,
  assinatura: string | undefined,
  url: string,
  params: Record<string, unknown>
): boolean => {
  if (!authToken || !assinatura || !url) return false;

  return twilio.validateRequest(
    authToken,
    assinatura,
    url,
    (params || {}) as Record<string, string>
  );
};

/**
 * Compara o token do handshake de verificação da Meta.
 *
 * Ao cadastrar o webhook, a Meta faz um GET com `hub.verify_token` e espera de
 * volta o `hub.challenge`. Só devolvemos o desafio se o token conferir — do
 * contrário qualquer um cadastraria o nosso endpoint no app dele.
 *
 * Comparação em tempo constante pelo mesmo motivo da assinatura.
 */
export const conferirVerifyToken = (
  recebido: string | undefined,
  esperado: string | undefined
): boolean => {
  if (!recebido || !esperado) return false;

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};
