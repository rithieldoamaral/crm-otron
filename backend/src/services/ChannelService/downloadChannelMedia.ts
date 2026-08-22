import axios from "axios";
import fs from "fs";
import path from "path";

import { sanitizeFilename } from "../../helpers/SanitizeFilename";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { getChannelConfig } from "./channelConfig";
import { IncomingMessage } from "./types";

/**
 * Baixa a mídia recebida por canal oficial e grava no disco.
 *
 * POR QUE BAIXAR AGORA, NO WEBHOOK: a URL de mídia da Cloud API expira em
 * ~5 MINUTOS. Guardar a referência para buscar depois significa anexo perdido —
 * e, no caso de áudio, o Agente sem o que transcrever, respondendo
 * "[erro ao processar]" a um cliente que mandou um áudio perfeitamente válido.
 *
 * DIFERENÇA ENTRE OS PROVEDORES:
 * - Cloud API: o webhook traz um ID. É preciso trocar o id por uma URL
 *   temporária e só então baixar — DUAS chamadas, ambas com o token.
 * - Twilio: o webhook já traz a URL final, protegida por autenticação básica
 *   com as credenciais da conta — UMA chamada.
 *
 * O arquivo vai para `public/company{companyId}/`, a mesma convenção do
 * caminho Baileys, para que o frontend e a transcrição de áudio encontrem a
 * mídia no lugar de sempre.
 */

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 30000;

/** Extensão a partir do mime-type. */
const extensaoDe = (mimeType: string | undefined): string => {
  if (!mimeType) return "bin";

  const mapa: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "application/pdf": "pdf"
  };

  const limpo = mimeType.split(";")[0].trim().toLowerCase();

  // Sem entrada no mapa, usa o subtipo: "application/zip" vira "zip".
  return mapa[limpo] || limpo.split("/")[1] || "bin";
};

/**
 * Monta um nome de arquivo seguro e único.
 *
 * SEGURANÇA (CLAUDE.md XV.4): `fileName` chega do provedor, que recebeu do
 * CLIENTE — é entrada hostil. Sem `sanitizeFilename`, um nome com `../../`
 * gravaria fora da pasta da empresa. O timestamp na frente garante unicidade
 * sem depender do nome enviado.
 */
const montarNome = (
  incoming: IncomingMessage,
  mimeType: string | undefined
): string => {
  const extensao = extensaoDe(mimeType);
  const base = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!incoming.fileName) return `${base}.${extensao}`;

  const seguro = sanitizeFilename(incoming.fileName);
  // Mantém só o miolo do nome original, já higienizado, e força a extensão
  // derivada do mime-type — não a que veio no nome.
  const semExtensao = seguro.replace(/\.[^.]+$/, "");

  return `${base}_${semExtensao}.${extensao}`;
};

/** Garante a pasta da empresa. */
const garantirPasta = (companyId: number): string => {
  const pasta = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "public",
    `company${companyId}`
  );

  if (!fs.existsSync(pasta)) {
    fs.mkdirSync(pasta, { recursive: true });
  }

  return pasta;
};

/** Cloud API: id → URL temporária → binário. */
const baixarDaMeta = async (
  incoming: IncomingMessage,
  whatsapp: Whatsapp
): Promise<{ buffer: Buffer; mimeType?: string }> => {
  const { accessToken } = getChannelConfig(whatsapp);
  const cabecalho = { Authorization: `Bearer ${accessToken}` };

  // 1ª chamada: troca o id pelos metadados, que trazem a URL temporária.
  const { data: meta } = await axios.get(
    `https://graph.facebook.com/${GRAPH_VERSION}/${incoming.mediaUrl}`,
    { headers: cabecalho, timeout: TIMEOUT_MS }
  );

  // 2ª chamada: a URL da Meta TAMBÉM exige o Bearer. Sem ele, 401 — e é um
  // erro fácil de cometer, porque a URL parece pública.
  const { data: binario } = await axios.get(meta.url, {
    headers: cabecalho,
    responseType: "arraybuffer",
    timeout: TIMEOUT_MS
  });

  return { buffer: Buffer.from(binario), mimeType: meta.mime_type };
};

/** Twilio: a URL já é final, protegida por autenticação básica. */
const baixarDaTwilio = async (
  incoming: IncomingMessage,
  whatsapp: Whatsapp
): Promise<{ buffer: Buffer; mimeType?: string }> => {
  const { accountSid, authToken } = getChannelConfig(whatsapp);

  const resposta = await axios.get(incoming.mediaUrl as string, {
    auth: { username: accountSid as string, password: authToken as string },
    responseType: "arraybuffer",
    timeout: TIMEOUT_MS
  });

  return {
    buffer: Buffer.from(resposta.data),
    // O tipo do axios permite número aqui; content-type é sempre texto, mas
    // a conversão explícita evita depender dessa suposição.
    mimeType: resposta.headers?.["content-type"]?.toString()
  };
};

/**
 * Baixa a mídia e devolve o nome do arquivo gravado.
 *
 * @param incoming - Mensagem recebida, já normalizada.
 * @param whatsapp - Conexão de origem.
 * @returns Nome do arquivo (relativo à pasta da empresa), ou null se falhar.
 *
 * @example
 * const arquivo = await downloadChannelMedia(incoming, whatsapp);
 * if (arquivo) messageData.mediaUrl = arquivo;
 */
export const downloadChannelMedia = async (
  incoming: IncomingMessage,
  whatsapp: Whatsapp
): Promise<string | null> => {
  if (!incoming.mediaUrl) return null;

  try {
    const { buffer, mimeType } =
      whatsapp.channelType === "twilio"
        ? await baixarDaTwilio(incoming, whatsapp)
        : await baixarDaMeta(incoming, whatsapp);

    const nome = montarNome(incoming, mimeType);
    const pasta = garantirPasta(whatsapp.companyId);

    fs.writeFileSync(path.join(pasta, nome), buffer);

    logger.info({
      fn: "downloadChannelMedia",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      arquivo: nome,
      bytes: buffer.length,
      msg: "Mídia recebida gravada"
    });

    return nome;
  } catch (err: any) {
    // NÃO re-lança: perder a mídia é ruim, mas perder a MENSAGEM inteira por
    // causa dela é pior. A mensagem entra sem anexo e o log registra o motivo
    // — catch silencioso é proibido (CLAUDE.md II.5).
    logger.error({
      fn: "downloadChannelMedia",
      whatsappId: whatsapp.id,
      companyId: whatsapp.companyId,
      channelType: whatsapp.channelType,
      err: err?.response?.status ? `HTTP ${err.response.status}` : err.message,
      msg: "Falha ao baixar mídia recebida"
    });

    return null;
  }
};
