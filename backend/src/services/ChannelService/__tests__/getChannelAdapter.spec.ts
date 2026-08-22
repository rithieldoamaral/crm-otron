/**
 * Testes da fábrica de adaptadores de canal.
 *
 * Por que existem: esta é a única porta pela qual o resto do sistema descobre
 * "como envio mensagem nesta conexão". Se ela devolver o adaptador errado, a
 * mensagem vai pelo canal errado — ou pior, uma conexão oficial tenta abrir
 * socket Baileys e falha de um jeito difícil de diagnosticar.
 *
 * O teste de conexão SEM `channelType` é o que protege a base legada: toda
 * conexão criada antes desta feature tem a coluna com o default do banco, e
 * precisa continuar sendo Baileys.
 */

import { getChannelAdapter } from "../getChannelAdapter";
import { isCanalOficial } from "../types";

jest.mock("../../../libs/wbot", () => ({
  getWbot: jest.fn(() => ({
    sendMessage: jest.fn(async () => ({ key: { id: "BAE123" } })),
    sendPresenceUpdate: jest.fn(async () => undefined),
    readMessages: jest.fn(async () => undefined)
  }))
}));

const conexao = (over: Record<string, unknown> = {}) =>
  ({
    id: 7,
    companyId: 1,
    channelType: "baileys",
    channelConfig: null,
    ...over
  } as any);

describe("getChannelAdapter", () => {
  it("devolve o adaptador Baileys para channelType 'baileys'", () => {
    expect(getChannelAdapter(conexao()).type).toBe("baileys");
  });

  it("trata conexão SEM channelType como Baileys (base legada)", () => {
    // Conexões criadas antes desta feature não têm o campo preenchido em
    // memória; virar canal oficial por engano quebraria produção.
    expect(getChannelAdapter(conexao({ channelType: undefined })).type).toBe(
      "baileys"
    );
    expect(getChannelAdapter(conexao({ channelType: null })).type).toBe(
      "baileys"
    );
  });

  it("propaga o id da conexão para o adaptador", () => {
    expect(getChannelAdapter(conexao({ id: 42 })).whatsappId).toBe(42);
  });

  it("recusa channelType desconhecido em vez de cair no Baileys", () => {
    // Cair num default silencioso mandaria a mensagem por um canal que o
    // operador não escolheu. Falhar alto é o comportamento correto (II.5).
    expect(() =>
      getChannelAdapter(conexao({ channelType: "telegram" }))
    ).toThrow();
  });

  it("expõe sendTyping no Baileys — a humanização anti-banimento depende disso", () => {
    expect(typeof getChannelAdapter(conexao()).sendTyping).toBe("function");
  });
});

describe("isCanalOficial", () => {
  it("classifica cloud_api e twilio como oficiais", () => {
    expect(isCanalOficial("cloud_api")).toBe(true);
    expect(isCanalOficial("twilio")).toBe(true);
  });

  it("NÃO classifica baileys como oficial", () => {
    expect(isCanalOficial("baileys")).toBe(false);
  });

  it("trata valor desconhecido como não-oficial", () => {
    // Conservador de propósito: na dúvida, não aplica as regras de canal
    // oficial (janela de 24h, template) a algo que não sabemos o que é.
    expect(isCanalOficial("")).toBe(false);
    expect(isCanalOficial("qualquer-coisa")).toBe(false);
  });
});
