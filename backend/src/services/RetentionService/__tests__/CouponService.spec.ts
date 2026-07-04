/**
 * Testes TDD para CouponService.utils — lógica pura.
 *
 * Foco:
 *   - `generateCode`           — formato, unicidade, prefixos
 *   - `validateCouponDecision` — todas as combinações de estado do cupom
 *
 * A camada de I/O (createCoupon, redeemCoupon, etc.) depende de Sequelize
 * e é coberta por testes de integração em staging.
 */

import { generateCode, validateCouponDecision } from "../CouponService.utils";

// ── Helpers ────────────────────────────────────────────────────────

const daysFromNow = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

const makeCoupon = (overrides: Partial<{
  redeemedAt: Date | null;
  validFrom: Date;
  validUntil: Date;
}> = {}) => ({
  redeemedAt: null,
  validFrom: daysFromNow(-1),   // aberto desde ontem
  validUntil: daysFromNow(30),  // válido por 30 dias
  ...overrides
});

// ── generateCode ────────────────────────────────────────────────────

describe("generateCode — formato e estrutura", () => {
  it("retorna string no formato PREFIX-XXXX-XXXX", () => {
    const code = generateCode("ANIVER");
    // Formato: ANIVER-4chars-4chars
    expect(code).toMatch(/^ANIVER-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("usa prefixo 'CUPOM' por default quando não informado", () => {
    const code = generateCode();
    expect(code).toMatch(/^CUPOM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("converte prefixo para maiúsculas automaticamente", () => {
    const code = generateCode("aniver");
    expect(code).toMatch(/^ANIVER-/);
  });

  it("trunca prefixo em 12 caracteres para manter código legível", () => {
    const longPrefix = "MUITOLONGODEMAIS"; // 16 chars
    const code = generateCode(longPrefix);
    const parts = code.split("-");
    expect(parts[0].length).toBeLessThanOrEqual(12);
  });

  it("não usa caracteres ambíguos (O, I, L, 0, 1) no código", () => {
    // Gerar 50 códigos e verificar que nenhum contém caracteres ambíguos
    const AMBIGUOUS = /[OIL01]/;
    for (let i = 0; i < 50; i++) {
      const code = generateCode("TEST");
      const randomParts = code.replace(/^[^-]+-/, ""); // remove o prefix
      expect(randomParts).not.toMatch(AMBIGUOUS);
    }
  });

  it("gera códigos diferentes em chamadas consecutivas (unicidade probabilística)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateCode("TEST"));
    }
    // 20 chamadas devem gerar 20 códigos únicos
    expect(codes.size).toBe(20);
  });

  it("prefixo com números e letras é aceito", () => {
    const code = generateCode("FIDEO50");
    expect(code).toMatch(/^FIDEO50-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("prefixo vazio resulta em segmento vazio antes do primeiro traço", () => {
    const code = generateCode("");
    // "" sanitizado vira "" → "-XXXX-XXXX"
    expect(code).toMatch(/^-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

// ── validateCouponDecision — casos de TRUE (válido) ─────────────────

describe("validateCouponDecision — casos VÁLIDOS", () => {
  it("retorna valid=true para cupom ativo sem restrições", () => {
    const result = validateCouponDecision(makeCoupon());
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("válido no PRIMEIRO segundo de validade (validFrom inclusivo)", () => {
    const now = new Date("2026-05-19T10:00:00.000Z");
    const coupon = makeCoupon({
      validFrom: new Date("2026-05-19T10:00:00.000Z"),
      validUntil: new Date("2026-06-19T10:00:00.000Z")
    });
    const result = validateCouponDecision(coupon, now);
    expect(result.valid).toBe(true);
  });

  it("válido no ÚLTIMO segundo de validade (validUntil inclusivo)", () => {
    const now = new Date("2026-06-18T23:59:59.999Z");
    const coupon = makeCoupon({
      validFrom: new Date("2026-05-19T00:00:00.000Z"),
      validUntil: new Date("2026-06-18T23:59:59.999Z")
    });
    const result = validateCouponDecision(coupon, now);
    expect(result.valid).toBe(true);
  });
});

// ── validateCouponDecision — casos de FALSE (inválido) ──────────────

describe("validateCouponDecision — casos INVÁLIDOS", () => {
  it("invalid quando já foi resgatado (redeemedAt preenchido)", () => {
    const coupon = makeCoupon({ redeemedAt: daysFromNow(-1) });
    const result = validateCouponDecision(coupon);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("already_redeemed");
  });

  it("invalid quando ainda não começou a valer", () => {
    const coupon = makeCoupon({
      validFrom: daysFromNow(5),    // começa daqui 5 dias
      validUntil: daysFromNow(35)
    });
    const result = validateCouponDecision(coupon);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_yet_valid");
  });

  it("invalid quando já expirou", () => {
    const coupon = makeCoupon({
      validFrom: daysFromNow(-30),
      validUntil: daysFromNow(-1)   // expirou ontem
    });
    const result = validateCouponDecision(coupon);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("already_redeemed tem prioridade sobre expired", () => {
    // Cupom resgatado E expirado → deve retornar already_redeemed (regra 1 vem antes)
    const coupon = makeCoupon({
      redeemedAt: daysFromNow(-10),
      validFrom: daysFromNow(-30),
      validUntil: daysFromNow(-5)
    });
    const result = validateCouponDecision(coupon);
    expect(result.reason).toBe("already_redeemed");
  });

  it("already_redeemed tem prioridade sobre not_yet_valid", () => {
    // Cupom resgatado mas validFrom ainda no futuro (edge case de dado inconsistente)
    const coupon = makeCoupon({
      redeemedAt: daysFromNow(-1),
      validFrom: daysFromNow(10),
      validUntil: daysFromNow(40)
    });
    const result = validateCouponDecision(coupon);
    expect(result.reason).toBe("already_redeemed");
  });

  it("expired 1ms após validUntil", () => {
    const validUntil = new Date("2026-05-18T23:59:59.999Z");
    const now = new Date("2026-05-19T00:00:00.000Z"); // 1ms depois
    const coupon = makeCoupon({
      validFrom: new Date("2026-05-01T00:00:00.000Z"),
      validUntil
    });
    const result = validateCouponDecision(coupon, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("not_yet_valid 1ms antes de validFrom", () => {
    const validFrom = new Date("2026-05-19T10:00:00.000Z");
    const now = new Date("2026-05-19T09:59:59.999Z"); // 1ms antes
    const coupon = makeCoupon({
      validFrom,
      validUntil: new Date("2026-06-19T10:00:00.000Z")
    });
    const result = validateCouponDecision(coupon, now);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_yet_valid");
  });
});

// ── validateCouponDecision — determinismo e pureza ───────────────────

describe("validateCouponDecision — pureza e edge cases", () => {
  it("é determinística com mesmo now (mesmo resultado em chamadas repetidas)", () => {
    const coupon = makeCoupon();
    const now = new Date();
    expect(validateCouponDecision(coupon, now)).toEqual(
      validateCouponDecision(coupon, now)
    );
  });

  it("não muta o objeto cupom passado", () => {
    const coupon = makeCoupon();
    const before = { ...coupon };
    validateCouponDecision(coupon);
    expect(coupon).toEqual(before);
  });
});
