/**
 * Testes TDD para o contador de dedup em memória (ITEM A — Tier 3).
 *
 * Objetivo: substituir `Message.count` por-mensagem por um contador em memória
 * que dispara a unificação de contatos na MESMA cadência (a cada N mensagens),
 * sem query no banco. Estes testes fixam a semântica do disparo.
 */

import {
  shouldRunDedup,
  resetDedupCounter,
  DEDUP_INTERVAL
} from "../dedupCounter";

describe("dedupCounter.shouldRunDedup", () => {
  beforeEach(() => {
    resetDedupCounter();
  });

  it("dispara exatamente ao cruzar cada múltiplo do intervalo", () => {
    const interval = 3;
    const results: boolean[] = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(shouldRunDedup(1, interval));
    }
    // count: 1 2 3 4 5 6 7 -> true em 3 e 6
    expect(results).toEqual([false, false, true, false, false, true, false]);
  });

  it("mantém contadores independentes por companyId", () => {
    const interval = 2;
    expect(shouldRunDedup(1, interval)).toBe(false); // empresa 1: count=1
    expect(shouldRunDedup(2, interval)).toBe(false); // empresa 2: count=1
    expect(shouldRunDedup(1, interval)).toBe(true); // empresa 1: count=2 -> dispara
    expect(shouldRunDedup(2, interval)).toBe(true); // empresa 2: count=2 -> dispara
  });

  it("usa DEDUP_INTERVAL como padrão (1000)", () => {
    expect(DEDUP_INTERVAL).toBe(1000);
    for (let i = 0; i < DEDUP_INTERVAL - 1; i += 1) {
      expect(shouldRunDedup(9)).toBe(false);
    }
    expect(shouldRunDedup(9)).toBe(true); // 1000ª chamada
  });

  it("não dispara e não lança com intervalo inválido (<= 0)", () => {
    expect(shouldRunDedup(1, 0)).toBe(false);
    expect(shouldRunDedup(1, -5)).toBe(false);
  });

  it("resetDedupCounter(companyId) zera apenas a empresa informada", () => {
    shouldRunDedup(1, 2); // count=1
    shouldRunDedup(2, 2); // count=1
    resetDedupCounter(1);
    // empresa 1 recomeça: precisa de 2 chamadas para disparar
    expect(shouldRunDedup(1, 2)).toBe(false); // count=1
    expect(shouldRunDedup(1, 2)).toBe(true); // count=2
    // empresa 2 não foi resetada: já estava em 1, próxima dispara
    expect(shouldRunDedup(2, 2)).toBe(true);
  });
});
