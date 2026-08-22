import AppError from "../../errors/AppError";
import {
  decryptField,
  encryptField,
  maskSecret
} from "../../helpers/encryptedField";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";

/**
 * Leitura e escrita da configuração de canal, sempre cifrada em repouso.
 *
 * Este módulo é a ÚNICA porta para o conteúdo de `Whatsapps.channelConfig`.
 * Concentrar aqui é o que torna verificável a regra XV.6: se nenhum outro
 * arquivo decifra o campo, nenhum outro arquivo pode vazá-lo por engano em log
 * ou em resposta de API.
 */

/** Credenciais da Cloud API (Meta direto). */
export interface CloudApiConfig {
  /** Id do número emissor, no painel da Meta. */
  phoneNumberId?: string;
  /** Id da conta comercial (WABA) — usado para listar templates. */
  wabaId?: string;
  /** Token permanente do System User. */
  accessToken?: string;
  /** App Secret — valida a assinatura do webhook (Fase 3). */
  appSecret?: string;
  /** Token de verificação do handshake do webhook (Fase 3). */
  verifyToken?: string;
}

/** Credenciais da Twilio. */
export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  /** Número emissor em E.164, ex. "+5548999999999". */
  fromNumber?: string;
}

export type ChannelConfig = CloudApiConfig & TwilioConfig;

/**
 * Lê e decifra a configuração de uma conexão.
 *
 * @param whatsapp - Conexão de origem.
 * @returns Objeto de configuração; vazio se a conexão não tiver nenhuma.
 * @throws {AppError} ERR_CHANNEL_CONFIG_CORRUPTED se o valor gravado não puder
 *   ser decifrado (chave trocada ou conteúdo adulterado).
 *
 * @example
 * const { accessToken } = getChannelConfig(whatsapp);
 */
export const getChannelConfig = (whatsapp: Whatsapp): ChannelConfig => {
  if (!whatsapp.channelConfig) return {};

  try {
    return JSON.parse(decryptField(whatsapp.channelConfig)) as ChannelConfig;
  } catch (err: any) {
    // Falha alta: devolver {} silenciosamente faria o adaptador reportar
    // "não configurado" quando o problema real é chave de criptografia
    // trocada — diagnósticos opostos, correções opostas.
    logger.error({
      fn: "getChannelConfig",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      // Mensagem do erro, NUNCA o conteúdo do campo.
      err: err.message,
      msg: "channelConfig ilegível — chave trocada ou valor adulterado"
    });

    throw new AppError("ERR_CHANNEL_CONFIG_CORRUPTED", 500);
  }
};

/**
 * Cifra e devolve o valor pronto para gravação.
 *
 * @param config - Objeto de configuração em texto puro.
 * @returns String cifrada para gravar em `Whatsapps.channelConfig`.
 *
 * @example
 * await whatsapp.update({ channelConfig: buildChannelConfig({ accessToken }) });
 */
export const buildChannelConfig = (config: ChannelConfig): string =>
  encryptField(JSON.stringify(config));

/**
 * Versão segura para o frontend: sem nenhum valor sensível.
 *
 * O frontend nunca recebe credencial (XV.6 e IV.3). Recebe só o suficiente
 * para o operador reconhecer o que está configurado e a UI decidir o que
 * mostrar.
 *
 * @example
 * res.json({ ...whatsapp.toJSON(), channelConfig: maskChannelConfig(whatsapp) })
 */
export const maskChannelConfig = (
  whatsapp: Whatsapp
): Record<string, string | boolean> => {
  let config: ChannelConfig;

  try {
    config = getChannelConfig(whatsapp);
  } catch {
    // Aqui o catch é intencional e NÃO silencioso: getChannelConfig já logou
    // o erro com contexto. Esta função serve à UI, que precisa renderizar
    // "credencial ilegível" em vez de derrubar a tela inteira.
    return { configIlegivel: true };
  }

  return {
    // Identificadores não são segredo — ajudam o operador a conferir se
    // conectou o número certo.
    phoneNumberId: config.phoneNumberId ?? "",
    wabaId: config.wabaId ?? "",
    accountSid: config.accountSid ?? "",
    fromNumber: config.fromNumber ?? "",
    // Segredos, só mascarados.
    accessToken: maskSecret(config.accessToken),
    authToken: maskSecret(config.authToken),
    appSecret: maskSecret(config.appSecret),
    // Deixa a UI dizer "configurado" sem inspecionar valor nenhum.
    hasCredentials: Boolean(config.accessToken || config.authToken)
  };
};
