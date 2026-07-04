/**
 * Testes TDD para OpenAICompatibleProvider.
 * Mockamos fetch global para não fazer chamadas reais à API.
 */

import { OpenAICompatibleProvider } from "../../providers/OpenAICompatibleProvider";
import { AIMessage, AITool, PROVIDER_BASE_URLS } from "../../providers/interfaces";

const mockFetch = jest.fn();
global.fetch = mockFetch;

/** Helper para montar resposta fake da API OpenAI */
const makeOpenAIResponse = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  json: jest.fn().mockResolvedValue({
    choices: [
      {
        message: { role: "assistant", content: "Posso ajudar!", tool_calls: null },
        finish_reason: "stop"
      }
    ],
    usage: { prompt_tokens: 10, completion_tokens: 8 },
    ...overrides
  })
});

describe("OpenAICompatibleProvider", () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAICompatibleProvider(
      "test-key",
      "gpt-4o-mini",
      PROVIDER_BASE_URLS.openai
    );
  });

  describe("baseUrl", () => {
    it("expõe a baseUrl configurada", () => {
      expect(provider.baseUrl).toBe(PROVIDER_BASE_URLS.openai);
    });

    it("usa URL do Groq corretamente", () => {
      const groqProvider = new OpenAICompatibleProvider(
        "groq-key",
        "llama-3.3-70b-versatile",
        PROVIDER_BASE_URLS.groq
      );
      expect(groqProvider.baseUrl).toBe("https://api.groq.com/openai/v1");
    });
  });

  describe("chat()", () => {
    it("retorna conteúdo de texto corretamente", async () => {
      mockFetch.mockResolvedValue(makeOpenAIResponse());

      const messages: AIMessage[] = [{ role: "user", content: "Oi" }];
      const result = await provider.chat(messages, "Você é assistente.");

      expect(result.content).toBe("Posso ajudar!");
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 8 });
    });

    it("inclui system prompt como primeira mensagem com role=system", async () => {
      mockFetch.mockResolvedValue(makeOpenAIResponse());

      await provider.chat(
        [{ role: "user", content: "Oi" }],
        "System prompt aqui"
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0]).toEqual({
        role: "system",
        content: "System prompt aqui"
      });
    });

    it("envia Authorization header com Bearer token", async () => {
      mockFetch.mockResolvedValue(makeOpenAIResponse());
      await provider.chat([], "system");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["Authorization"]).toBe("Bearer test-key");
    });

    it("retorna finishReason='error' e content null quando API retorna erro HTTP", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429, json: jest.fn() });

      const result = await provider.chat([], "system");
      expect(result.finishReason).toBe("error");
      expect(result.content).toBeNull();
    });

    it("retorna finishReason='error' quando fetch lança exceção", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await provider.chat([], "system");
      expect(result.finishReason).toBe("error");
    });
  });

  describe("chatWithTools()", () => {
    const tools: AITool[] = [
      {
        name: "buscar_contato",
        description: "Busca um contato",
        parameters: {
          type: "object",
          properties: { nome: { type: "string" } },
          required: ["nome"]
        }
      }
    ];

    it("retorna tool_calls no formato normalizado", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_xyz",
                    type: "function",
                    function: {
                      name: "buscar_contato",
                      arguments: '{"nome": "João"}'
                    }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 }
        })
      });

      const result = await provider.chatWithTools(
        [{ role: "user", content: "Busca o João" }],
        tools,
        "system"
      );

      expect(result.finishReason).toBe("tool_use");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: "call_xyz",
        name: "buscar_contato",
        arguments: { nome: "João" }
      });
    });

    it("formata tools no padrão OpenAI (function calling)", async () => {
      mockFetch.mockResolvedValue(makeOpenAIResponse());

      await provider.chatWithTools([], tools, "system");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "buscar_contato",
            description: "Busca um contato",
            parameters: tools[0].parameters
          }
        }
      ]);
    });

    it("retorna finishReason='error' e logs body quando HTTP falha", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('{"error":{"message":"invalid tool schema"}}')
      });

      const result = await provider.chatWithTools([], tools, "system");
      expect(result.finishReason).toBe("error");
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("degrada arguments para {} quando o LLM devolve JSON inválido em tool_calls", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_bad",
                    type: "function",
                    function: { name: "buscar_contato", arguments: "{not valid json" }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5 }
        })
      });

      const result = await provider.chatWithTools([], tools, "system");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].arguments).toEqual({});
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
