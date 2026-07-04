/**
 * audioTranscriber — transcreve mensagens de voz via OpenAI Whisper.
 * Responsabilidade única: converter arquivo de áudio em texto.
 */

import * as fs from "fs";
import { Configuration, OpenAIApi } from "openai";
import Setting from "../../models/Setting";

/**
 * Transcreve um arquivo de áudio usando OpenAI Whisper.
 * @param filePath Caminho absoluto do arquivo de áudio (ogg, mp4, etc.)
 * @param apiKey   Chave de API do OpenAI
 * @returns Texto transcrito em português, ou string vazia
 */
export async function transcribeAudio(filePath: string, apiKey: string): Promise<string> {
  const configuration = new Configuration({ apiKey });
  const openai = new OpenAIApi(configuration);
  const file = fs.createReadStream(filePath) as any;

  const response = await openai.createTranscription(
    file,
    "whisper-1",
    undefined,
    undefined,
    undefined,
    "pt"
  );

  return response.data.text || "";
}

/**
 * Busca a chave do Whisper configurada para a empresa.
 * @param companyId ID da empresa
 * @returns API key ou null se não configurada
 */
export async function getWhisperApiKey(companyId: number): Promise<string | null> {
  const setting = await Setting.findOne({
    where: { companyId, key: "agentWhisperApiKey" },
  });
  return setting?.value || null;
}
