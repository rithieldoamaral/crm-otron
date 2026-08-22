import axios from "axios";
import twilio from "twilio";

import AppError from "../../../errors/AppError";
import Whatsapp from "../../../models/Whatsapp";
import WhatsappTemplate from "../../../models/WhatsappTemplate";
import { logger } from "../../../utils/logger";
import { getChannelConfig } from "../channelConfig";

/**
 * Sincroniza os templates aprovados do provedor para a tabela local.
 *
 * O CRM NÃO cria nem submete template (decisão registrada na diretiva): a
 * aprovação acontece no painel da Meta, que é onde ela sempre aconteceria de
 * qualquer forma. Aqui só espelhamos o que já existe, para que um envio
 * proativo não dependa de chamada externa para saber se pode acontecer.
 */

const GRAPH_VERSION = "v21.0";

/**
 * Conta os placeholders `{{1}}`, `{{2}}` de um corpo de template.
 *
 * O provedor informa os componentes mas nem sempre a contagem direta. Contar
 * placeholders DISTINTOS (e não ocorrências) importa porque `{{1}}` pode
 * aparecer duas vezes no mesmo texto e ainda ser um único parâmetro.
 */
export const contarVariaveis = (corpo: string | undefined): number => {
  if (!corpo) return 0;

  const encontrados = corpo.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const distintos = new Set(encontrados.map(m => m.replace(/\D/g, "")));

  return distintos.size;
};

/** Grava/atualiza um template espelhado, sem duplicar. */
const gravar = async (
  whatsapp: Whatsapp,
  dados: {
    name: string;
    language: string;
    category?: string;
    status: string;
    bodyText?: string;
  }
): Promise<void> => {
  const [registro, criado] = await WhatsappTemplate.findOrCreate({
    where: {
      whatsappId: whatsapp.id,
      name: dados.name,
      language: dados.language
    },
    defaults: {
      ...dados,
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      variableCount: contarVariaveis(dados.bodyText),
      syncedAt: new Date()
    } as any
  });

  if (!criado) {
    // Já existia: atualiza, porque status muda (PENDING vira APPROVED ou
    // REJECTED) e o corpo pode ter sido editado no painel do provedor.
    await registro.update({
      ...dados,
      variableCount: contarVariaveis(dados.bodyText),
      syncedAt: new Date()
    });
  }
};

/** Busca os templates na Graph API da Meta. */
const sincronizarMeta = async (whatsapp: Whatsapp): Promise<number> => {
  const { wabaId, accessToken } = getChannelConfig(whatsapp);

  if (!wabaId || !accessToken) {
    throw new AppError("ERR_CHANNEL_NOT_CONFIGURED", 400);
  }

  const { data } = await axios.get(
    `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { limit: 200 },
      timeout: 20000
    }
  );

  const templates = data?.data ?? [];

  // eslint-disable-next-line no-restricted-syntax
  for (const t of templates) {
    const corpo = (t.components ?? []).find(
      (c: any) => c.type === "BODY"
    )?.text;

    // eslint-disable-next-line no-await-in-loop
    await gravar(whatsapp, {
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      bodyText: corpo
    });
  }

  return templates.length;
};

/** Busca os templates (Content API) na Twilio. */
const sincronizarTwilio = async (whatsapp: Whatsapp): Promise<number> => {
  const { accountSid, authToken } = getChannelConfig(whatsapp);

  if (!accountSid || !authToken) {
    throw new AppError("ERR_CHANNEL_NOT_CONFIGURED", 400);
  }

  const conteudos = await twilio(
    accountSid,
    authToken
  ).content.v1.contents.list({ limit: 200 });

  // eslint-disable-next-line no-restricted-syntax
  for (const c of conteudos as any[]) {
    const corpo =
      c?.types?.["twilio/text"]?.body ?? c?.types?.["twilio/media"]?.body ?? "";

    // Na Twilio o identificador de envio é o ContentSid, não o nome amigável
    // — é ele que vai no `contentSid` do envio, então é ele que guardamos.
    // eslint-disable-next-line no-await-in-loop
    await gravar(whatsapp, {
      name: c.sid,
      language: c.language ?? "pt_BR",
      category: "UTILITY",
      // A Content API não expõe status de aprovação da mesma forma; um
      // conteúdo listado é utilizável. Marcamos APPROVED para que a escolha
      // de template funcione igual nos dois provedores.
      status: "APPROVED",
      bodyText: corpo
    });
  }

  return (conteudos as any[]).length;
};

/**
 * Sincroniza os templates de uma conexão oficial.
 *
 * @param whatsapp - Conexão de canal oficial.
 * @returns Quantidade de templates espelhados.
 * @throws {AppError} Se a conexão não for oficial ou não estiver configurada.
 *
 * @example
 * const total = await syncTemplates(whatsapp);
 */
export const syncTemplates = async (whatsapp: Whatsapp): Promise<number> => {
  try {
    const total =
      whatsapp.channelType === "twilio"
        ? await sincronizarTwilio(whatsapp)
        : await sincronizarMeta(whatsapp);

    logger.info({
      fn: "syncTemplates",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      channelType: whatsapp.channelType,
      total,
      msg: "Templates sincronizados"
    });

    return total;
  } catch (err: any) {
    // Loga o motivo real do provedor; jamais o token.
    logger.error({
      fn: "syncTemplates",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      err: err?.response?.data?.error?.message || err.message,
      msg: "Falha ao sincronizar templates"
    });

    throw new AppError("ERR_TEMPLATE_SYNC_FAILED", 502);
  }
};
