/**
 * Testes TDD para modelFetcher.
 * Cobre: busca por provedor, filtros corretos, degradação graciosa em erro.
 */

jest.mock("openai");
jest.mock("@anthropic-ai/sdk");

import { Configuration, OpenAIApi } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { fetchLLMModels, fetchTranscriptionModels } from "../modelFetcher";

let mockListModels: jest.Mock;
let mockAnthropicModelsList: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  mockListModels = jest.fn();
  (OpenAIApi as jest.Mock).mockImplementation(() => ({
    listModels: mockListModels,
  }));

  mockAnthropicModelsList = jest.fn();
  (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
    models: { list: mockAnthropicModelsList },
  }));
});

const openaiModels = [
  { id: "gpt-4o" },
  { id: "gpt-4o-mini" },
  { id: "o1-preview" },
  { id: "whisper-1" },
  { id: "text-embedding-3-small" },
  { id: "dall-e-3" },
];

const groqModels = [
  { id: "llama-3.3-70b-versatile" },
  { id: "mixtral-8x7b-32768" },
  { id: "whisper-large-v3" },
  { id: "distil-whisper-large-v3-en" },
];

describe("fetchLLMModels — openai", () => {
  it("usa basePath da OpenAI", async () => {
    mockListModels.mockResolvedValue({ data: { data: openaiModels } });

    await fetchLLMModels("openai", "sk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.openai.com/v1" })
    );
  });

  it("filtra apenas modelos de chat (exclui whisper, embed, dall-e)", async () => {
    mockListModels.mockResolvedValue({ data: { data: openaiModels } });

    const result = await fetchLLMModels("openai", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).not.toContain("whisper-1");
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("dall-e-3");
  });

  it("retorna array vazio em erro de API", async () => {
    mockListModels.mockRejectedValue(new Error("Unauthorized"));

    const result = await fetchLLMModels("openai", "sk-invalid");

    expect(result).toEqual([]);
  });
});

describe("fetchLLMModels — groq", () => {
  it("usa basePath da Groq", async () => {
    mockListModels.mockResolvedValue({ data: { data: groqModels } });

    await fetchLLMModels("groq", "gsk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.groq.com/openai/v1" })
    );
  });

  it("exclui modelos whisper da lista LLM", async () => {
    mockListModels.mockResolvedValue({ data: { data: groqModels } });

    const result = await fetchLLMModels("groq", "gsk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("llama-3.3-70b-versatile");
    expect(ids).not.toContain("whisper-large-v3");
    expect(ids).not.toContain("distil-whisper-large-v3-en");
  });
});

describe("fetchLLMModels — anthropic", () => {
  it("usa SDK Anthropic em vez do cliente OpenAI", async () => {
    mockAnthropicModelsList.mockResolvedValue({
      data: [
        { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" },
        { id: "claude-3-opus-20240229", display_name: "Claude 3 Opus" },
      ],
    });

    const result = await fetchLLMModels("anthropic", "sk-ant-test");

    expect(result[0]).toEqual({ id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" });
    expect(OpenAIApi).not.toHaveBeenCalled();
  });

  it("retorna array vazio em erro de API Anthropic", async () => {
    mockAnthropicModelsList.mockRejectedValue(new Error("Invalid key"));

    const result = await fetchLLMModels("anthropic", "sk-ant-invalid");

    expect(result).toEqual([]);
  });
});

describe("fetchLLMModels — provedor desconhecido", () => {
  it("retorna array vazio para provedor não suportado", async () => {
    const result = await fetchLLMModels("provedor_que_nao_existe", "any-key");
    expect(result).toEqual([]);
  });
});

const deepseekModels = [
  { id: "deepseek-v4-flash" },
  { id: "deepseek-v4-pro" },
];

const qwenModels = [
  { id: "qwen-plus" },
  { id: "qwen-turbo" },
  { id: "qwen-max" },
  { id: "qwen3-asr-flash" },
  { id: "text-embedding-v3" },
];

const minimaxModels = [
  { id: "MiniMax-M2" },
  { id: "MiniMax-M3" },
];

describe("fetchLLMModels — deepseek", () => {
  it("usa basePath do DeepSeek", async () => {
    mockListModels.mockResolvedValue({ data: { data: deepseekModels } });

    await fetchLLMModels("deepseek", "sk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.deepseek.com/v1" })
    );
  });

  it("retorna todos os modelos (catálogo pequeno, sem necessidade de filtro)", async () => {
    mockListModels.mockResolvedValue({ data: { data: deepseekModels } });

    const result = await fetchLLMModels("deepseek", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });

  it("retorna array vazio em erro de API", async () => {
    mockListModels.mockRejectedValue(new Error("Unauthorized"));

    const result = await fetchLLMModels("deepseek", "sk-invalid");

    expect(result).toEqual([]);
  });
});

describe("fetchLLMModels — qwen", () => {
  it("usa basePath do Qwen (DashScope internacional)", async () => {
    mockListModels.mockResolvedValue({ data: { data: qwenModels } });

    await fetchLLMModels("qwen", "sk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" })
    );
  });

  it("filtra modelos de chat, excluindo ASR e embedding", async () => {
    mockListModels.mockResolvedValue({ data: { data: qwenModels } });

    const result = await fetchLLMModels("qwen", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("qwen-plus");
    expect(ids).toContain("qwen-turbo");
    expect(ids).toContain("qwen-max");
    expect(ids).not.toContain("qwen3-asr-flash");
    expect(ids).not.toContain("text-embedding-v3");
  });
});

describe("fetchLLMModels — minimax", () => {
  it("usa basePath do MiniMax", async () => {
    mockListModels.mockResolvedValue({ data: { data: minimaxModels } });

    await fetchLLMModels("minimax", "sk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.minimax.io/v1" })
    );
  });

  it("retorna os modelos do catálogo MiniMax", async () => {
    mockListModels.mockResolvedValue({ data: { data: minimaxModels } });

    const result = await fetchLLMModels("minimax", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toEqual(["MiniMax-M2", "MiniMax-M3"]);
  });
});

describe("fetchTranscriptionModels — qwen", () => {
  it("retorna apenas modelos ASR do Qwen", async () => {
    mockListModels.mockResolvedValue({ data: { data: qwenModels } });

    const result = await fetchTranscriptionModels("qwen", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("qwen3-asr-flash");
    expect(ids).not.toContain("qwen-plus");
    expect(ids).not.toContain("text-embedding-v3");
  });

  it("retorna array vazio em erro", async () => {
    mockListModels.mockRejectedValue(new Error("timeout"));

    const result = await fetchTranscriptionModels("qwen", "sk-test");

    expect(result).toEqual([]);
  });
});

describe("fetchTranscriptionModels — deepseek (sem suporte a transcricao)", () => {
  it("retorna array vazio — DeepSeek não oferece API de transcrição", async () => {
    const result = await fetchTranscriptionModels("deepseek", "sk-test");
    expect(result).toEqual([]);
  });
});

describe("fetchTranscriptionModels — openai", () => {
  it("retorna apenas modelos whisper da OpenAI", async () => {
    mockListModels.mockResolvedValue({ data: { data: openaiModels } });

    const result = await fetchTranscriptionModels("openai", "sk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("whisper-1");
    expect(ids).not.toContain("gpt-4o");
  });
});

describe("fetchTranscriptionModels — groq", () => {
  it("retorna apenas modelos whisper e distil-whisper do Groq", async () => {
    mockListModels.mockResolvedValue({ data: { data: groqModels } });

    const result = await fetchTranscriptionModels("groq", "gsk-test");
    const ids = result.map(m => m.id);

    expect(ids).toContain("whisper-large-v3");
    expect(ids).toContain("distil-whisper-large-v3-en");
    expect(ids).not.toContain("llama-3.3-70b-versatile");
  });

  it("retorna array vazio em erro", async () => {
    mockListModels.mockRejectedValue(new Error("timeout"));

    const result = await fetchTranscriptionModels("groq", "gsk-test");

    expect(result).toEqual([]);
  });
});
