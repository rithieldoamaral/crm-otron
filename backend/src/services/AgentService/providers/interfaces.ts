/**
 * Interfaces e tipos compartilhados para a camada de abstração de provedores de IA.
 * Garante que AnthropicProvider e OpenAICompatibleProvider sejam intercambiáveis.
 */

/** Mensagem no histórico de conversa */
export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** ID da tool call ao qual esta mensagem responde (role=tool) */
  toolCallId?: string;
  /** Nome da ferramenta quando role=tool */
  name?: string;
  /**
   * Tool calls emitidas por uma mensagem do assistant (role=assistant).
   *
   * Bug crítico (29/04/2026 — migração Groq→OpenAI): a OpenAI rejeita com
   * HTTP 400 qualquer mensagem `tool` cujo assistant anterior não carregue
   * `tool_calls`. A Groq aceitava silenciosamente. Sem este campo, o histórico
   * `assistant → tool → assistant → tool` enviado em iterações subsequentes
   * do loop agêntico fica inválido para qualquer provider que siga o spec.
   *
   * Cada provider serializa para seu formato nativo:
   *   - OpenAICompatibleProvider → `tool_calls` array
   *   - AnthropicProvider        → blocos `tool_use` dentro de `content`
   */
  toolCalls?: AIToolCall[];
}

/** Definição de uma ferramenta disponível para o agente */
export interface AITool {
  name: string;
  description: string;
  /** JSON Schema dos parâmetros da ferramenta */
  parameters: Record<string, unknown>;
}

/** Chamada de ferramenta retornada pelo modelo */
export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Resposta normalizada de qualquer provider */
export interface AIResponse {
  /** Texto gerado pelo modelo (null quando apenas tool_calls foram retornados) */
  content: string | null;
  toolCalls?: AIToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: "stop" | "tool_use" | "length" | "error";
}

/** Opções de geração por chamada */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/** Configuração do provider por empresa (lida do banco de dados) */
export interface ProviderConfig {
  /** Identificador do provider */
  provider: "anthropic" | "openai" | "groq" | "openrouter" | "minimax";
  apiKey: string;
  model: string;
  /** URL base customizada — obrigatória para Groq, OpenRouter, MiniMax */
  baseUrl?: string;
}

/** Contrato que todo provider de IA deve implementar */
export interface AIProvider {
  /**
   * Envia mensagens sem ferramentas — para respostas simples.
   * @param messages - Histórico de conversa (sem system prompt)
   * @param systemPrompt - Instrução de sistema separada
   * @param options - Parâmetros de geração opcionais
   * @returns Resposta normalizada do modelo
   */
  chat(
    messages: AIMessage[],
    systemPrompt: string,
    options?: ChatOptions
  ): Promise<AIResponse>;

  /**
   * Envia mensagens com ferramentas — para o loop agêntico.
   * @param messages - Histórico de conversa
   * @param tools - Ferramentas disponíveis para o modelo chamar
   * @param systemPrompt - Instrução de sistema separada
   * @param options - Parâmetros de geração opcionais
   * @returns Resposta com possível tool_calls para execução
   */
  chatWithTools(
    messages: AIMessage[],
    tools: AITool[],
    systemPrompt: string,
    options?: ChatOptions
  ): Promise<AIResponse>;
}

/** URLs base padrão por provider */
export const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.chat/v1"
};

/** Modelos padrão recomendados por provider (custo x qualidade em PT-BR) */
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  groq: "llama-3.3-70b-versatile",
  openrouter: "anthropic/claude-haiku-4-5",
  minimax: "abab6.5s-chat"
};
