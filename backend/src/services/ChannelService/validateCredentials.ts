import axios from "axios";
import twilio from "twilio";

import { ChannelConfig } from "./channelConfig";
import { ChannelType } from "./types";

/**
 * Valida credenciais de canal contra a API REAL do provedor.
 *
 * POR QUE VALIDAR DE VERDADE, E NÃO SÓ CONFERIR FORMATO: credencial
 * sintaticamente perfeita falha por motivos que só a API sabe — token sem a
 * permissão necessária, número não registrado, WABA suspensa, conta Twilio sem
 * saldo. Descobrir isso no assistente é infinitamente melhor que descobrir
 * quando o primeiro cliente real escrever e ninguém responder.
 *
 * A MENSAGEM DE ERRO É O PRODUTO AQUI. "Erro ao validar" não ajuda ninguém —
 * o assistente é feito para quem não é técnico, e a diferença entre "este token
 * não tem a permissão whatsapp_business_messaging" e "erro" é a diferença entre
 * o usuário resolver sozinho ou desistir.
 */

export interface ResultadoValidacao {
  valido: boolean;
  /** Mensagem em português, escrita para quem não é técnico. */
  mensagem: string;
  /** Dados confirmados pelo provedor, para o assistente exibir. */
  detalhes?: Record<string, string>;
}

/** Traduz erro da Meta para linguagem de dono de negócio. */
const traduzirErroMeta = (err: any): string => {
  const erro = err?.response?.data?.error;
  const codigo = erro?.code;

  // Códigos da Graph API mapeados para a ação que o usuário precisa tomar.
  if (codigo === 190) {
    return "O token de acesso é inválido ou expirou. Gere um novo token permanente no painel da Meta.";
  }

  if (codigo === 200 || codigo === 10) {
    return "O token não tem as permissões necessárias. Ele precisa de whatsapp_business_messaging e whatsapp_business_management.";
  }

  if (codigo === 100) {
    return "O ID do número não foi encontrado. Confira se copiou o 'Phone number ID' correto no painel da Meta.";
  }

  if (err?.code === "ECONNABORTED") {
    return "A Meta demorou demais para responder. Tente novamente em alguns instantes.";
  }

  return erro?.message
    ? `A Meta recusou: ${erro.message}`
    : "Não foi possível falar com a Meta. Verifique sua conexão e tente novamente.";
};

/** Valida credenciais da Cloud API consultando o próprio número. */
const validarCloudApi = async (
  config: ChannelConfig
): Promise<ResultadoValidacao> => {
  const { phoneNumberId, accessToken } = config;

  if (!phoneNumberId || !accessToken) {
    return {
      valido: false,
      mensagem: "Preencha o ID do número e o token de acesso."
    };
  }

  try {
    // Consulta o próprio número: é a chamada mais barata que prova, de uma vez,
    // que o token é válido, tem permissão e enxerga aquele número.
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: "display_phone_number,verified_name,quality_rating" },
        timeout: 15000
      }
    );

    return {
      valido: true,
      mensagem: "Conexão validada com a Meta.",
      detalhes: {
        numero: data?.display_phone_number ?? "",
        nomeExibido: data?.verified_name ?? "",
        qualidade: data?.quality_rating ?? ""
      }
    };
  } catch (err: any) {
    return { valido: false, mensagem: traduzirErroMeta(err) };
  }
};

/** Valida credenciais da Twilio consultando a conta. */
const validarTwilio = async (
  config: ChannelConfig
): Promise<ResultadoValidacao> => {
  const { accountSid, authToken, fromNumber } = config;

  if (!accountSid || !authToken) {
    return {
      valido: false,
      mensagem: "Preencha o Account SID e o Auth Token da Twilio."
    };
  }

  try {
    const conta = await twilio(accountSid, authToken)
      .api.v2010.accounts(accountSid)
      .fetch();

    if (conta.status !== "active") {
      return {
        valido: false,
        mensagem: `A conta Twilio está com status "${conta.status}". Ative a conta antes de continuar.`
      };
    }

    return {
      valido: true,
      mensagem: "Conexão validada com a Twilio.",
      detalhes: {
        conta: conta.friendlyName ?? "",
        numero: fromNumber ?? ""
      }
    };
  } catch (err: any) {
    // 20003 é o código de autenticação recusada da Twilio.
    if (err?.status === 401 || err?.code === 20003) {
      return {
        valido: false,
        mensagem:
          "Account SID ou Auth Token incorretos. Copie os dois do painel da Twilio."
      };
    }

    return {
      valido: false,
      mensagem: err?.message
        ? `A Twilio recusou: ${err.message}`
        : "Não foi possível falar com a Twilio."
    };
  }
};

/**
 * Valida as credenciais de um canal oficial.
 *
 * @param channelType - Tipo do canal a validar.
 * @param config - Credenciais em texto puro (ainda não cifradas).
 * @returns Resultado com mensagem legível para quem não é técnico.
 *
 * @example
 * const r = await validateCredentials("cloud_api", { phoneNumberId, accessToken });
 * if (!r.valido) return res.status(400).json({ error: r.mensagem });
 */
export const validateCredentials = async (
  channelType: ChannelType,
  config: ChannelConfig
): Promise<ResultadoValidacao> => {
  if (channelType === "twilio") return validarTwilio(config);

  if (channelType === "cloud_api") return validarCloudApi(config);

  return {
    valido: false,
    mensagem: "Este tipo de canal não precisa de credenciais."
  };
};
