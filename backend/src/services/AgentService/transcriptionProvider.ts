/**
 * transcriptionProvider — transcrição de áudio multi-provedor via Whisper.
 * Responsabilidade única: abstrair OpenAI, Groq e Qwen para transcrição de áudio.
 */

import * as fs from "fs";
import { Configuration, OpenAIApi } from "openai";
import Setting from "../../models/Setting";
import GlobalSetting from "../../models/GlobalSetting";
import { PROVIDER_BASE_URLS } from "./providers/interfaces";

const PROVIDER_BASE_PATHS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

export interface WhisperSettings {
  provider: string;
  model: string;
  apiKey: string;
}

/** Detecta o mimetype de áudio a partir da extensão — usado no data URI do Qwen-ASR. */
function audioMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  return "audio/ogg";
}

/**
 * Transcreve via Qwen-ASR (DashScope). Diferente de OpenAI/Groq, o DashScope
 * NÃO expõe um endpoint multipart `/audio/transcriptions` — a transcrição é
 * feita chamando `/chat/completions` com o áudio embutido em base64 dentro
 * da mensagem, no formato `type: "input_audio"` (verificado na doc oficial
 * do Qwen-ASR em 2026-07-26). Por isso usa fetch nativo em vez do SDK openai,
 * que só fala o protocolo multipart do Whisper.
 *
 * @param filePath - Caminho do arquivo de áudio local
 * @param model - ID do modelo Qwen-ASR (ex: "qwen3-asr-flash")
 * @param apiKey - Chave de API do DashScope (região internacional)
 * @returns Texto transcrito
 * @throws Error se a API responder com status de erro
 */
async function transcribeWithQwenASR(
  filePath: string,
  model: string,
  apiKey: string
): Promise<string> {
  const audioBuffer = fs.readFileSync(filePath);
  const base64Audio = audioBuffer.toString("base64");
  const dataUri = `data:${audioMimeType(filePath)};base64,${base64Audio}`;

  const response = await fetch(`${PROVIDER_BASE_URLS.qwen}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: dataUri } }]
        }
      ]
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "<unreadable>");
    throw new Error(`Qwen-ASR HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Transcreve usando o provedor e modelo especificados.
 */
export async function transcribeWithProvider(
  filePath: string,
  provider: string,
  model: string,
  apiKey: string
): Promise<string> {
  if (provider === "qwen") {
    return transcribeWithQwenASR(filePath, model, apiKey);
  }

  const basePath = PROVIDER_BASE_PATHS[provider] ?? PROVIDER_BASE_PATHS.openai;
  const configuration = new Configuration({ apiKey, basePath });
  const openai = new OpenAIApi(configuration);
  const file = fs.createReadStream(filePath) as any;

  const response = await openai.createTranscription(
    file, model, undefined, undefined, undefined, "pt"
  );

  return response.data.text || "";
}

/**
 * Lê as configurações Whisper com prioridade em cascata:
 *   1. GlobalSettings (super admin, aplica a todas as empresas)
 *   2. Settings da empresa (fallback para retrocompatibilidade)
 *
 * Retorna null se não houver apiKey configurada em nenhum nível.
 *
 * @param companyId - ID da empresa (usado apenas no fallback)
 */
export async function getWhisperSettings(companyId: number): Promise<WhisperSettings | null> {
  // Prioridade 1: GlobalSettings (super admin configura uma vez para toda a plataforma)
  const globalRows = await GlobalSetting.findAll();
  const globalGet = (key: string) => globalRows.find((r: any) => r.key === key)?.value ?? "";

  const globalApiKey = globalGet("globalWhisperApiKey");
  if (globalApiKey) {
    return {
      provider: globalGet("globalWhisperProvider") || "openai",
      model: globalGet("globalWhisperModel") || "whisper-1",
      apiKey: globalApiKey,
    };
  }

  // Prioridade 2: Settings da empresa (retrocompatibilidade — empresas que configuraram antes da mudança)
  const settings = await Setting.findAll({ where: { companyId } });
  const companyGet = (key: string) => settings.find((s: any) => s.key === key)?.value ?? "";

  const companyApiKey = companyGet("agentWhisperApiKey");
  if (!companyApiKey) return null;

  return {
    provider: companyGet("agentWhisperProvider") || "openai",
    model: companyGet("agentWhisperModel") || "whisper-1",
    apiKey: companyApiKey,
  };
}

/**
 * Ponto de entrada de alto nível: lê settings da empresa e transcreve.
 * Retorna null se não há configuração Whisper válida.
 */
export async function transcribeAudioForCompany(
  filePath: string,
  companyId: number
): Promise<string | null> {
  const settings = await getWhisperSettings(companyId);
  if (!settings) return null;

  return transcribeWithProvider(filePath, settings.provider, settings.model, settings.apiKey);
}
