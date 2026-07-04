/**
 * Adapter para APIs compatíveis com OpenAI via fetch nativo.
 * Cobre: OpenAI, Groq, OpenRouter, MiniMax — e qualquer endpoint OpenAI-compatible.
 * Não depende do SDK openai para evitar conflito com openai@3.3.0 já instalado.
 */

import {
  AIMessage,
  AIProvider,
  AIResponse,
  AITool,
  ChatOptions
} from "./interfaces";

/** Formato de mensagem da API OpenAI */
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export class OpenAICompatibleProvider implements AIProvider {
  /** URL base exposta para que AIProviderFactory possa inspecionar em testes */
  public readonly baseUrl: string;
  private apiKey: string;
  private model: string;

  /**
   * @param apiKey - Chave de API do provedor
   * @param model - ID do modelo (ex: "llama-3.3-70b-versatile" para Groq)
   * @param baseUrl - URL base do endpoint OpenAI-compatible
   */
  constructor(apiKey: string, model: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  /** Converte AIMessage[] para o formato de mensagens da API OpenAI */
  private toOpenAIMessages(
    messages: AIMessage[],
    systemPrompt: string
  ): OpenAIMessage[] {
    const systemMessage: OpenAIMessage = {
      role: "system",
      content: systemPrompt
    };

    const converted: OpenAIMessage[] = messages.map(m => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId!,
          name: m.name
        };
      }
      // Assistant com tool_calls: a OpenAI exige que tool_calls esteja
      // presente para que mensagens 'tool' subsequentes sejam aceitas.
      // Quando há tool_calls, content pode (e costuma) ser null/vazio.
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content && m.content.length > 0 ? m.content : null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments ?? {})
            }
          }))
        };
      }
      return { role: m.role as OpenAIMessage["role"], content: m.content };
    });

    return [systemMessage, ...converted];
  }

  /** Converte AITool[] para o formato de tools da API OpenAI */
  private toOpenAITools(tools: AITool[]) {
    return tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  /** Normaliza finish_reason da OpenAI para finishReason padrão */
  private normalizeFinishReason(
    reason: string | null
  ): AIResponse["finishReason"] {
    if (reason === "tool_calls") return "tool_use";
    if (reason === "length") return "length";
    return "stop";
  }

  /** Executa chamada fetch para o endpoint do provider */
  private async callAPI(body: Record<string, unknown>): Promise<Response> {
    // Escalabilidade P0: sem AbortSignal, fetch travado segura conexão do pool
    // Sequelize indefinidamente. timeout(30000) → aborta após 30s e lança
    // DOMException "AbortError", que cai no catch → finishReason: "error".
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
  }

  async chat(
    messages: AIMessage[],
    systemPrompt: string,
    options: ChatOptions = {}
  ): Promise<AIResponse> {
    try {
      const response = await this.callAPI({
        model: this.model,
        messages: this.toOpenAIMessages(messages, systemPrompt),
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? 1024
      });

      if (!response.ok) {
        return { content: null, finishReason: "error" };
      }

      const data = await response.json();
      const choice = data.choices[0];

      return {
        content: choice.message.content,
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0
        }
      };
    } catch (error) {
      return { content: null, finishReason: "error" };
    }
  }

  async chatWithTools(
    messages: AIMessage[],
    tools: AITool[],
    systemPrompt: string,
    options: ChatOptions = {}
  ): Promise<AIResponse> {
    try {
      const response = await this.callAPI({
        model: this.model,
        messages: this.toOpenAIMessages(messages, systemPrompt),
        tools: this.toOpenAITools(tools),
        tool_choice: "auto",
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens ?? 1024
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "<unreadable>");
        // eslint-disable-next-line no-console
        console.error(
          `[OpenAICompatibleProvider] HTTP ${response.status} model=${this.model} url=${this.baseUrl}/chat/completions body=${errorBody.slice(0, 600)}`
        );
        return { content: null, finishReason: "error" };
      }

      const data = await response.json();
      const choice = data.choices[0];
      const rawToolCalls: OpenAIToolCall[] =
        choice.message.tool_calls ?? [];

      return {
        content: choice.message.content,
        finishReason: this.normalizeFinishReason(choice.finish_reason),
        toolCalls: rawToolCalls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: this.safeParseToolArgs(tc.function.arguments, tc.function.name)
        })),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0
        }
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `[OpenAICompatibleProvider] chatWithTools threw: model=${this.model} err=${(error as Error).message}`
      );
      return { content: null, finishReason: "error" };
    }
  }

  // Defesa contra modelos que retornam JSON inválido em tool_calls (visto com gpt-oss-120b ocasional).
  // JSON.parse explodir aborta a resposta inteira; melhor cair em {} e logar.
  private safeParseToolArgs(raw: string, toolName: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // eslint-disable-next-line no-console
      console.error(
        `[OpenAICompatibleProvider] tool_call args inválido para ${toolName}: ${raw.slice(0, 300)}`
      );
      return {};
    }
  }
}
