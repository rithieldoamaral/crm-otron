import { signState, verifyState } from "../oauthState";

describe("oauthState", () => {
  beforeAll(() => {
    process.env.CALENDAR_TOKEN_SECRET = "test_secret_do_not_use_in_production";
  });

  it("roundtrip: sign → verify retorna o payload original", () => {
    const signed = signState({ userId: 42, companyId: 7 });
    const result = verifyState(signed);
    expect(result).toEqual({ userId: 42, companyId: 7 });
  });

  it("rejeita state adulterado (payload modificado)", () => {
    const signed = signState({ userId: 42, companyId: 7 });
    // Modifica um caractere do payload (parte antes do ponto)
    const [payload, sig] = signed.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ userId: 999, companyId: 999 })
    ).toString("base64url") + "." + sig;

    expect(() => verifyState(tampered)).toThrow(/invalid state signature/i);
  });

  it("rejeita state sem assinatura (formato antigo/malicioso)", () => {
    const unsigned = Buffer.from(
      JSON.stringify({ userId: 42, companyId: 7 })
    ).toString("base64url");
    expect(() => verifyState(unsigned)).toThrow(/malformed state/i);
  });

  it("rejeita state vazio ou null", () => {
    expect(() => verifyState("")).toThrow();
    expect(() => verifyState(null as any)).toThrow();
  });

  it("gera assinaturas diferentes para payloads diferentes", () => {
    const a = signState({ userId: 1, companyId: 1 });
    const b = signState({ userId: 2, companyId: 1 });
    expect(a).not.toBe(b);
  });

  it("gera mesma assinatura para mesmo payload (determinístico, sem nonce)", () => {
    // Por enquanto determinístico — não usamos nonce/timestamp pois OAuth state
    // é validado só uma vez (code é single-use). Se virar async/queued, adicionar nonce.
    const a = signState({ userId: 42, companyId: 7 });
    const b = signState({ userId: 42, companyId: 7 });
    expect(a).toBe(b);
  });
});
