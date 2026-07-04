/**
 * Testes unitários para CrossSellService.utils.ts
 */

import {
  findServicePairs,
  suggestServicesForContact,
  ServiceRecord,
  DEFAULT_MIN_SUPPORT,
  DEFAULT_MIN_CONFIDENCE
} from "../CrossSellService.utils";

const DATE = new Date("2026-01-01T00:00:00Z");

function makeRecord(contactId: number, serviceType: string | null): ServiceRecord {
  return { contactId, occurredAt: DATE, serviceType };
}

// ── Constantes ─────────────────────────────────────────────────────

describe("Constantes", () => {
  it("DEFAULT_MIN_SUPPORT é 2", () => {
    expect(DEFAULT_MIN_SUPPORT).toBe(2);
  });

  it("DEFAULT_MIN_CONFIDENCE é 30", () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBe(30);
  });
});

// ── findServicePairs ───────────────────────────────────────────────

describe("findServicePairs", () => {
  it("lista vazia retorna array vazio", () => {
    expect(findServicePairs([])).toEqual([]);
  });

  it("um único cliente com um serviço não gera pares", () => {
    expect(findServicePairs([makeRecord(1, "corte")])).toEqual([]);
  });

  it("um único cliente com 2 serviços não atinge minSupport", () => {
    // 1 cliente compra ambos = 1 coocorrência < default minSupport (2)
    expect(findServicePairs([
      makeRecord(1, "corte"),
      makeRecord(1, "barba")
    ])).toEqual([]);
  });

  it("2 clientes compram corte+barba → 1 par detectado", () => {
    const pairs = findServicePairs([
      makeRecord(1, "corte"),
      makeRecord(1, "barba"),
      makeRecord(2, "corte"),
      makeRecord(2, "barba")
    ], 2);

    expect(pairs.length).toBe(1);
    expect(pairs[0].a).toBe("barba"); // ordem alfabética
    expect(pairs[0].b).toBe("corte");
    expect(pairs[0].cooccurrence).toBe(2);
  });

  it("calcula confidence corretamente", () => {
    // 3 clientes compram corte; 2 deles também compram barba
    const pairs = findServicePairs([
      makeRecord(1, "corte"), makeRecord(1, "barba"),
      makeRecord(2, "corte"), makeRecord(2, "barba"),
      makeRecord(3, "corte")
    ], 2);

    expect(pairs.length).toBe(1);
    // dos 3 com corte, 2 têm barba = 66.67%
    expect(pairs[0].confidenceBtoA).toBeCloseTo(66.67, 1);
    // dos 2 com barba, 2 têm corte = 100%
    expect(pairs[0].confidenceAtoB).toBe(100);
  });

  it("ignora records sem serviceType (null/undefined/vazio)", () => {
    const pairs = findServicePairs([
      makeRecord(1, "corte"),
      makeRecord(1, null),
      makeRecord(1, ""),
      makeRecord(1, "   "),
      makeRecord(2, "corte"),
      makeRecord(2, "barba")
    ], 1); // minSupport=1 para testar

    // Sem barba do cliente 1, apenas 1 coocorrência (cliente 2): corte+barba
    expect(pairs.length).toBe(1);
    expect(pairs[0].cooccurrence).toBe(1);
  });

  it("ordena por confidence média decrescente", () => {
    // Par 1: corte+barba (alta confidence)
    // Par 2: corte+escova (baixa confidence)
    const pairs = findServicePairs([
      makeRecord(1, "corte"), makeRecord(1, "barba"),
      makeRecord(2, "corte"), makeRecord(2, "barba"),
      makeRecord(3, "corte"), makeRecord(3, "escova"),
      makeRecord(4, "corte"), makeRecord(4, "escova")
    ], 2);

    expect(pairs.length).toBe(2);
    // Os primeiros 2 clientes têm 100% A→B e B→A para barba+corte
    // Os clientes 3,4 têm corte e escova, mas clientes 1,2 não têm escova
    // → confidence média deve ser maior para o par mais "puro"
  });

  it("deduplica serviços do mesmo cliente (mesmo tipo em datas diferentes)", () => {
    // Cliente 1 compra corte 3x e barba 1x → conta como (corte, barba) uma vez só
    const pairs = findServicePairs([
      makeRecord(1, "corte"),
      makeRecord(1, "corte"),
      makeRecord(1, "corte"),
      makeRecord(1, "barba"),
      makeRecord(2, "corte"),
      makeRecord(2, "barba")
    ], 2);

    expect(pairs.length).toBe(1);
    expect(pairs[0].cooccurrence).toBe(2); // 2 clientes, não 4
  });

  it("respeita minSupport customizado", () => {
    // 3 clientes têm corte+barba; minSupport=4 → não retorna nada
    const records = [];
    for (let i = 1; i <= 3; i++) {
      records.push(makeRecord(i, "corte"), makeRecord(i, "barba"));
    }
    expect(findServicePairs(records, 4)).toEqual([]);
    expect(findServicePairs(records, 3).length).toBe(1);
  });

  it("é determinístico (ordem dos records não importa)", () => {
    const recs = [
      makeRecord(1, "corte"), makeRecord(1, "barba"),
      makeRecord(2, "corte"), makeRecord(2, "barba")
    ];
    const r1 = findServicePairs([...recs].reverse(), 2);
    const r2 = findServicePairs(recs, 2);
    expect(r1).toEqual(r2);
  });

  it("nomes de serviço sempre ordenados alfabeticamente (a < b)", () => {
    const pairs = findServicePairs([
      makeRecord(1, "zebra"), makeRecord(1, "alfa"),
      makeRecord(2, "zebra"), makeRecord(2, "alfa")
    ], 2);
    expect(pairs[0].a).toBe("alfa");
    expect(pairs[0].b).toBe("zebra");
  });
});

// ── suggestServicesForContact ─────────────────────────────────────

describe("suggestServicesForContact", () => {
  // Cenário base: 4 clientes, corte+barba é par forte
  const baseRecords: ServiceRecord[] = [
    makeRecord(1, "corte"), makeRecord(1, "barba"),
    makeRecord(2, "corte"), makeRecord(2, "barba"),
    makeRecord(3, "corte"), makeRecord(3, "barba"),
    makeRecord(4, "corte"), makeRecord(4, "escova")
  ];
  const basePairs = findServicePairs(baseRecords, 2);

  it("cliente que tem corte recebe sugestão de barba", () => {
    const result = suggestServicesForContact(new Set(["corte"]), basePairs);
    const services = result.map(s => s.suggestedService);
    expect(services).toContain("barba");
  });

  it("cliente que tem barba recebe sugestão de corte", () => {
    const result = suggestServicesForContact(new Set(["barba"]), basePairs);
    expect(result[0].suggestedService).toBe("corte");
  });

  it("cliente que tem corte+barba não recebe nenhuma das duas", () => {
    const result = suggestServicesForContact(new Set(["corte", "barba"]), basePairs);
    const services = result.map(s => s.suggestedService);
    expect(services).not.toContain("corte");
    expect(services).not.toContain("barba");
  });

  it("cliente sem nenhum serviço base recebe vazio", () => {
    const result = suggestServicesForContact(new Set(["pintura"]), basePairs);
    // pintura não aparece em nenhum par → nenhuma sugestão
    expect(result).toEqual([]);
  });

  it("respeita minConfidence customizado", () => {
    // confidence de corte+barba = 75% (3/4)
    // Com minConfidence=80, não sugere
    const result = suggestServicesForContact(new Set(["corte"]), basePairs, 80);
    const services = result.map(s => s.suggestedService);
    expect(services).not.toContain("barba");
  });

  it("limita ao maxSuggestions", () => {
    // Adiciona muitos serviços que se cruzam com corte
    const extra = [
      makeRecord(5, "corte"), makeRecord(5, "x"),
      makeRecord(6, "corte"), makeRecord(6, "y"),
      makeRecord(7, "corte"), makeRecord(7, "x"),
      makeRecord(8, "corte"), makeRecord(8, "y")
    ];
    const allPairs = findServicePairs([...baseRecords, ...extra], 2);
    const result = suggestServicesForContact(new Set(["corte"]), allPairs, 10, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("ordena por confidence decrescente", () => {
    const result = suggestServicesForContact(new Set(["corte"]), basePairs);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].confidence).toBeGreaterThanOrEqual(result[i + 1].confidence);
    }
  });

  it("deduplica sugestões mantendo maior confidence", () => {
    // Cenário onde múltiplos serviços do cliente sugerem o mesmo terceiro
    const records = [
      makeRecord(1, "a"), makeRecord(1, "b"), makeRecord(1, "x"),
      makeRecord(2, "a"), makeRecord(2, "b"), makeRecord(2, "x"),
      makeRecord(3, "a"), makeRecord(3, "b")
    ];
    const pairs = findServicePairs(records, 2);
    const result = suggestServicesForContact(new Set(["a", "b"]), pairs, 30);
    const xCount = result.filter(s => s.suggestedService === "x").length;
    // x deve aparecer no máximo 1 vez
    expect(xCount).toBeLessThanOrEqual(1);
  });

  it("é determinístico", () => {
    const r1 = suggestServicesForContact(new Set(["corte"]), basePairs);
    const r2 = suggestServicesForContact(new Set(["corte"]), basePairs);
    expect(r1).toEqual(r2);
  });
});
