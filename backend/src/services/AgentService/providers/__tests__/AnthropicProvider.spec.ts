/**
 * Testes para AnthropicProvider.
 * Foco: timeout de rede (escalabilidade P0).
 *
 * Sem timeout configurado no SDK, qualquer chamada travada segura a conexão
 * do pool do Sequelize indefinidamente. Com timeout: 30000 no construtor,
 * o SDK aborta após 30s e lança APIConnectionTimeoutError.
 */

jest.mock("@anthropic-ai/sdk");

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../AnthropicProvider";

const MockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

beforeEach(() => {
  MockAnthropic.mockClear();
  // Configura mock default para messages.create
  MockAnthropic.prototype.messages = {
    create: jest.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 3 }
    })
  } as any;
});

// ─── Escalabilidade P0: timeout de rede ──────────────────────────────────────

describe("AnthropicProvider — timeout de rede (escalabilidade P0)", () => {
  it("constrói o cliente Anthropic com timeout de 30s", () => {
    new AnthropicProvider("sk-ant-test", "claude-haiku-4-5");

    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-ant-test",
        timeout: 30000
      })
    );
  });

  it("configura maxRetries=2 para tolerar falhas transitórias (429, 503)", () => {
    new AnthropicProvider("sk-ant-test", "claude-haiku-4-5");

    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 2
      })
    );
  });

  it("retorna finishReason=error quando SDK lança erro de timeout", async () => {
    MockAnthropic.prototype.messages = {
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error("Request timed out"), { name: "APIConnectionTimeoutError" })
      )
    } as any;

    const provider = new AnthropicProvider("sk-ant-test", "claude-haiku-4-5");
    const result = await provider.chatWithTools([], [], "system");

    expect(result.finishReason).toBe("error");
    expect(result.content).toBeNull();
  });

  it("retorna finishReason=error quando SDK lança 429 após retries esgotados", async () => {
    MockAnthropic.prototype.messages = {
      create: jest.fn().mockRejectedValue(
        Object.assign(new Error("Rate limit exceeded"), { name: "RateLimitError", status: 429 })
      )
    } as any;

    const provider = new AnthropicProvider("sk-ant-test", "claude-haiku-4-5");
    const result = await provider.chatWithTools([], [], "system");

    expect(result.finishReason).toBe("error");
  });
});
