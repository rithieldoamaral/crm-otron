/**
 * Testes TDD para audioTranscriber.
 * Cobre: transcrição feliz, parâmetros corretos, erro de API, chave ausente.
 */

jest.mock("openai");
jest.mock("fs");
jest.mock("../../../models/Setting");

import { OpenAIApi } from "openai";
import * as fs from "fs";
import Setting from "../../../models/Setting";
import { transcribeAudio, getWhisperApiKey } from "../audioTranscriber";

const mockSetting = Setting as jest.Mocked<typeof Setting>;
let mockCreateTranscription: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateTranscription = jest.fn();
  (OpenAIApi as jest.Mock).mockImplementation(() => ({
    createTranscription: mockCreateTranscription,
  }));
  (fs.createReadStream as jest.Mock).mockReturnValue("fake-stream");
});

describe("transcribeAudio", () => {
  it("retorna o texto transcrito pelo Whisper", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "Quero agendar um corte amanhã" } });

    const result = await transcribeAudio("/public/audio_1.ogg", "sk-test");

    expect(result).toBe("Quero agendar um corte amanhã");
  });

  it("passa modelo whisper-1 e idioma pt para a API", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "ok" } });

    await transcribeAudio("/public/audio_1.ogg", "sk-test");

    const args = mockCreateTranscription.mock.calls[0];
    expect(args[0]).toBe("fake-stream"); // stream do arquivo
    expect(args[1]).toBe("whisper-1");   // modelo
    expect(args[5]).toBe("pt");          // idioma (6º parâmetro)
  });

  it("cria ReadStream do caminho fornecido", async () => {
    mockCreateTranscription.mockResolvedValue({ data: { text: "texto" } });

    await transcribeAudio("/public/audio_42.ogg", "sk-test");

    expect(fs.createReadStream).toHaveBeenCalledWith("/public/audio_42.ogg");
  });

  it("retorna string vazia quando resposta não tem texto", async () => {
    mockCreateTranscription.mockResolvedValue({ data: {} });

    const result = await transcribeAudio("/public/audio_1.ogg", "sk-test");

    expect(result).toBe("");
  });

  it("propaga erro quando a API Whisper falha", async () => {
    mockCreateTranscription.mockRejectedValue(new Error("Invalid API key"));

    await expect(transcribeAudio("/public/audio_1.ogg", "sk-invalid"))
      .rejects.toThrow("Invalid API key");
  });
});

describe("getWhisperApiKey", () => {
  it("retorna a chave quando configurada", async () => {
    mockSetting.findOne.mockResolvedValue({ value: "sk-whisper-abc123" } as any);

    const key = await getWhisperApiKey(1);

    expect(key).toBe("sk-whisper-abc123");
    expect(mockSetting.findOne).toHaveBeenCalledWith({
      where: { companyId: 1, key: "agentWhisperApiKey" },
    });
  });

  it("retorna null quando setting não existe", async () => {
    mockSetting.findOne.mockResolvedValue(null);

    const key = await getWhisperApiKey(1);

    expect(key).toBeNull();
  });

  it("retorna null quando chave está vazia", async () => {
    mockSetting.findOne.mockResolvedValue({ value: "" } as any);

    const key = await getWhisperApiKey(1);

    expect(key).toBeNull();
  });
});
