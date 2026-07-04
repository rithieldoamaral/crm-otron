/**
 * Testes TDD para AnthropicProvider.
 * Mockamos o SDK da Anthropic para não fazer chamadas reais.
 */

// auto-mock: substitui todas as exportações por jest.fn()
jest.mock("@anthropic-ai/sdk");

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../providers/AnthropicProvider";
import { AIMessage, AITool } from "../../providers/interfaces";

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;
  let mockCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    MockAnthropic.mockImplementation(
      () => ({ messages: { create: mockCreate } } as any)
    );
    provider = new AnthropicProvider("test-api-key", "claude-haiku-4-5-20251001");
  });

  describe("chat()", () => {
    it("retorna conteúdo de texto corretamente", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Olá, como posso ajudar?" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 8 }
      });

      const messages: AIMessage[] = [{ role: "user", content: "Oi" }];
      const result = await provider.chat(messages, "Você é um assistente.");

      expect(result.content).toBe("Olá, como posso ajudar?");
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 8 });
    });

    it("passa system prompt corretamente para a API", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 }
      });

      await provider.chat([], "Meu system prompt");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: "Meu system prompt" })
      );
    });

    it("retorna finishReason='length' quando stop_reason é max_tokens", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "texto cortado" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 100 }
      });

      const result = await provider.chat([], "system");
      expect(result.finishReason).toBe("length");
    });

    it("retorna finishReason='error' e content null em caso de exceção", async () => {
      mockCreate.mockRejectedValue(new Error("API indisponível"));

      const result = await provider.chat([], "system");
      expect(result.finishReason).toBe("error");
      expect(result.content).toBeNull();
    });
  });

  describe("chatWithTools()", () => {
    const tools: AITool[] = [
      {
        name: "buscar_contato",
        description: "Busca um contato pelo nome",
        parameters: {
          type: "object",
          properties: { nome: { type: "string" } },
          required: ["nome"]
        }
      }
    ];

    it("retorna tool_calls quando modelo decide usar uma ferramenta", async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "tool_abc123",
            name: "buscar_contato",
            input: { nome: "Maria" }
          }
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 15 }
      });

      const messages: AIMessage[] = [
        { role: "user", content: "Busca a Maria para mim" }
      ];
      const result = await provider.chatWithTools(messages, tools, "system");

      expect(result.finishReason).toBe("tool_use");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: "tool_abc123",
        name: "buscar_contato",
        arguments: { nome: "Maria" }
      });
    });

    it("formata tools no padrão Anthropic (input_schema)", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 }
      });

      await provider.chatWithTools([], tools, "system");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              name: "buscar_contato",
              description: "Busca um contato pelo nome",
              input_schema: tools[0].parameters
            }
          ]
        })
      );
    });
  });
});
