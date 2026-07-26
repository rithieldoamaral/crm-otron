/**
 * modelFetcher — busca modelos disponíveis por provedor via API.
 * Responsabilidade única: retornar lista atualizada de modelos sem hardcode.
 */

import { Configuration, OpenAIApi } from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface AgentModel {
  id: string;
  label: string;
}

// 2026-07-26: minimax não tinha entrada aqui (embora já funcione para chat via
// AIProviderFactory) — o botão "atualizar modelos" falhava silenciosamente
// para esse provider. deepseek/qwen adicionados na mesma leva.
const BASE_PATHS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.io/v1",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

const LLM_FILTER: Record<string, (id: string) => boolean> = {
  openai: id =>
    (id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4") || id.startsWith("chatgpt")) &&
    !id.includes("embed"),
  groq: id => !id.includes("whisper") && !id.includes("distil"),
  openrouter: () => true,
  minimax: () => true,
  deepseek: () => true,
  // DashScope mistura chat/ASR/embedding/rerank num único catálogo — exclui
  // os que claramente não são modelos de conversação.
  qwen: id =>
    !id.includes("asr") && !id.includes("tts") &&
    !id.includes("embedding") && !id.includes("rerank"),
};

/**
 * DeepSeek não possui API de transcrição de áudio (verificado 2026-07-26) —
 * por isso não tem entrada aqui. fetchTranscriptionModels("deepseek", ...)
 * retorna [] graciosamente (mesmo caminho de "sem filtro" já existente).
 */
const TRANSCRIPTION_FILTER: Record<string, (id: string) => boolean> = {
  openai: id => id.includes("whisper"),
  groq: id => id.includes("whisper") || id.includes("distil"),
  qwen: id => id.includes("asr"),
};

async function fetchOpenAICompatModels(
  apiKey: string,
  basePath: string,
  filter: (id: string) => boolean
): Promise<AgentModel[]> {
  const configuration = new Configuration({ apiKey, basePath });
  const openai = new OpenAIApi(configuration);
  const response = await openai.listModels();
  return (response.data.data as any[])
    .filter(m => filter(m.id))
    .map(m => ({ id: m.id, label: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchAnthropicModels(apiKey: string): Promise<AgentModel[]> {
  const client = new Anthropic({ apiKey });
  const page = await client.models.list();
  return (page.data as any[]).map(m => ({
    id: m.id,
    label: m.display_name || m.id,
  }));
}

export async function fetchLLMModels(provider: string, apiKey: string): Promise<AgentModel[]> {
  try {
    if (provider === "anthropic") return await fetchAnthropicModels(apiKey);

    const basePath = BASE_PATHS[provider];
    if (!basePath) return [];

    const filter = LLM_FILTER[provider] ?? (() => true);
    return await fetchOpenAICompatModels(apiKey, basePath, filter);
  } catch {
    return [];
  }
}

export async function fetchTranscriptionModels(provider: string, apiKey: string): Promise<AgentModel[]> {
  try {
    const basePath = BASE_PATHS[provider];
    if (!basePath) return [];

    const filter = TRANSCRIPTION_FILTER[provider];
    if (!filter) return [];

    return await fetchOpenAICompatModels(apiKey, basePath, filter);
  } catch {
    return [];
  }
}
