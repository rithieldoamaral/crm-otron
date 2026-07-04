/**
 * Testes TDD para transcriptionProvider.
 * Cobre: multi-provedor Whisper, settings lookup, degradação sem chave.
 */

jest.mock("openai");
jest.mock("fs");
jest.mock("../../../models/Setting");
jest.mock("../../../models/GlobalSetting");

import { Configuration, OpenAIApi } from "openai";
import * as fs from "fs";
import Setting from "../../../models/Setting";
import GlobalSetting from "../../../models/GlobalSetting";
import {
  transcribeWithProvider,
  getWhisperSettings,
  transcribeAudioForCompany,
} from "../transcriptionProvider";

const mockSetting = Setting as jest.Mocked<typeof Setting>;
const mockGlobalSetting = GlobalSetting as jest.Mocked<typeof GlobalSetting>;
let mockCreateTranscription: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateTranscription = jest.fn();
  (OpenAIApi as jest.Mock).mockImplementation(() => ({
    createTranscription: mockCreateTranscription,
  }));
  (fs.createReadStream as jest.Mock).mockReturnValue("fake-stream");
  // Sem GlobalSettings por padrão (sem override de plataforma)
  mockGlobalSetting.findAll.mockResolvedValue([] as any);
});

describe("transcribeWithProvider", () => {
  it("usa basePath da OpenAI para provider openai", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "Olá" } });

    await transcribeWithProvider("/tmp/audio.ogg", "openai", "whisper-1", "sk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.openai.com/v1" })
    );
  });

  it("usa basePath do Groq para provider groq", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "Olá" } });

    await transcribeWithProvider("/tmp/audio.ogg", "groq", "whisper-large-v3", "gsk-test");

    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.groq.com/openai/v1" })
    );
  });

  it("passa o modelo correto para a API", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "texto" } });

    await transcribeWithProvider("/tmp/audio.ogg", "groq", "whisper-large-v3", "gsk-test");

    expect(mockCreateTranscription).toHaveBeenCalledWith(
      "fake-stream", "whisper-large-v3", undefined, undefined, undefined, "pt"
    );
  });

  it("retorna texto transcrito", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "Quero agendar" } });

    const result = await transcribeWithProvider("/tmp/audio.ogg", "openai", "whisper-1", "sk-test");

    expect(result).toBe("Quero agendar");
  });

  it("propaga erro quando a API falha", async () => {
    mockCreateTranscription.mockRejectedValue(new Error("API error"));

    await expect(
      transcribeWithProvider("/tmp/audio.ogg", "openai", "whisper-1", "sk-bad")
    ).rejects.toThrow("API error");
  });
});

describe("getWhisperSettings", () => {
  it("retorna provider, model e apiKey quando todos configurados (empresa)", async () => {
    mockSetting.findAll.mockResolvedValue([
      { key: "agentWhisperProvider", value: "groq" },
      { key: "agentWhisperModel", value: "whisper-large-v3" },
      { key: "agentWhisperApiKey", value: "gsk-abc" },
    ] as any);

    const result = await getWhisperSettings(1);

    expect(result).toEqual({
      provider: "groq",
      model: "whisper-large-v3",
      apiKey: "gsk-abc",
    });
  });

  it("usa defaults (openai, whisper-1) quando provider/model não configurados", async () => {
    mockSetting.findAll.mockResolvedValue([
      { key: "agentWhisperApiKey", value: "sk-abc" },
    ] as any);

    const result = await getWhisperSettings(1);

    expect(result?.provider).toBe("openai");
    expect(result?.model).toBe("whisper-1");
    expect(result?.apiKey).toBe("sk-abc");
  });

  it("retorna null quando apiKey não está configurada em nenhum lugar", async () => {
    mockSetting.findAll.mockResolvedValue([] as any);

    const result = await getWhisperSettings(1);

    expect(result).toBeNull();
  });

  it("GlobalSettings tem prioridade sobre Settings da empresa", async () => {
    // GlobalSettings configurados
    mockGlobalSetting.findAll.mockResolvedValue([
      { key: "globalWhisperProvider", value: "groq" },
      { key: "globalWhisperModel", value: "whisper-large-v3" },
      { key: "globalWhisperApiKey", value: "gsk-global" },
    ] as any);
    // Empresa também tem config (deve ser ignorada)
    mockSetting.findAll.mockResolvedValue([
      { key: "agentWhisperApiKey", value: "sk-empresa" },
    ] as any);

    const result = await getWhisperSettings(1);

    expect(result?.apiKey).toBe("gsk-global");
    expect(result?.provider).toBe("groq");
    expect(result?.model).toBe("whisper-large-v3");
    // Setting da empresa não deve ser consultado quando GlobalSettings existe
    expect(mockSetting.findAll).not.toHaveBeenCalled();
  });

  it("cai para settings da empresa quando GlobalSettings não tem apiKey", async () => {
    // GlobalSettings sem apiKey
    mockGlobalSetting.findAll.mockResolvedValue([
      { key: "globalWhisperProvider", value: "groq" },
    ] as any);
    // Empresa tem config
    mockSetting.findAll.mockResolvedValue([
      { key: "agentWhisperApiKey", value: "sk-empresa" },
      { key: "agentWhisperProvider", value: "openai" },
      { key: "agentWhisperModel", value: "whisper-1" },
    ] as any);

    const result = await getWhisperSettings(1);

    expect(result?.apiKey).toBe("sk-empresa");
    expect(result?.provider).toBe("openai");
  });

  it("GlobalSettings usa defaults quando provider/model não configurados", async () => {
    mockGlobalSetting.findAll.mockResolvedValue([
      { key: "globalWhisperApiKey", value: "gsk-global" },
    ] as any);

    const result = await getWhisperSettings(99);

    expect(result?.apiKey).toBe("gsk-global");
    expect(result?.provider).toBe("openai");
    expect(result?.model).toBe("whisper-1");
  });
});

describe("transcribeAudioForCompany", () => {
  it("retorna null quando não há configuração Whisper", async () => {
    mockSetting.findAll.mockResolvedValue([] as any);

    const result = await transcribeAudioForCompany("/tmp/audio.ogg", 1);

    expect(result).toBeNull();
    expect(mockCreateTranscription).not.toHaveBeenCalled();
  });

  it("chama transcribeWithProvider com as configurações corretas", async () => {
    mockSetting.findAll.mockResolvedValue([
      { key: "agentWhisperProvider", value: "groq" },
      { key: "agentWhisperModel", value: "whisper-large-v3" },
      { key: "agentWhisperApiKey", value: "gsk-abc" },
    ] as any);
    mockCreateTranscription.mockResolvedValue({ data: { text: "Texto do áudio" } });

    const result = await transcribeAudioForCompany("/tmp/audio.ogg", 1);

    expect(result).toBe("Texto do áudio");
    expect(Configuration).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: "https://api.groq.com/openai/v1" })
    );
  });
});
