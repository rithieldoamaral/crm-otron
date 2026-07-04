/**
 * Testes unitários para LoyaltyService.utils.ts
 */

import {
  parseMilestones,
  getNewlyReachedMilestones,
  buildLoyaltyMessage,
  DEFAULT_MILESTONES
} from "../LoyaltyService.utils";

// ── DEFAULT_MILESTONES ─────────────────────────────────────────────

describe("DEFAULT_MILESTONES", () => {
  it("contém marcos espaçados progressivamente: 5, 10, 20, 50, 100", () => {
    expect(DEFAULT_MILESTONES).toEqual([5, 10, 20, 50, 100]);
  });
});

// ── parseMilestones ────────────────────────────────────────────────

describe("parseMilestones", () => {
  it("parseia CSV simples", () => {
    expect(parseMilestones("5,10,20")).toEqual([5, 10, 20]);
  });

  it("aceita espaços ao redor dos valores", () => {
    expect(parseMilestones(" 5 , 10 , 20 ")).toEqual([5, 10, 20]);
  });

  it("remove duplicatas", () => {
    expect(parseMilestones("10,5,5,20,10")).toEqual([5, 10, 20]);
  });

  it("ordena ascendente", () => {
    expect(parseMilestones("20,5,10")).toEqual([5, 10, 20]);
  });

  it("descarta valores não-numéricos", () => {
    expect(parseMilestones("abc,10,xyz,5")).toEqual([5, 10]);
  });

  it("descarta zero e negativos", () => {
    expect(parseMilestones("0,-1,5,10")).toEqual([5, 10]);
  });

  it("string vazia retorna array vazio", () => {
    expect(parseMilestones("")).toEqual([]);
  });

  it("null/undefined retorna array vazio", () => {
    expect(parseMilestones(null)).toEqual([]);
    expect(parseMilestones(undefined)).toEqual([]);
  });

  it("aceita marcos grandes", () => {
    expect(parseMilestones("5,100,500,1000")).toEqual([5, 100, 500, 1000]);
  });
});

// ── getNewlyReachedMilestones ──────────────────────────────────────

describe("getNewlyReachedMilestones", () => {
  it("detecta marco atingido (4 → 5)", () => {
    expect(getNewlyReachedMilestones(5, 4, [5, 10, 20], [])).toEqual([5]);
  });

  it("detecta marco atingido (9 → 10)", () => {
    expect(getNewlyReachedMilestones(10, 9, [5, 10, 20], [5])).toEqual([10]);
  });

  it("não detecta entre marcos (5 → 6)", () => {
    expect(getNewlyReachedMilestones(6, 5, [5, 10, 20], [5])).toEqual([]);
  });

  it("não detecta antes do primeiro marco (3 → 4)", () => {
    expect(getNewlyReachedMilestones(4, 3, [5, 10, 20], [])).toEqual([]);
  });

  it("captura marcos pulados (8 → 11, atinge 10)", () => {
    expect(getNewlyReachedMilestones(11, 8, [5, 10, 20], [5])).toEqual([10]);
  });

  it("captura múltiplos marcos pulados (4 → 22, atinge 5, 10, 20)", () => {
    expect(getNewlyReachedMilestones(22, 4, [5, 10, 20], [])).toEqual([5, 10, 20]);
  });

  it("não recompensa marcos já entregues", () => {
    expect(getNewlyReachedMilestones(10, 9, [5, 10], [5, 10])).toEqual([]);
  });

  it("recompensa apenas novos quando alguns já foram entregues", () => {
    expect(getNewlyReachedMilestones(20, 19, [5, 10, 20, 50], [5, 10])).toEqual([20]);
  });

  it("retorna vazio se totalServices não atingiu nenhum marco", () => {
    expect(getNewlyReachedMilestones(3, 2, [5, 10, 20], [])).toEqual([]);
  });

  it("retorna vazio com lista de marcos vazia", () => {
    expect(getNewlyReachedMilestones(10, 9, [], [])).toEqual([]);
  });

  it("ordena resultado ascendente", () => {
    const result = getNewlyReachedMilestones(25, 4, [20, 5, 10], []);
    // Mesmo com input desordenado, o resultado deve estar ordenado
    expect(result).toEqual([...result].sort((a, b) => a - b));
  });
});

// ── buildLoyaltyMessage ────────────────────────────────────────────

describe("buildLoyaltyMessage", () => {
  it("mensagem padrão contém nome e marco", () => {
    const msg = buildLoyaltyMessage({ contactName: "Maria", milestone: 10 });
    expect(msg).toContain("Maria");
    expect(msg).toContain("10");
  });

  it("mensagem padrão inclui cupom quando fornecido", () => {
    const msg = buildLoyaltyMessage({
      contactName: "João",
      milestone: 5,
      couponCode: "FIEL-AB12"
    });
    expect(msg).toContain("FIEL-AB12");
  });

  it("substitui {{name}} no template", () => {
    const msg = buildLoyaltyMessage({
      contactName: "Ana",
      milestone: 10,
      template: "Parabéns {{name}}!"
    });
    expect(msg).toBe("Parabéns Ana!");
  });

  it("substitui {{milestone}} e {{marco}}", () => {
    const msg = buildLoyaltyMessage({
      contactName: "Pedro",
      milestone: 20,
      template: "{{name}} fez {{milestone}} ({{marco}}) serviços!"
    });
    expect(msg).toBe("Pedro fez 20 (20) serviços!");
  });

  it("substitui {{coupon}} e {{cupom}}", () => {
    const msg = buildLoyaltyMessage({
      contactName: "X",
      milestone: 5,
      couponCode: "FIEL-Z9",
      template: "Use {{coupon}} = {{cupom}}"
    });
    expect(msg).toBe("Use FIEL-Z9 = FIEL-Z9");
  });

  it("adiciona cupom ao final se template não tem placeholder", () => {
    const msg = buildLoyaltyMessage({
      contactName: "X",
      milestone: 5,
      couponCode: "FIEL-Z9",
      template: "Parabéns {{name}}!"
    });
    expect(msg).toContain("FIEL-Z9");
  });

  it("não duplica cupom se template já tem placeholder", () => {
    const msg = buildLoyaltyMessage({
      contactName: "X",
      milestone: 5,
      couponCode: "FIEL-Z9",
      template: "Use {{coupon}}"
    });
    expect((msg.match(/FIEL-Z9/g) || []).length).toBe(1);
  });

  it("usa 'Cliente' quando nome é vazio", () => {
    const msg = buildLoyaltyMessage({ contactName: "", milestone: 5 });
    expect(msg).toContain("Cliente");
  });

  it("template vazio cai no fallback default", () => {
    const msg = buildLoyaltyMessage({
      contactName: "Maria",
      milestone: 5,
      template: "  "
    });
    expect(msg).toContain("Maria");
    expect(msg).toContain("5");
  });

  it("é determinístico", () => {
    const params = { contactName: "X", milestone: 5, couponCode: "Y" };
    expect(buildLoyaltyMessage(params)).toBe(buildLoyaltyMessage(params));
  });
});
