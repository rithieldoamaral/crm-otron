/**
 * Adapter para a API da Anthropic (Claude).
 * Traduz a interface AIProvider para o formato do SDK @anthropic-ai/sdk.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  AIMessage,
  AIProvider,
  AIResponse,
  AITool,
  ChatOptions
} from "./interfaces";

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  /**
   * @param apiKey - Chave de API da Anthropic
   * @param model - ID do modelo (ex: "claude-haiku-4-5-20251001")
   */
  constructor(apiKey: string, model: string) {
    // Escalabilidade P0: sem timeout, uma chamada travada (LLM lento, network
    // blip, 503 transitório) segura conexão do pool Sequelize indefinidamente.
    // timeout: 30s → SDK aborta e lança APIConnectionTimeoutError, que cai no
    // catch e retorna finishReason: "error" — sem segurar pool.
    // maxRetries: 2 → SDK faz até 2 retries automáticos em 429/503 transitórios
    // antes de lançar; reduz falhas visíveis ao cliente por instabilidade breve.
    this.client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 2 });
    this.model = model;
  }

  /**
   * Converte AIMessage[] para o formato de mensagens da Anthropic.
   * Remove mensagens com role=system (system vai separado no SDK).
   *
   * Quando assistant carrega `toolCalls`, monta blocos de conteúdo
   * (text + tool_use) — o tool_result que vem depois precisa do
   * `tool_use_id` correspondente para a Anthropic não rejeitar a request.
   */
  private toAnthropicMessages(
    messages: AIMessage[]
  ): Anthropic.MessageParam[] {
    return messages
      .filter(m => m.role !== "system")
      .map(m => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.toolCallId!,
                content: m.content
              }
            ]
          };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          const blocks: Anthropic.ContentBlockParam[] = [];
          if (m.content && m.content.trim().length > 0) {
            blocks.push({ type: "text", text: m.content });
          }
          for (const tc of m.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments ?? {}
            });
          }
          return { role: "assistant" as const, content: blocks };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content
        };
      });
  }

  /** Converte AITool[] para o formato de tools da Anthropic */
  private toAnthropicTools(tools: AITool[]): Anthropic.Tool[] {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema
    }));
  }

  /** Normaliza stop_reason do Anthropic para finishReason padrão */
  private normalizeFinishReason(
    stopReason: string | null
  ): AIResponse["finishReason"] {
    if (stopReason === "tool_use") return "tool_use";
    if (stopReason === "max_tokens") return "length";
    return "stop";
  }

  async chat(
    messages: AIMessage[],
    systemPrompt: string,
    options: ChatOptions = {}
  ): Promise<AIResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        system: systemPrompt,
        messages: this.toAnthropicMessages(messages),
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.5
      });

      const textBlock = response.content.find(b => b.type === "text");
      return {
        content: textBlock ? (textBlock as Anthropic.TextBlock).text : null,
        finishReason: this.normalizeFinishReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
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
      const response = await this.client.messages.create({
        model: this.model,
        system: systemPrompt,
        messages: this.toAnthropicMessages(messages),
        tools: this.toAnthropicTools(tools),
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.5
      });

      const textBlock = response.content.find(b => b.type === "text");
      const toolUseBlocks = response.content.filter(
        b => b.type === "tool_use"
      ) as Anthropic.ToolUseBlock[];

      return {
        content: textBlock ? (textBlock as Anthropic.TextBlock).text : null,
        finishReason: this.normalizeFinishReason(response.stop_reason),
        toolCalls: toolUseBlocks.map(b => ({
          id: b.id,
          name: b.name,
          arguments: b.input as Record<string, unknown>
        })),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      };
    } catch (error) {
      return { content: null, finishReason: "error" };
    }
  }
}
