import { encryptToken, decryptToken } from "../tokenCrypto";

describe("tokenCrypto", () => {
  beforeAll(() => {
    process.env.CALENDAR_TOKEN_SECRET = "test_secret_do_not_use_in_production_please";
  });

  it("roundtrip: encrypt → decrypt retorna o plaintext original", () => {
    const plaintext = "ya29.a0AfH6SMBx-exemplo-de-access-token-longo-12345";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("gera ciphertexts diferentes para o mesmo plaintext (salt + IV aleatórios)", () => {
    const plaintext = "mesmo_token";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("formato esperado: três partes separadas por ':' (salt:iv:ciphertext)", () => {
    const encrypted = encryptToken("qualquer_coisa");
    expect(encrypted.split(":")).toHaveLength(3);
  });

  it("rejeita ciphertext adulterado", () => {
    const encrypted = encryptToken("payload");
    // Inverte os 2 últimos caracteres do hex → corrompe
    const tampered = encrypted.slice(0, -2) + (encrypted.slice(-2) === "00" ? "ff" : "00");
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("decripta tokens longos (refresh tokens podem ter 200+ caracteres)", () => {
    const longToken = "1//0a".padEnd(300, "x");
    const encrypted = encryptToken(longToken);
    expect(decryptToken(encrypted)).toBe(longToken);
  });

  it("decripta caracteres especiais sem perda", () => {
    const special = "token-com-çarácteres-especiais-🔐-end";
    const encrypted = encryptToken(special);
    expect(decryptToken(encrypted)).toBe(special);
  });
});
