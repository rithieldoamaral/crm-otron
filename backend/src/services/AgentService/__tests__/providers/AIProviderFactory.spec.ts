/**
 * Testes TDD para AIProviderFactory.
 * Escritos ANTES da implementação conforme CLAUDE.md seção II.1.
 */

// Mock do Anthropic SDK para evitar exigência de fetch global nos testes
jest.mock("@anthropic-ai/sdk");

import { AIProviderFactory } from "../../providers/AIProviderFactory";
import { AnthropicProvider } from "../../providers/AnthropicProvider";
import { OpenAICompatibleProvider } from "../../providers/OpenAICompatibleProvider";
import { PROVIDER_BASE_URLS } from "../../providers/interfaces";

describe("AIProviderFactory", () => {
  const baseConfig = { apiKey: "test-key", model: "test-model" };

  describe("create()", () => {
    it("retorna AnthropicProvider para provider='anthropic'", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "anthropic"
      });
      expect(provider).toBeInstanceOf(AnthropicProvider);
    });

    it("retorna OpenAICompatibleProvider para provider='openai'", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "openai"
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it("retorna OpenAICompatibleProvider para provider='groq'", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "groq"
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it("retorna OpenAICompatibleProvider para provider='openrouter'", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "openrouter"
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it("retorna OpenAICompatibleProvider para provider='minimax'", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "minimax"
      });
      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    });

    it("lança erro para provider desconhecido", () => {
      expect(() =>
        AIProviderFactory.create({
          ...baseConfig,
          provider: "provedor_invalido" as any
        })
      ).toThrow("Provider desconhecido: provedor_invalido");
    });
  });

  describe("baseUrl padrão por provider", () => {
    it("usa baseUrl padrão do Groq quando não informada", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "groq"
      }) as OpenAICompatibleProvider;
      expect(provider.baseUrl).toBe(PROVIDER_BASE_URLS.groq);
    });

    it("usa baseUrl padrão do OpenRouter quando não informada", () => {
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "openrouter"
      }) as OpenAICompatibleProvider;
      expect(provider.baseUrl).toBe(PROVIDER_BASE_URLS.openrouter);
    });

    it("usa baseUrl customizada quando informada", () => {
      const customUrl = "https://minha-api.com/v1";
      const provider = AIProviderFactory.create({
        ...baseConfig,
        provider: "openai",
        baseUrl: customUrl
      }) as OpenAICompatibleProvider;
      expect(provider.baseUrl).toBe(customUrl);
    });
  });
});
