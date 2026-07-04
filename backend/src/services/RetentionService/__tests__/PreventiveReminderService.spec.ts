/**
 * Testes unitários para PreventiveReminderService.utils.ts
 *
 * Isolados de I/O: testam apenas a lógica pura de decisão e mensagem.
 */

import {
  shouldFirePreventive,
  buildPreventiveMessage,
  DEFAULT_PREVENTIVE_THRESHOLD,
  DEFAULT_PREVENTIVE_CEILING,
  PreventiveDecisionInput
} from "../PreventiveReminderService.utils";

// ── Constantes ────────────────────────────────────────────────────

describe("Constantes default", () => {
  it("DEFAULT_PREVENTIVE_THRESHOLD é 0.8", () => {
    expect(DEFAULT_PREVENTIVE_THRESHOLD).toBe(0.8);
  });

  it("DEFAULT_PREVENTIVE_CEILING é 1.0", () => {
    expect(DEFAULT_PREVENTIVE_CEILING).toBe(1.0);
  });
});

// ── shouldFirePreventive ──────────────────────────────────────────

describe("shouldFirePreventive", () => {
  const baseInput: PreventiveDecisionInput = {
    status: "quase_na_hora",
    ratio: 0.85,
    alreadyTouchedThisCycle: false,
    totalServices: 3
  };

  // Casos positivos (DEVE disparar)

  it("dispara quando status=quase_na_hora, ratio=0.85, sem toque prévio, 3+ serviços", () => {
    expect(shouldFirePreventive(baseInput)).toBe(true);
  });

  it("dispara no limite mínimo (ratio = threshold)", () => {
    expect(shouldFirePreventive({ ...baseInput, ratio: 0.8 })).toBe(true);
  });

  it("dispara logo abaixo do teto (ratio = 0.99)", () => {
    expect(shouldFirePreventive({ ...baseInput, ratio: 0.99 })).toBe(true);
  });

  // Casos negativos: já disparado

  it("NÃO dispara se já disparou neste ciclo", () => {
    expect(shouldFirePreventive({ ...baseInput, alreadyTouchedThisCycle: true })).toBe(false);
  });

  // Casos negativos: histórico insuficiente

  it("NÃO dispara para cliente com menos de 2 serviços (sem intervalo médio confiável)", () => {
    expect(shouldFirePreventive({ ...baseInput, totalServices: 1 })).toBe(false);
  });

  it("NÃO dispara para cliente sem nenhum serviço", () => {
    expect(shouldFirePreventive({ ...baseInput, totalServices: 0 })).toBe(false);
  });

  // Casos negativos: status incorreto

  it("NÃO dispara se status=novo", () => {
    expect(shouldFirePreventive({ ...baseInput, status: "novo" })).toBe(false);
  });

  it("NÃO dispara se status=em_dia (ratio ainda baixo)", () => {
    expect(shouldFirePreventive({ ...baseInput, status: "em_dia", ratio: 0.5 })).toBe(false);
  });

  it("NÃO dispara se status=atrasado (já passou da janela preventiva)", () => {
    expect(shouldFirePreventive({ ...baseInput, status: "atrasado", ratio: 1.2 })).toBe(false);
  });

  it("NÃO dispara se status=adormecido", () => {
    expect(shouldFirePreventive({ ...baseInput, status: "adormecido", ratio: 1.6 })).toBe(false);
  });

  it("NÃO dispara se status=perdido", () => {
    expect(shouldFirePreventive({ ...baseInput, status: "perdido", ratio: 2.5 })).toBe(false);
  });

  // Casos negativos: ratio fora da janela

  it("NÃO dispara se ratio abaixo do threshold (0.7)", () => {
    expect(shouldFirePreventive({ ...baseInput, ratio: 0.7 })).toBe(false);
  });

  it("NÃO dispara se ratio atinge o teto (1.0)", () => {
    expect(shouldFirePreventive({ ...baseInput, ratio: 1.0 })).toBe(false);
  });

  // Threshold customizado

  it("respeita threshold customizado (0.9)", () => {
    expect(shouldFirePreventive({ ...baseInput, ratio: 0.85 }, 0.9)).toBe(false);
    expect(shouldFirePreventive({ ...baseInput, ratio: 0.92 }, 0.9)).toBe(true);
  });

  // Determinismo

  it("é determinístico para mesmas entradas", () => {
    expect(shouldFirePreventive(baseInput)).toBe(shouldFirePreventive(baseInput));
  });
});

// ── buildPreventiveMessage ────────────────────────────────────────

describe("buildPreventiveMessage", () => {
  it("usa mensagem padrão quando não há template", () => {
    const msg = buildPreventiveMessage({ contactName: "Maria", daysSinceLastService: 25 });
    expect(msg).toContain("Maria");
    expect(msg).toContain("25");
  });

  it("substitui {{name}} pelo nome do contato", () => {
    const msg = buildPreventiveMessage({
      contactName: "João",
      template: "Olá {{name}}, sentimos sua falta!",
      daysSinceLastService: 30
    });
    expect(msg).toBe("Olá João, sentimos sua falta!");
  });

  it("substitui variante portuguesa {{nome}}", () => {
    const msg = buildPreventiveMessage({
      contactName: "Ana",
      template: "Oi {{nome}}, que tal voltar?",
      daysSinceLastService: 20
    });
    expect(msg).toBe("Oi Ana, que tal voltar?");
  });

  it("substitui {{dias}} pelo número de dias", () => {
    const msg = buildPreventiveMessage({
      contactName: "Pedro",
      template: "Faz {{dias}} dias, {{name}}!",
      daysSinceLastService: 45
    });
    expect(msg).toBe("Faz 45 dias, Pedro!");
  });

  it("usa fallback 'Cliente' quando nome é vazio", () => {
    const msg = buildPreventiveMessage({
      contactName: "",
      template: "Olá {{name}}!",
      daysSinceLastService: 10
    });
    expect(msg).toBe("Olá Cliente!");
  });

  it("usa fallback 'Cliente' quando nome é null/undefined", () => {
    const msg = buildPreventiveMessage({
      contactName: null as any,
      daysSinceLastService: 10
    });
    expect(msg).toContain("Cliente");
  });

  it("template vazio gera mensagem padrão", () => {
    const msg = buildPreventiveMessage({
      contactName: "Maria",
      template: "   ",
      daysSinceLastService: 15
    });
    expect(msg).toContain("Maria");
    expect(msg).toContain("15");
  });

  it("é determinístico", () => {
    const params = { contactName: "X", daysSinceLastService: 5 };
    expect(buildPreventiveMessage(params)).toBe(buildPreventiveMessage(params));
  });
});
