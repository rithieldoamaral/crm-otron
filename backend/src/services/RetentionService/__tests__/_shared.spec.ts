/**
 * Testes unitários do helper compartilhado RetentionService/_shared.ts
 *
 * Foca nas funções puras (sem I/O):
 *   - addDays
 *   - isWithinFireWindow (timezone-aware — fix do BUG B3)
 *   - formatDiscountLabel
 *   - safeCouponDiscountType
 *
 * As funções com I/O (getActiveWhatsapp, getCompanyTimezone) ficam
 * cobertas indiretamente via testes de integração dos serviços.
 */

import {
  addDays,
  isWithinFireWindow,
  formatDiscountLabel,
  safeCouponDiscountType,
  FIRE_WINDOW_MINUTES,
  DEFAULT_TIMEZONE
} from "../_shared.utils";

// ── Constantes ────────────────────────────────────────────────────

describe("Constantes default", () => {
  it("FIRE_WINDOW_MINUTES é 2", () => {
    expect(FIRE_WINDOW_MINUTES).toBe(2);
  });

  it("DEFAULT_TIMEZONE é America/Sao_Paulo", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Sao_Paulo");
  });
});

// ── addDays ────────────────────────────────────────────────────────

describe("addDays", () => {
  it("adiciona dias positivos", () => {
    const base = new Date("2026-05-19T12:00:00Z");
    const result = addDays(base, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-24");
  });

  it("adiciona zero dias retorna data igual (mas instância diferente)", () => {
    const base = new Date("2026-05-19T12:00:00Z");
    const result = addDays(base, 0);
    expect(result.getTime()).toBe(base.getTime());
    expect(result).not.toBe(base); // imutabilidade
  });

  it("aceita dias negativos (subtrai)", () => {
    const base = new Date("2026-05-19T12:00:00Z");
    const result = addDays(base, -3);
    expect(result.toISOString().slice(0, 10)).toBe("2026-05-16");
  });

  it("atravessa fronteira de mês", () => {
    const base = new Date("2026-01-30T12:00:00Z");
    const result = addDays(base, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-02-04");
  });

  it("NÃO muta a data original", () => {
    const base = new Date("2026-05-19T12:00:00Z");
    addDays(base, 100);
    expect(base.toISOString().slice(0, 10)).toBe("2026-05-19");
  });
});

// ── isWithinFireWindow (BUG-FIX B3) ────────────────────────────────

describe("isWithinFireWindow — timezone-aware", () => {
  it("retorna true quando 'now' (UTC) corresponde ao horário BR configurado", () => {
    // Admin configurou 09:00 BR. now = 12:00 UTC = 09:00 BR (UTC-3 sem horário de verão)
    const now = new Date("2026-05-19T12:00:00Z");
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(true);
  });

  it("retorna true dentro da janela de tolerância (09:01)", () => {
    const now = new Date("2026-05-19T12:01:00Z");
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(true);
  });

  it("retorna true na borda exata da janela (09:02 com FIRE_WINDOW_MINUTES=2)", () => {
    const now = new Date("2026-05-19T12:02:00Z");
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(true);
  });

  it("retorna false 3 minutos depois (fora da janela)", () => {
    const now = new Date("2026-05-19T12:03:00Z");
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(false);
  });

  it("retorna false antes do horário configurado", () => {
    const now = new Date("2026-05-19T11:59:00Z"); // 08:59 BR
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(false);
  });

  it("BUG B3 regressão: NÃO dispara em 09:00 UTC quando configurado para 09:00 BR", () => {
    // Cenário do bug original: servidor em UTC, admin configura "09:00" pensando em BR.
    // Em 09:00 UTC (=06:00 BR), a versão antiga disparava. Agora deve retornar false.
    const now = new Date("2026-05-19T09:00:00Z");
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now)).toBe(false);
  });

  it("respeita timezone diferente (UTC literal)", () => {
    const now = new Date("2026-05-19T09:00:00Z");
    expect(isWithinFireWindow("09:00", "UTC", now)).toBe(true);
  });

  it("janela customizada respeitada", () => {
    const now = new Date("2026-05-19T12:05:00Z"); // 09:05 BR
    // Com janela=10, ainda está dentro
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now, 10)).toBe(true);
    // Com janela=2 (default), está fora
    expect(isWithinFireWindow("09:00", "America/Sao_Paulo", now, 2)).toBe(false);
  });

  it("formato HH:mm com 1 dígito (9:00 vs 09:00) é tolerado", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    expect(isWithinFireWindow("9:00", "America/Sao_Paulo", now)).toBe(true);
  });

  it("é determinístico para mesmos argumentos", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const a = isWithinFireWindow("09:00", "America/Sao_Paulo", now);
    const b = isWithinFireWindow("09:00", "America/Sao_Paulo", now);
    expect(a).toBe(b);
  });
});

// ── formatDiscountLabel ────────────────────────────────────────────

describe("formatDiscountLabel", () => {
  it("percent → 'X% OFF'", () => {
    expect(formatDiscountLabel("percent", 20)).toBe("20% OFF");
  });

  it("fixed → 'R$ X.XX OFF'", () => {
    expect(formatDiscountLabel("fixed", 50)).toBe("R$ 50.00 OFF");
  });

  it("fixed com decimais", () => {
    expect(formatDiscountLabel("fixed", 49.9)).toBe("R$ 49.90 OFF");
  });

  it("free_service → 'SERVIÇO GRÁTIS'", () => {
    expect(formatDiscountLabel("free_service", 0)).toBe("SERVIÇO GRÁTIS");
  });

  it("é determinístico", () => {
    expect(formatDiscountLabel("percent", 10)).toBe(formatDiscountLabel("percent", 10));
  });
});

// ── safeCouponDiscountType ─────────────────────────────────────────

describe("safeCouponDiscountType", () => {
  it("aceita 'percent'", () => {
    expect(safeCouponDiscountType("percent")).toBe("percent");
  });

  it("aceita 'fixed'", () => {
    expect(safeCouponDiscountType("fixed")).toBe("fixed");
  });

  it("aceita 'free_service'", () => {
    expect(safeCouponDiscountType("free_service")).toBe("free_service");
  });

  it("fallback para default em valor inválido", () => {
    expect(safeCouponDiscountType("invalid")).toBe("percent");
  });

  it("fallback em undefined", () => {
    expect(safeCouponDiscountType(undefined)).toBe("percent");
  });

  it("respeita fallback customizado", () => {
    expect(safeCouponDiscountType("invalid", "fixed")).toBe("fixed");
  });
});
