/**
 * Factory que instancia o provider de IA correto com base na configuração da empresa.
 * Adicionar um novo provider = adicionar um case aqui e criar a classe.
 */

import { AIProvider, PROVIDER_BASE_URLS, ProviderConfig } from "./interfaces";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

export class AIProviderFactory {
  /**
   * Instancia o provider correto para a configuração informada.
   *
   * @param config - Configuração lida do banco de dados (Settings da empresa)
   * @returns Instância de AIProvider pronta para uso
   * @throws Error se o provider não for reconhecido
   *
   * @example
   * const provider = AIProviderFactory.create({
   *   provider: "groq",
   *   apiKey: "gsk_...",
   *   model: "llama-3.3-70b-versatile"
   * });
   */
  static create(config: ProviderConfig): AIProvider {
    const { provider, apiKey, model, baseUrl } = config;

    switch (provider) {
      case "anthropic":
        return new AnthropicProvider(apiKey, model);

      case "openai":
        return new OpenAICompatibleProvider(
          apiKey,
          model,
          baseUrl ?? PROVIDER_BASE_URLS.openai
        );

      case "groq":
        return new OpenAICompatibleProvider(
          apiKey,
          model,
          baseUrl ?? PROVIDER_BASE_URLS.groq
        );

      case "openrouter":
        return new OpenAICompatibleProvider(
          apiKey,
          model,
          baseUrl ?? PROVIDER_BASE_URLS.openrouter
        );

      case "minimax":
        return new OpenAICompatibleProvider(
          apiKey,
          model,
          baseUrl ?? PROVIDER_BASE_URLS.minimax
        );

      default:
        throw new Error(`Provider desconhecido: ${provider}`);
    }
  }
}
