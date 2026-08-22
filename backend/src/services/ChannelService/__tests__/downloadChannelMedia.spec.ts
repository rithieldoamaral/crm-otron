/**
 * Testes do download de mídia recebida por canal oficial.
 *
 * POR QUE ESTE CÓDIGO EXISTE (item 2 da auditoria): a URL de mídia da Cloud
 * API expira em ~5 MINUTOS. Guardar a referência e buscar depois significa
 * anexo perdido — e, no caso de áudio, significa o Agente sem o que
 * transcrever, respondendo "[erro ao processar]" ao cliente.
 *
 * A mídia precisa ser baixada NO MOMENTO do webhook, não sob demanda.
 *
 * Segurança coberta aqui (CLAUDE.md XV.4): o nome do arquivo vem do provedor,
 * que por sua vez recebeu do CLIENTE. É entrada hostil — sem sanitização, um
 * `../../` no nome grava fora da pasta da empresa.
 */

import axios from "axios";
import fs from "fs";

import { downloadChannelMedia } from "../downloadChannelMedia";

jest.mock("axios");
jest.mock("fs");

const axiosMock = axios as jest.Mocked<typeof axios>;

/** Conexão simulada — o config já vem decifrado pelo mock abaixo. */
const conexao = (channelType: string) =>
  ({ id: 7, companyId: 42, channelType } as any);

jest.mock("../channelConfig", () => ({
  getChannelConfig: () => ({
    accessToken: "EAAGtoken",
    accountSid: "ACsid",
    authToken: "authtoken"
  })
}));

beforeEach(() => {
  jest.clearAllMocks();
  (fs.existsSync as jest.Mock).mockReturnValue(true);
  (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
  (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
});

describe("downloadChannelMedia — Cloud API", () => {
  /** A Meta exige DUAS chamadas: id → metadados com URL → binário. */
  const mockarMeta = (mimeType = "audio/ogg") => {
    axiosMock.get
      .mockResolvedValueOnce({
        data: { url: "https://lookaside.fb.com/tmp/abc", mime_type: mimeType }
      } as any)
      .mockResolvedValueOnce({ data: Buffer.from("conteudo-binario") } as any);
  };

  it("resolve o id em URL e baixa o binário", async () => {
    mockarMeta();

    const nome = await downloadChannelMedia(
      { mediaUrl: "media-id-123", mediaType: "audio" } as any,
      conexao("cloud_api")
    );

    // Duas chamadas: metadados e depois o arquivo.
    expect(axiosMock.get).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(nome).toBeTruthy();
  });

  it("envia o token no cabeçalho das DUAS chamadas", async () => {
    mockarMeta();

    await downloadChannelMedia(
      { mediaUrl: "media-id-123", mediaType: "image" } as any,
      conexao("cloud_api")
    );

    // A URL temporária da Meta também exige Bearer — sem ele, 401.
    const [primeira, segunda] = axiosMock.get.mock.calls;
    expect(primeira[1]?.headers?.Authorization).toContain("Bearer");
    expect(segunda[1]?.headers?.Authorization).toContain("Bearer");
  });

  it("deriva a extensão do mime-type devolvido pela Meta", async () => {
    mockarMeta("image/jpeg");

    const nome = await downloadChannelMedia(
      { mediaUrl: "media-1", mediaType: "image" } as any,
      conexao("cloud_api")
    );

    // Sem extensão correta, o navegador não sabe renderizar e o ffmpeg não
    // sabe converter o áudio.
    expect(nome).toMatch(/\.jpe?g$/);
  });

  it("devolve null quando a Meta falha, sem derrubar o recebimento", async () => {
    axiosMock.get.mockRejectedValueOnce(new Error("410 Gone"));

    const nome = await downloadChannelMedia(
      { mediaUrl: "expirado", mediaType: "image" } as any,
      conexao("cloud_api")
    );

    // Mídia perdida é ruim; perder a MENSAGEM inteira por causa dela é pior.
    expect(nome).toBeNull();
  });
});

describe("downloadChannelMedia — Twilio", () => {
  it("baixa direto da URL com autenticação básica", async () => {
    axiosMock.get.mockResolvedValueOnce({
      data: Buffer.from("binario"),
      headers: { "content-type": "image/png" }
    } as any);

    const nome = await downloadChannelMedia(
      {
        mediaUrl: "https://api.twilio.com/Media/ME123",
        mediaType: "image"
      } as any,
      conexao("twilio")
    );

    // Uma chamada só: a Twilio já entrega a URL final.
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
    expect(axiosMock.get.mock.calls[0][1]?.auth).toEqual({
      username: "ACsid",
      password: "authtoken"
    });
    expect(nome).toBeTruthy();
  });
});

describe("segurança do nome de arquivo", () => {
  it("NÃO permite escapar da pasta da empresa", async () => {
    axiosMock.get
      .mockResolvedValueOnce({
        data: { url: "https://x/y", mime_type: "application/pdf" }
      } as any)
      .mockResolvedValueOnce({ data: Buffer.from("x") } as any);

    const nome = await downloadChannelMedia(
      {
        mediaUrl: "media-1",
        mediaType: "document",
        // O nome vem do provedor, que recebeu do CLIENTE: entrada hostil.
        fileName: "../../../etc/passwd"
      } as any,
      conexao("cloud_api")
    );

    expect(nome).not.toContain("..");
    expect(nome).not.toContain("/");
    expect(nome).not.toContain("\\");
  });

  it("grava dentro da pasta da empresa correta", async () => {
    axiosMock.get
      .mockResolvedValueOnce({
        data: { url: "https://x/y", mime_type: "image/png" }
      } as any)
      .mockResolvedValueOnce({ data: Buffer.from("x") } as any);

    await downloadChannelMedia(
      { mediaUrl: "media-1", mediaType: "image" } as any,
      conexao("cloud_api")
    );

    const caminhoGravado = (fs.writeFileSync as jest.Mock).mock.calls[0][0];

    // Isolamento multi-tenant no disco (XV.3): arquivo de uma empresa não
    // pode cair na pasta de outra.
    expect(String(caminhoGravado)).toContain("company42");
  });
});
