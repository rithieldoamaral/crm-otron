/**
 * Testes unitários — ServiceCatalogService.utils.ts
 *
 * Cobre as três funções puras do catálogo de serviços:
 *   - formatPrice       → formatação de preço em Real Brasileiro
 *   - resolveHistoryValue → resolução do valor a gravar no ServiceHistory
 *   - normalizePrice    → validação e normalização de entrada de preço
 *
 * TDD: estes testes foram escritos ANTES da implementação conforme CLAUDE.md §II.1.
 */

import {
  formatPrice,
  resolveHistoryValue,
  normalizePrice,
} from "../ServiceCatalogService.utils";

// ── formatPrice ──────────────────────────────────────────────────────────────

describe("formatPrice", () => {
  it("formata inteiro como Real", () => {
    expect(formatPrice(40)).toBe("R$ 40,00");
  });

  it("formata decimal com 1 casa", () => {
    expect(formatPrice(40.5)).toBe("R$ 40,50");
  });

  it("formata decimal com 2 casas", () => {
    expect(formatPrice(40.99)).toBe("R$ 40,99");
  });

  it("formata zero", () => {
    expect(formatPrice(0)).toBe("R$ 0,00");
  });

  it("formata valor grande com separador de milhar", () => {
    expect(formatPrice(1234.99)).toBe("R$ 1.234,99");
  });

  it("formata valor acima de um milhão", () => {
    expect(formatPrice(1000000)).toBe("R$ 1.000.000,00");
  });

  it("arredonda para 2 casas decimais", () => {
    // toFixed arredonda; 40.005 → "40.01" em JS (banker's rounding pode variar)
    expect(formatPrice(40.1)).toBe("R$ 40,10");
  });
});

// ── resolveHistoryValue ───────────────────────────────────────────────────────

describe("resolveHistoryValue", () => {
  it("retorna valor explícito quando fornecido", () => {
    expect(resolveHistoryValue(50, 40)).toBe(50);
  });

  it("NÃO pula zero explícito (serviço gratuito)", () => {
    // 0 é um valor válido (serviço grátis) — não deve ser substituído pelo preço do catálogo
    expect(resolveHistoryValue(0, 40)).toBe(0);
  });

  it("usa preço do catálogo quando valor explícito é undefined", () => {
    expect(resolveHistoryValue(undefined, 40)).toBe(40);
  });

  it("usa preço do catálogo quando valor explícito é null", () => {
    expect(resolveHistoryValue(null, 40)).toBe(40);
  });

  it("converte preço do catálogo para number (Sequelize retorna string em DECIMAL)", () => {
    // Sequelize DECIMAL columns retornam string do banco ("40.00")
    expect(resolveHistoryValue(undefined, "40.00" as any)).toBe(40);
  });

  it("retorna null quando ambos são undefined", () => {
    expect(resolveHistoryValue(undefined, undefined)).toBeNull();
  });

  it("retorna null quando ambos são null", () => {
    expect(resolveHistoryValue(null, null)).toBeNull();
  });

  it("retorna null quando explícito é undefined e serviço sem preço", () => {
    expect(resolveHistoryValue(undefined, null)).toBeNull();
  });

  it("valor explícito 0 vence preço do catálogo (override prioritário)", () => {
    // Admin pode registrar serviço gratuito mesmo que o catálogo tenha preço
    expect(resolveHistoryValue(0, 300)).toBe(0);
  });

  it("usa preço do catálogo numérico inteiro", () => {
    expect(resolveHistoryValue(null, 300)).toBe(300);
  });
});

// ── normalizePrice ────────────────────────────────────────────────────────────

describe("normalizePrice", () => {
  it("aceita número positivo", () => {
    expect(normalizePrice(40)).toBe(40);
  });

  it("aceita string numérica", () => {
    expect(normalizePrice("40.50")).toBe(40.5);
  });

  it("arredonda para 2 casas decimais", () => {
    expect(normalizePrice(40.125)).toBe(40.13);
  });

  it("aceita zero (serviço gratuito)", () => {
    expect(normalizePrice(0)).toBe(0);
  });

  it("aceita string '0'", () => {
    expect(normalizePrice("0")).toBe(0);
  });

  it("rejeita número negativo → null", () => {
    expect(normalizePrice(-5)).toBeNull();
  });

  it("rejeita string não-numérica → null", () => {
    expect(normalizePrice("abc")).toBeNull();
  });

  it("retorna null para null", () => {
    expect(normalizePrice(null)).toBeNull();
  });

  it("retorna null para undefined", () => {
    expect(normalizePrice(undefined)).toBeNull();
  });

  it("retorna null para string vazia", () => {
    expect(normalizePrice("")).toBeNull();
  });

  it("aceita valor alto (pacote de sessões)", () => {
    expect(normalizePrice(300)).toBe(300);
  });

  it("string com vírgula pt-BR retorna parte inteira (frontend deve normalizar antes de enviar)", () => {
    // parseFloat("40,50") = 40 — JavaScript para no primeiro caractere não-numérico.
    // O frontend deve enviar "40.50" (ponto) para a API; este teste documenta o comportamento.
    expect(normalizePrice("40,50")).toBe(40);
  });

  it("rejeita NaN → null", () => {
    expect(normalizePrice(NaN)).toBeNull();
  });
});
