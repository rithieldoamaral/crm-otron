/**
 * Testes TDD para phoneMatch — canonicalização de telefone com tolerância
 * ao 9º dígito brasileiro (causa-raiz do ticket #22, 2026-06-28).
 */

import { canonicalizePhone, phonesMatch } from "../phoneMatch";

describe("canonicalizePhone", () => {
  it("reduz celular BR de 13 díg (com 9) à forma de 12 díg (sem 9)", () => {
    // 55 + 48 + 9 + 88368758  →  55 + 48 + 88368758
    expect(canonicalizePhone("5548988368758")).toBe("554888368758");
  });

  it("mantém celular BR de 12 díg (já sem o 9) inalterado", () => {
    expect(canonicalizePhone("554888368758")).toBe("554888368758");
  });

  it("prepend 55 quando vem só DDD + 9 + número (11 díg)", () => {
    // 48 + 9 + 88368758  →  55 + 48 + 88368758 (após remover o 9)
    expect(canonicalizePhone("48988368758")).toBe("554888368758");
  });

  it("prepend 55 quando vem só DDD + número sem 9 (10 díg)", () => {
    expect(canonicalizePhone("4888368758")).toBe("554888368758");
  });

  it("remove sufixo de JID (@s.whatsapp.net)", () => {
    expect(canonicalizePhone("554888368758@s.whatsapp.net")).toBe("554888368758");
  });

  it("remove máscara, espaços e + do cadastro", () => {
    expect(canonicalizePhone("+55 (48) 98836-8758")).toBe("554888368758");
  });

  it("NÃO transforma número internacional (Portugal, 12 díg começando 351)", () => {
    expect(canonicalizePhone("351937203522")).toBe("351937203522");
  });

  it("string vazia/nula vira string vazia", () => {
    expect(canonicalizePhone("")).toBe("");
    expect(canonicalizePhone(undefined)).toBe("");
    expect(canonicalizePhone(null)).toBe("");
  });
});

describe("phonesMatch", () => {
  it("casa cadastro com 9 vs JID sem 9 (o bug do ticket #22)", () => {
    expect(phonesMatch("5548988368758", "554888368758")).toBe(true);
  });

  it("casa cadastro só com DDD+número vs JID completo", () => {
    expect(phonesMatch("48988368758", "554888368758@s.whatsapp.net")).toBe(true);
  });

  it("NÃO casa números diferentes (segurança preservada)", () => {
    expect(phonesMatch("5548988368758", "5511000000000")).toBe(false);
  });

  it("NÃO casa quando um dos lados é vazio", () => {
    expect(phonesMatch("", "554888368758")).toBe(false);
    expect(phonesMatch("554888368758", "")).toBe(false);
  });
});
