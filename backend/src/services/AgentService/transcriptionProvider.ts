/**
 * transcriptionProvider — transcrição de áudio multi-provedor via Whisper.
 * Responsabilidade única: abstrair OpenAI e Groq para transcrição de áudio.
 */

import * as fs from "fs";
import { Configuration, OpenAIApi } from "openai";
import Setting from "../../models/Setting";
import GlobalSetting from "../../models/GlobalSetting";

const PROVIDER_BASE_PATHS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

export interface WhisperSettings {
  provider: string;
  model: string;
  apiKey: string;
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
