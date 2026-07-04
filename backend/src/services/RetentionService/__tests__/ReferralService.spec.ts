/**
 * Testes unitários para ReferralService.utils.ts
 */

import {
  generateReferralCode,
  validateReferralRegistration,
  buildReferrerThanksMessage,
  buildReferredWelcomeMessage,
  REFERRAL_CODE_PREFIX
} from "../ReferralService.utils";

// ── generateReferralCode ──────────────────────────────────────────

describe("generateReferralCode", () => {
  it("retorna código com prefixo default", () => {
    const code = generateReferralCode();
    expect(code).toMatch(/^INDICA-/);
  });

  it("aceita prefixo customizado", () => {
    const code = generateReferralCode("MARIA");
    expect(code).toMatch(/^MARIA-/);
  });

  it("tem 6 caracteres após o prefixo", () => {
    const code = generateReferralCode();
    const part = code.split("-")[1];
    expect(part.length).toBe(6);
  });

  it("usa apenas caracteres do alfabeto seguro (sem 0, O, 1, I, L)", () => {
    for (let i = 0; i < 30; i++) {
      const code = generateReferralCode();
      const part = code.split("-")[1];
      expect(part).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("gera códigos diferentes em chamadas sucessivas", () => {
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(generateReferralCode());
    }
    // Com 100 amostras de espaço ~729M, esperamos zero colisões
    expect(codes.size).toBe(100);
  });

  it("REFERRAL_CODE_PREFIX exportado é 'INDICA'", () => {
    expect(REFERRAL_CODE_PREFIX).toBe("INDICA");
  });
});

// ── validateReferralRegistration ──────────────────────────────────

describe("validateReferralRegistration", () => {
  const validInput = {
    referrerContactId: 1,
    referredContactId: 2,
    referrerCompanyId: 1,
    referredCompanyId: 1
  };

  it("aceita registro válido", () => {
    const result = validateReferralRegistration(validInput);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("rejeita auto-indicação (mesmo ID)", () => {
    const result = validateReferralRegistration({
      ...validInput,
      referredContactId: 1
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("self_referral");
  });

  it("rejeita empresas diferentes", () => {
    const result = validateReferralRegistration({
      ...validInput,
      referredCompanyId: 2
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("different_companies");
  });

  it("rejeita referrerContactId ausente/zero", () => {
    expect(
      validateReferralRegistration({ ...validInput, referrerContactId: 0 }).reason
    ).toBe("missing_data");
  });

  it("rejeita referredContactId ausente", () => {
    expect(
      validateReferralRegistration({ ...validInput, referredContactId: 0 }).reason
    ).toBe("missing_data");
  });

  it("rejeita empresas ausentes", () => {
    expect(
      validateReferralRegistration({ ...validInput, referrerCompanyId: 0 }).reason
    ).toBe("missing_data");
    expect(
      validateReferralRegistration({ ...validInput, referredCompanyId: 0 }).reason
    ).toBe("missing_data");
  });

  it("é determinístico", () => {
    expect(validateReferralRegistration(validInput))
      .toEqual(validateReferralRegistration(validInput));
  });
});

// ── buildReferrerThanksMessage ────────────────────────────────────

describe("buildReferrerThanksMessage", () => {
  const baseParams = {
    contactName: "Maria",
    couponCode: "AMIGO-AB12",
    discountLabel: "20% OFF",
    validDays: 60,
    relatedContactName: "Ana"
  };

  it("contém nome do referrer", () => {
    expect(buildReferrerThanksMessage(baseParams)).toContain("Maria");
  });

  it("contém nome do amigo indicado", () => {
    expect(buildReferrerThanksMessage(baseParams)).toContain("Ana");
  });

  it("contém código do cupom", () => {
    expect(buildReferrerThanksMessage(baseParams)).toContain("AMIGO-AB12");
  });

  it("substitui {{name}}, {{amigo}}, {{coupon}}, {{discount}}, {{dias}}", () => {
    const msg = buildReferrerThanksMessage({
      ...baseParams,
      template: "{{name}} indicou {{amigo}}! Use {{coupon}} ({{discount}}) por {{dias}}d"
    });
    expect(msg).toBe("Maria indicou Ana! Use AMIGO-AB12 (20% OFF) por 60d");
  });

  it("adiciona cupom se template não tem placeholder", () => {
    const msg = buildReferrerThanksMessage({
      ...baseParams,
      template: "Obrigada {{name}}!"
    });
    expect(msg).toContain("AMIGO-AB12");
  });

  it("usa fallback 'seu amigo(a)' quando relatedContactName ausente", () => {
    const msg = buildReferrerThanksMessage({ ...baseParams, relatedContactName: undefined });
    expect(msg.toLowerCase()).toContain("amigo");
  });

  it("usa 'Cliente' quando contactName vazio", () => {
    const msg = buildReferrerThanksMessage({ ...baseParams, contactName: "" });
    expect(msg).toContain("Cliente");
  });

  it("é determinístico", () => {
    expect(buildReferrerThanksMessage(baseParams))
      .toBe(buildReferrerThanksMessage(baseParams));
  });
});

// ── buildReferredWelcomeMessage ────────────────────────────────────

describe("buildReferredWelcomeMessage", () => {
  const baseParams = {
    contactName: "Ana",
    couponCode: "AMIGO-XY34",
    discountLabel: "15% OFF",
    validDays: 30
  };

  it("dá boas-vindas usando o nome do indicado", () => {
    const msg = buildReferredWelcomeMessage(baseParams);
    expect(msg).toContain("Ana");
    expect(msg.toLowerCase()).toMatch(/bem-?vindo|bem-?vinda/);
  });

  it("contém código do cupom", () => {
    expect(buildReferredWelcomeMessage(baseParams)).toContain("AMIGO-XY34");
  });

  it("contém valor do desconto", () => {
    expect(buildReferredWelcomeMessage(baseParams)).toContain("15% OFF");
  });

  it("substitui placeholders no template", () => {
    const msg = buildReferredWelcomeMessage({
      ...baseParams,
      template: "Oi {{name}}, use {{cupom}} ({{desconto}}, {{dias}}d)"
    });
    expect(msg).toBe("Oi Ana, use AMIGO-XY34 (15% OFF, 30d)");
  });

  it("usa 'Cliente' quando contactName vazio", () => {
    const msg = buildReferredWelcomeMessage({ ...baseParams, contactName: "" });
    expect(msg).toContain("Cliente");
  });

  it("é determinístico", () => {
    expect(buildReferredWelcomeMessage(baseParams))
      .toBe(buildReferredWelcomeMessage(baseParams));
  });
});
