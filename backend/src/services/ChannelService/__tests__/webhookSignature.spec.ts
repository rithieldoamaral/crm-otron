/**
 * Testes de verificação de assinatura de webhook.
 *
 * Por que este é o teste mais importante da Fase 3: a rota de webhook é PÚBLICA
 * — a Meta precisa alcançá-la sem JWT. A assinatura é a ÚNICA barreira entre
 * "mensagem real do cliente" e "qualquer um na internet injetando conversa no
 * CRM de qualquer empresa".
 *
 * Os testes de ausência (sem assinatura, sem segredo, sem corpo) existem porque
 * é exatamente ali que implementações erram: uma verificação que devolve `true`
 * quando não consegue conferir é pior que não ter verificação nenhuma, porque
 * dá a impressão de estar protegido.
 */

import crypto from "crypto";

import {
  verificarAssinaturaMeta,
  conferirVerifyToken
} from "../webhookSignature";

const SEGREDO = "app-secret-de-teste";
const CORPO = JSON.stringify({ entry: [{ id: "123" }] });

/** Gera a assinatura que a Meta enviaria para um dado corpo. */
const assinar = (corpo: string, segredo = SEGREDO) =>
  `sha256=${crypto.createHmac("sha256", segredo).update(corpo).digest("hex")}`;

describe("verificarAssinaturaMeta", () => {
  it("aceita assinatura correta", () => {
    expect(verificarAssinaturaMeta(CORPO, assinar(CORPO), SEGREDO)).toBe(true);
  });

  it("REJEITA quando o corpo foi alterado", () => {
    // O cenário do ataque: assinatura válida capturada de outra requisição,
    // colada num corpo diferente.
    const assinaturaDoOriginal = assinar(CORPO);
    const corpoAdulterado = JSON.stringify({ entry: [{ id: "999" }] });

    expect(
      verificarAssinaturaMeta(corpoAdulterado, assinaturaDoOriginal, SEGREDO)
    ).toBe(false);
  });

  it("REJEITA assinatura gerada com outro segredo", () => {
    expect(
      verificarAssinaturaMeta(CORPO, assinar(CORPO, "segredo-errado"), SEGREDO)
    ).toBe(false);
  });

  it("REJEITA quando não há assinatura", () => {
    expect(verificarAssinaturaMeta(CORPO, undefined, SEGREDO)).toBe(false);
    expect(verificarAssinaturaMeta(CORPO, "", SEGREDO)).toBe(false);
  });

  it("REJEITA quando o app secret não está configurado", () => {
    // Conexão mal configurada não pode virar porta aberta: sem segredo,
    // é impossível conferir, então nega.
    expect(verificarAssinaturaMeta(CORPO, assinar(CORPO), undefined)).toBe(
      false
    );
    expect(verificarAssinaturaMeta(CORPO, assinar(CORPO), "")).toBe(false);
  });

  it("REJEITA quando o corpo bruto não chegou", () => {
    expect(verificarAssinaturaMeta(undefined, assinar(CORPO), SEGREDO)).toBe(
      false
    );
  });

  it("REJEITA assinatura sem o prefixo sha256=", () => {
    const semPrefixo = assinar(CORPO).replace("sha256=", "");

    expect(verificarAssinaturaMeta(CORPO, semPrefixo, SEGREDO)).toBe(false);
  });

  it("REJEITA assinatura de tamanho diferente sem estourar", () => {
    // timingSafeEqual lança se os buffers tiverem tamanhos distintos; a
    // checagem de tamanho precisa vir antes, senão o erro derruba a rota.
    expect(() =>
      verificarAssinaturaMeta(CORPO, "sha256=abcd", SEGREDO)
    ).not.toThrow();

    expect(verificarAssinaturaMeta(CORPO, "sha256=abcd", SEGREDO)).toBe(false);
  });

  it("aceita corpo como Buffer, que é como o express entrega o rawBody", () => {
    const buf = Buffer.from(CORPO, "utf8");

    expect(verificarAssinaturaMeta(buf, assinar(CORPO), SEGREDO)).toBe(true);
  });
});

describe("conferirVerifyToken", () => {
  it("aceita token idêntico", () => {
    expect(conferirVerifyToken("tk-123", "tk-123")).toBe(true);
  });

  it("rejeita token diferente", () => {
    expect(conferirVerifyToken("tk-123", "tk-456")).toBe(false);
  });

  it("rejeita ausência dos dois lados", () => {
    // Sem isto, uma conexão sem verifyToken cadastrado aceitaria o handshake
    // de qualquer um — e o webhook seria registrado no app de terceiro.
    expect(conferirVerifyToken(undefined, "tk")).toBe(false);
    expect(conferirVerifyToken("tk", undefined)).toBe(false);
    expect(conferirVerifyToken("", "")).toBe(false);
  });

  it("rejeita tamanhos diferentes sem estourar", () => {
    expect(() => conferirVerifyToken("curto", "bem-mais-longo")).not.toThrow();
    expect(conferirVerifyToken("curto", "bem-mais-longo")).toBe(false);
  });
});
