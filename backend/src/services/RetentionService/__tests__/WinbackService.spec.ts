/**
 * Testes unitários para WinbackService.utils.ts
 */

import {
  shouldAttemptWinback,
  buildWinbackMessage,
  DEFAULT_WINBACK_COOLDOWN_DAYS,
  WINBACK_STATUSES,
  WinbackDecisionInput
} from "../WinbackService.utils";

// ── Constantes ────────────────────────────────────────────────────

describe("Constantes", () => {
  it("DEFAULT_WINBACK_COOLDOWN_DAYS é 90", () => {
    expect(DEFAULT_WINBACK_COOLDOWN_DAYS).toBe(90);
  });

  it("WINBACK_STATUSES contém adormecido e perdido", () => {
    expect(WINBACK_STATUSES).toContain("adormecido");
    expect(WINBACK_STATUSES).toContain("perdido");
  });
});

// ── shouldAttemptWinback ──────────────────────────────────────────

describe("shouldAttemptWinback", () => {
  const baseInput: WinbackDecisionInput = {
    status: "perdido",
    lastAttemptAt: null,
    hasHistory: true
  };

  // Casos positivos

  it("dispara para 'perdido' sem tentativa prévia", () => {
    expect(shouldAttemptWinback(baseInput)).toBe(true);
  });

  it("dispara para 'adormecido' sem tentativa prévia", () => {
    expect(shouldAttemptWinback({ ...baseInput, status: "adormecido" })).toBe(true);
  });

  it("dispara após cooldown completo (91 dias)", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const lastAttempt = new Date("2026-02-17T12:00:00Z"); // 91 dias atrás
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 90, now)
    ).toBe(true);
  });

  it("dispara exatamente no cooldown (90 dias)", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const lastAttempt = new Date("2026-02-18T12:00:00Z"); // 90 dias atrás
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 90, now)
    ).toBe(true);
  });

  // Casos negativos: cooldown

  it("NÃO dispara dentro do cooldown (30 dias < 90)", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const lastAttempt = new Date("2026-04-19T12:00:00Z"); // 30 dias atrás
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 90, now)
    ).toBe(false);
  });

  it("NÃO dispara 1 dia antes do cooldown (89 dias)", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const lastAttempt = new Date("2026-02-19T12:00:00Z"); // 89 dias atrás
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 90, now)
    ).toBe(false);
  });

  // Casos negativos: status incorreto

  it("NÃO dispara para 'novo'", () => {
    expect(shouldAttemptWinback({ ...baseInput, status: "novo" })).toBe(false);
  });

  it("NÃO dispara para 'em_dia'", () => {
    expect(shouldAttemptWinback({ ...baseInput, status: "em_dia" })).toBe(false);
  });

  it("NÃO dispara para 'quase_na_hora'", () => {
    expect(shouldAttemptWinback({ ...baseInput, status: "quase_na_hora" })).toBe(false);
  });

  it("NÃO dispara para 'atrasado' (ainda na faixa preventiva)", () => {
    expect(shouldAttemptWinback({ ...baseInput, status: "atrasado" })).toBe(false);
  });

  // Casos negativos: sem histórico

  it("NÃO dispara sem histórico (cliente novo, nunca veio)", () => {
    expect(shouldAttemptWinback({ ...baseInput, hasHistory: false })).toBe(false);
  });

  // Cooldown customizado

  it("respeita cooldown customizado de 30 dias", () => {
    const now = new Date("2026-05-19T12:00:00Z");
    const lastAttempt = new Date("2026-04-30T12:00:00Z"); // 19 dias atrás

    // Com cooldown=30, ainda não passou
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 30, now)
    ).toBe(false);

    // Com cooldown=15, já passou
    expect(
      shouldAttemptWinback({ ...baseInput, lastAttemptAt: lastAttempt }, 15, now)
    ).toBe(true);
  });

  it("é determinístico", () => {
    expect(shouldAttemptWinback(baseInput)).toBe(shouldAttemptWinback(baseInput));
  });
});

// ── buildWinbackMessage ───────────────────────────────────────────

describe("buildWinbackMessage", () => {
  const baseParams = {
    contactName: "Maria",
    couponCode: "VOLTA-AB12",
    discountLabel: "20% OFF",
    validDays: 30
  };

  it("mensagem padrão contém nome, cupom, desconto e validade", () => {
    const msg = buildWinbackMessage(baseParams);
    expect(msg).toContain("Maria");
    expect(msg).toContain("VOLTA-AB12");
    expect(msg).toContain("20% OFF");
    expect(msg).toContain("30");
  });

  it("substitui {{name}} no template", () => {
    const msg = buildWinbackMessage({
      ...baseParams,
      template: "Oi {{name}}, volte!"
    });
    expect(msg).toContain("Maria");
  });

  it("substitui {{coupon}}, {{cupom}}, {{discount}}, {{desconto}}, {{dias}}", () => {
    const msg = buildWinbackMessage({
      ...baseParams,
      template: "{{name}} {{coupon}} {{cupom}} {{discount}} {{desconto}} {{dias}}"
    });
    expect(msg).toBe("Maria VOLTA-AB12 VOLTA-AB12 20% OFF 20% OFF 30");
  });

  it("adiciona cupom se template não tem placeholder", () => {
    const msg = buildWinbackMessage({
      ...baseParams,
      template: "Volte {{name}}!"
    });
    expect(msg).toContain("VOLTA-AB12");
  });

  it("não duplica cupom se template já tem placeholder", () => {
    const msg = buildWinbackMessage({
      ...baseParams,
      template: "Use {{coupon}}"
    });
    expect((msg.match(/VOLTA-AB12/g) || []).length).toBe(1);
  });

  it("usa 'Cliente' quando nome é vazio", () => {
    const msg = buildWinbackMessage({ ...baseParams, contactName: "" });
    expect(msg).toContain("Cliente");
  });

  it("template vazio cai no fallback", () => {
    const msg = buildWinbackMessage({ ...baseParams, template: "  " });
    expect(msg).toContain("Maria");
  });

  it("é determinístico", () => {
    expect(buildWinbackMessage(baseParams)).toBe(buildWinbackMessage(baseParams));
  });
});
