import { Request, Response } from "express";
import { fetchLLMModels, fetchTranscriptionModels } from "../services/AgentService/modelFetcher";
import { getSettingsByCompany } from "../services/AgentService/settingsCache";
import { buildSystemPrompt, getTemperatureForPersonality } from "../services/AgentService/knowledgeBuilder";
import { AIProviderFactory } from "../services/AgentService/providers/AIProviderFactory";
import { AIMessage } from "../services/AgentService/providers/interfaces";

/**
 * POST /agent/models
 * Body: { provider: string, apiKey: string, type: "llm" | "transcription" }
 * Retorna lista de modelos disponíveis para o provedor. Degradação graciosa em erro.
 */
export const listModels = async (req: Request, res: Response): Promise<Response> => {
  const { provider, apiKey, type } = req.body as {
    provider: string;
    apiKey: string;
    type: "llm" | "transcription";
  };

  if (!provider || !apiKey) {
    return res.status(200).json({ models: [] });
  }

  const models =
    type === "transcription"
      ? await fetchTranscriptionModels(provider, apiKey)
      : await fetchLLMModels(provider, apiKey);

  return res.status(200).json({ models });
};

/**
 * POST /agent/sandbox
 * Body: { message: string, history: Array<{role: "user"|"assistant", content: string}> }
 * Runs the LLM with the company's system prompt but NO tool execution — safe for testing.
 */
export const sandboxChat = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { message, history = [] } = req.body as {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!message?.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  // SEGURANÇA: limita tamanho do payload para evitar abuso de tokens da LLM
  // por usuário autenticado (custo financeiro). 4000 chars = ~1000 tokens,
  // suficiente para qualquer mensagem real de teste em sandbox.
  if (message.length > 4000) {
    return res.status(400).json({ error: "message exceeds 4000 characters" });
  }

  // Limita histórico para evitar payloads inflados que consumiriam contexto LLM
  if (Array.isArray(history) && history.length > 30) {
    return res.status(400).json({ error: "history exceeds 30 messages" });
  }

  const rows = await getSettingsByCompany(companyId);
  const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));

  const provider = (map.agentProvider ?? "anthropic") as any;
  const apiKey = map.agentApiKey ?? "";
  const model = map.agentModel ?? "claude-haiku-4-5-20251001";
  const personality = map.agentPersonality ?? "híbrido";

  if (!apiKey) {
    return res.status(400).json({ error: "API Key não configurada para o agente." });
  }

  const systemPrompt = await buildSystemPrompt(companyId);
  const temperature = getTemperatureForPersonality(personality);

  const messages: AIMessage[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: message }
  ];

  const aiProvider = AIProviderFactory.create({ provider, apiKey, model });
  const response = await aiProvider.chat(messages, systemPrompt, { temperature });

  return res.json({ reply: response.content ?? "..." });
};
