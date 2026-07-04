/**
 * Testes unitários para RFMService.utils.ts
 */

import {
  calculateRFMScores,
  classifyRFMSegment,
  analyzeRFM,
  RFM_THRESHOLDS,
  SEGMENT_LABELS
} from "../RFMService.utils";

const NOW = new Date("2026-05-19T12:00:00Z");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

// ── Constantes ─────────────────────────────────────────────────────

describe("Constantes", () => {
  it("RFM_THRESHOLDS contém 4 níveis para cada dimensão", () => {
    expect(RFM_THRESHOLDS.recencyDays.length).toBe(4);
    expect(RFM_THRESHOLDS.frequencyVisits.length).toBe(4);
    expect(RFM_THRESHOLDS.monetaryAmount.length).toBe(4);
  });

  it("SEGMENT_LABELS contém todos os 7 segmentos em português", () => {
    expect(SEGMENT_LABELS.champions).toBe("Campeões");
    expect(SEGMENT_LABELS.loyal).toBe("Fiéis");
    expect(SEGMENT_LABELS.new).toBe("Novos");
  });
});

// ── calculateRFMScores ────────────────────────────────────────────

describe("calculateRFMScores", () => {
  it("histórico vazio retorna scores mínimos", () => {
    const result = calculateRFMScores({ history: [], now: NOW });
    expect(result.r).toBe(1);
    expect(result.f).toBe(1);
    expect(result.m).toBe(1);
    expect(result.totalServices).toBe(0);
    expect(result.totalValue).toBe(0);
  });

  // Recency

  it("R=5 quando última visita foi hoje", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(0) }],
      now: NOW
    });
    expect(result.r).toBe(5);
  });

  it("R=5 quando última visita foi há 5 dias", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(5) }],
      now: NOW
    });
    expect(result.r).toBe(5);
  });

  it("R=4 quando última visita foi há 20 dias", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(20) }],
      now: NOW
    });
    expect(result.r).toBe(4);
  });

  it("R=3 quando última visita foi há 45 dias", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(45) }],
      now: NOW
    });
    expect(result.r).toBe(3);
  });

  it("R=2 quando última visita foi há 100 dias", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(100) }],
      now: NOW
    });
    expect(result.r).toBe(2);
  });

  it("R=1 quando última visita foi há 200 dias", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(200) }],
      now: NOW
    });
    expect(result.r).toBe(1);
  });

  // Frequency

  it("F=5 quando totalServices ≥ 20", () => {
    const history = Array(20).fill(null).map((_, i) => ({ occurredAt: daysAgo(i * 5) }));
    const result = calculateRFMScores({ history, now: NOW });
    expect(result.f).toBe(5);
  });

  it("F=4 quando totalServices ≥ 10", () => {
    const history = Array(12).fill(null).map((_, i) => ({ occurredAt: daysAgo(i * 5) }));
    const result = calculateRFMScores({ history, now: NOW });
    expect(result.f).toBe(4);
  });

  it("F=3 quando totalServices = 5", () => {
    const history = Array(5).fill(null).map((_, i) => ({ occurredAt: daysAgo(i * 5) }));
    const result = calculateRFMScores({ history, now: NOW });
    expect(result.f).toBe(3);
  });

  it("F=2 quando totalServices = 2", () => {
    const history = Array(2).fill(null).map((_, i) => ({ occurredAt: daysAgo(i * 5) }));
    const result = calculateRFMScores({ history, now: NOW });
    expect(result.f).toBe(2);
  });

  it("F=1 quando totalServices = 1", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(5) }],
      now: NOW
    });
    expect(result.f).toBe(1);
  });

  // Monetary

  it("M=5 quando totalValue ≥ 1000", () => {
    const result = calculateRFMScores({
      history: [
        { occurredAt: daysAgo(5), value: 800 },
        { occurredAt: daysAgo(15), value: 300 }
      ],
      now: NOW
    });
    expect(result.m).toBe(5);
  });

  it("M=4 quando totalValue = 600", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(5), value: 600 }],
      now: NOW
    });
    expect(result.m).toBe(4);
  });

  it("M=1 quando totalValue é zero (sem valores)", () => {
    const result = calculateRFMScores({
      history: [{ occurredAt: daysAgo(5) }],
      now: NOW
    });
    expect(result.m).toBe(1);
  });

  it("totalValue soma todos os values, ignorando null/undefined", () => {
    const result = calculateRFMScores({
      history: [
        { occurredAt: daysAgo(5), value: 100 },
        { occurredAt: daysAgo(15), value: null as any },
        { occurredAt: daysAgo(25), value: 50 }
      ],
      now: NOW
    });
    expect(result.totalValue).toBe(150);
  });

  it("daysSinceLastService usa a data mais recente, mesmo com input desordenado", () => {
    const result = calculateRFMScores({
      history: [
        { occurredAt: daysAgo(30) },
        { occurredAt: daysAgo(2) },   // mais recente
        { occurredAt: daysAgo(60) }
      ],
      now: NOW
    });
    expect(result.daysSinceLastService).toBe(2);
  });
});

// ── classifyRFMSegment ────────────────────────────────────────────

describe("classifyRFMSegment", () => {
  it("F=1 → 'new' (independente de R e M)", () => {
    expect(classifyRFMSegment({ r: 5, f: 1, m: 5 })).toBe("new");
    expect(classifyRFMSegment({ r: 1, f: 1, m: 1 })).toBe("new");
  });

  it("R≥4, F≥4, M≥4 → 'champions'", () => {
    expect(classifyRFMSegment({ r: 5, f: 5, m: 5 })).toBe("champions");
    expect(classifyRFMSegment({ r: 4, f: 4, m: 4 })).toBe("champions");
  });

  it("F≥4 mas R<4 → 'loyal'", () => {
    expect(classifyRFMSegment({ r: 2, f: 5, m: 3 })).toBe("loyal");
    expect(classifyRFMSegment({ r: 3, f: 4, m: 2 })).toBe("loyal");
  });

  it("R≥4 mas F<4 → 'potential'", () => {
    expect(classifyRFMSegment({ r: 5, f: 2, m: 3 })).toBe("potential");
    expect(classifyRFMSegment({ r: 4, f: 3, m: 2 })).toBe("potential");
  });

  it("R≤2 e F≥3 → 'at_risk' (eram bons, sumiram)", () => {
    expect(classifyRFMSegment({ r: 1, f: 3, m: 3 })).toBe("at_risk");
    expect(classifyRFMSegment({ r: 2, f: 3, m: 5 })).toBe("at_risk");
  });

  it("R=1 e F≤2 → 'hibernating'", () => {
    expect(classifyRFMSegment({ r: 1, f: 2, m: 2 })).toBe("hibernating");
  });

  it("zona cinza → 'others'", () => {
    // R=3, F=3, M=3 — não champion, não loyal, não potential, não at_risk
    expect(classifyRFMSegment({ r: 3, f: 3, m: 3 })).toBe("others");
  });

  it("champions tem prioridade sobre loyal/potential", () => {
    // R=4, F=4, M=4 cai em champion antes de loyal
    expect(classifyRFMSegment({ r: 4, f: 4, m: 4 })).toBe("champions");
  });

  it("'new' tem prioridade absoluta (F=1)", () => {
    // Mesmo com R=5 e M=5, se F=1 é new
    expect(classifyRFMSegment({ r: 5, f: 1, m: 5 })).toBe("new");
  });
});

// ── analyzeRFM (integration) ───────────────────────────────────────

describe("analyzeRFM", () => {
  it("cliente perfeito → champion", () => {
    const history = Array(15).fill(null).map((_, i) => ({
      occurredAt: daysAgo(i * 10),  // visita cada 10 dias
      value: 100
    }));
    const result = analyzeRFM({ history, now: NOW });
    expect(result.segment).toBe("champions");
    expect(result.segmentLabel).toBe("Campeões");
  });

  it("cliente única visita → new", () => {
    const result = analyzeRFM({
      history: [{ occurredAt: daysAgo(3), value: 50 }],
      now: NOW
    });
    expect(result.segment).toBe("new");
  });

  it("cliente sumiu → at_risk ou hibernating", () => {
    const history = Array(5).fill(null).map((_, i) => ({
      occurredAt: daysAgo(150 + i * 30),
      value: 100
    }));
    const result = analyzeRFM({ history, now: NOW });
    expect(["at_risk", "hibernating"]).toContain(result.segment);
  });

  it("é determinístico", () => {
    const history = [{ occurredAt: daysAgo(5), value: 100 }];
    expect(analyzeRFM({ history, now: NOW })).toEqual(analyzeRFM({ history, now: NOW }));
  });
});
