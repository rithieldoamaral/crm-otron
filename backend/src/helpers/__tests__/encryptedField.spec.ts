/**
 * Testes do helper de criptografia de campo em repouso.
 *
 * Por que existe (CLAUDE.md XV.6): `channelConfig` guarda token permanente da
 * Meta e Auth Token da Twilio. São credenciais de TERCEIRO — se vazarem, o
 * atacante envia mensagem em nome do cliente e consome a cota paga dele.
 * A regra é explícita: "criptografados em repouso, acesso restrito, jamais em
 * log".
 *
 * O teste mais importante aqui é o do IV aleatório: cifra determinística
 * (mesmo texto → mesmo ciphertext) vaza informação por comparação, permitindo
 * a quem lê o banco saber que duas empresas usam a MESMA credencial sem
 * precisar decifrar nada.
 */

import { encryptField, decryptField, maskSecret } from "../encryptedField";

process.env.CHANNEL_CONFIG_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryptedField", () => {
  describe("ida e volta", () => {
    it("decifra de volta o texto original", () => {
      const original = "EAAG1234tokenPermanenteDaMeta";

      expect(decryptField(encryptField(original))).toBe(original);
    });

    it("preserva JSON completo, que é o uso real do channelConfig", () => {
      const config = JSON.stringify({
        phoneNumberId: "123456789",
        wabaId: "987654321",
        accessToken: "EAAG1234",
        appSecret: "abcdef"
      });

      expect(JSON.parse(decryptField(encryptField(config)))).toEqual(
        JSON.parse(config)
      );
    });

    it("preserva acentuação e emoji sem corromper bytes", () => {
      const original = "credencial da ação — çãõ 🔐";

      expect(decryptField(encryptField(original))).toBe(original);
    });
  });

  describe("segurança", () => {
    it("NÃO é determinístico: o mesmo texto gera ciphertexts diferentes", () => {
      const texto = "mesma-credencial";

      // Se estes fossem iguais, bastaria comparar duas linhas do banco para
      // descobrir que duas empresas usam a mesma credencial.
      expect(encryptField(texto)).not.toBe(encryptField(texto));
    });

    it("o texto puro não aparece no valor cifrado", () => {
      const segredo = "TOKEN_SUPER_SECRETO_123";

      expect(encryptField(segredo)).not.toContain(segredo);
    });

    it("rejeita ciphertext adulterado em vez de devolver lixo", () => {
      const cifrado = encryptField("credencial");
      // Vira um caractere no meio: o GCM tem tag de autenticação, então
      // adulteração precisa FALHAR, não decifrar silenciosamente errado.
      const adulterado =
        cifrado.slice(0, -6) +
        (cifrado.slice(-6, -5) === "A" ? "B" : "A") +
        cifrado.slice(-5);

      expect(() => decryptField(adulterado)).toThrow();
    });

    it("rejeita entrada que não é ciphertext válido", () => {
      expect(() => decryptField("nao-e-cifrado")).toThrow();
    });
  });

  describe("entradas vazias", () => {
    it("cifrar vazio devolve vazio, sem estourar", () => {
      expect(encryptField("")).toBe("");
    });

    it("decifrar vazio/nulo devolve vazio, sem estourar", () => {
      expect(decryptField("")).toBe("");
      expect(decryptField(null)).toBe("");
      expect(decryptField(undefined)).toBe("");
    });
  });

  describe("maskSecret", () => {
    it("mostra só os últimos 4 caracteres", () => {
      expect(maskSecret("EAAG1234567890abcd")).toBe("••••abcd");
    });

    it("mascara por completo segredo curto demais para revelar sufixo", () => {
      // Com 4 caracteres ou menos, mostrar "os últimos 4" seria mostrar tudo.
      expect(maskSecret("abcd")).toBe("••••");
      expect(maskSecret("ab")).toBe("••••");
    });

    it("devolve vazio para ausente, para a UI distinguir 'não configurado'", () => {
      expect(maskSecret("")).toBe("");
      expect(maskSecret(null)).toBe("");
      expect(maskSecret(undefined)).toBe("");
    });
  });
});
