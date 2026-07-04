/**
 * RFMService — segmentação Recência/Frequência/Valor Monetário.
 *
 * Lógica PURA — sem I/O. Recebe histórico já carregado e devolve scores.
 *
 * RFM Score (1-5 cada dimensão):
 *   - R (Recency):   dias desde última compra (menor é melhor)
 *   - F (Frequency): total de visitas (maior é melhor)
 *   - M (Monetary):  valor total gasto (maior é melhor)
 *
 * Segmentos derivados (de Kotler / McKinsey, adaptado para SMB):
 *   - Champions       (R≥4, F≥4, M≥4) — melhores clientes
 *   - Loyal           (F≥4 mas R<4)   — frequentes mas não voltaram recentemente
 *   - Potential       (R≥4, F<4)      — recentes mas pouco frequentes
 *   - At Risk         (R≤2, F≥3)      — eram bons, sumiram
 *   - Hibernating     (R=1, F≤2)      — vieram pouco e faz tempo
 *   - New             (F=1)           — única visita
 *   - Others          — não classificados
 *
 * Referência: técnicas de RFM em marketing direto desde anos 90.
 */

import { ServiceLike } from "./DormantDetectionService";

// ── Types ──────────────────────────────────────────────────────────

export interface RFMInput {
  /** Histórico ordenado (mais recente primeiro) */
  history: Array<ServiceLike & { value?: number | null }>;
  /** Data de referência (default: agora) */
  now?: Date;
}

export interface RFMScores {
  /** Score 1-5: 5 = visitou muito recentemente */
  r: number;
  /** Score 1-5: 5 = visita muito frequente */
  f: number;
  /** Score 1-5: 5 = gasta muito */
  m: number;
  /** Dias desde último serviço */
  daysSinceLastService: number;
  /** Total de serviços */
  totalServices: number;
  /** Valor total gasto (R$) */
  totalValue: number;
}

export type RFMSegment =
  | "champions"
  | "loyal"
  | "potential"
  | "at_risk"
  | "hibernating"
  | "new"
  | "others";

export interface RFMResult extends RFMScores {
  segment: RFMSegment;
  segmentLabel: string;
}

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Thresholds para conversão valor absoluto → score 1-5.
 *
 * Recency (dias desde último serviço — menor é melhor):
 *   ≤ 7 dias    → 5
 *   ≤ 30 dias   → 4
 *   ≤ 60 dias   → 3
 *   ≤ 120 dias  → 2
 *   > 120 dias  → 1
 *
 * Frequency (total visitas — maior é melhor):
 *   ≥ 20 → 5
 *   ≥ 10 → 4
 *   ≥  5 → 3
 *   ≥  2 → 2
 *      1 → 1
 *
 * Monetary (R$ gasto total — maior é melhor):
 *   ≥ 1000 → 5
 *   ≥  500 → 4
 *   ≥  200 → 3
 *   ≥   50 → 2
 *   <   50 → 1
 */
export const RFM_THRESHOLDS = {
  recencyDays: [7, 30, 60, 120],          // scores 5, 4, 3, 2; > = 1
  frequencyVisits: [20, 10, 5, 2],         // scores 5, 4, 3, 2; < = 1
  monetaryAmount: [1000, 500, 200, 50]     // scores 5, 4, 3, 2; < = 1
} as const;

export const SEGMENT_LABELS: Record<RFMSegment, string> = {
  champions: "Campeões",
  loyal: "Fiéis",
  potential: "Potenciais",
  at_risk: "Em risco",
  hibernating: "Hibernando",
  new: "Novos",
  others: "Outros"
};

// ── Helpers ────────────────────────────────────────────────────────

function scoreFromDescending(value: number, thresholds: readonly number[]): number {
  // Para Recency: menor valor = maior score
  if (value <= thresholds[0]) return 5;
  if (value <= thresholds[1]) return 4;
  if (value <= thresholds[2]) return 3;
  if (value <= thresholds[3]) return 2;
  return 1;
}

function scoreFromAscending(value: number, thresholds: readonly number[]): number {
  // Para Frequency/Monetary: maior valor = maior score
  if (value >= thresholds[0]) return 5;
  if (value >= thresholds[1]) return 4;
  if (value >= thresholds[2]) return 3;
  if (value >= thresholds[3]) return 2;
  return 1;
}

function daysBetween(later: Date, earlier: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

// ── Função Principal ──────────────────────────────────────────────

/**
 * Calcula scores RFM a partir do histórico do cliente.
 *
 * @param input { history, now? }
 * @returns RFMScores (sem segmento)
 *
 * @example
 *   const scores = calculateRFMScores({
 *     history: [
 *       { occurredAt: new Date("2026-05-15"), value: 80 },
 *       { occurredAt: new Date("2026-04-01"), value: 100 }
 *     ]
 *   });
 *   // → { r: 5, f: 2, m: 2, daysSinceLastService: 4, ... }
 */
export function calculateRFMScores(input: RFMInput): RFMScores {
  const { history, now = new Date() } = input;

  if (history.length === 0) {
    return {
      r: 1, f: 1, m: 1,
      daysSinceLastService: Infinity,
      totalServices: 0,
      totalValue: 0
    };
  }

  // Histórico vem ordenado DESC por listForContact, mas defendemos
  const sorted = [...history].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );

  const lastService = sorted[0];
  const daysSinceLastService = daysBetween(now, lastService.occurredAt);

  const totalServices = sorted.length;
  const totalValue = sorted.reduce(
    (acc, h) => acc + (h.value ? Number(h.value) : 0),
    0
  );

  return {
    r: scoreFromDescending(daysSinceLastService, RFM_THRESHOLDS.recencyDays),
    f: scoreFromAscending(totalServices, RFM_THRESHOLDS.frequencyVisits),
    m: scoreFromAscending(totalValue, RFM_THRESHOLDS.monetaryAmount),
    daysSinceLastService,
    totalServices,
    totalValue
  };
}

/**
 * Classifica em segmentos com base nos scores R, F, M.
 *
 * Lógica (ordem importa — primeira regra que casa vence):
 *   1. F=1                          → "new"
 *   2. R≥4, F≥4, M≥4                → "champions"
 *   3. F≥4 (mas R<4)                → "loyal"
 *   4. R≥4 (mas F<4)                → "potential"
 *   5. R≤2 e F≥3                    → "at_risk"
 *   6. R=1 e F≤2                    → "hibernating"
 *   7. caso contrário               → "others"
 *
 * @param scores RFM scores
 * @returns Segmento atribuído
 *
 * @example
 *   classifyRFMSegment({ r: 5, f: 4, m: 5 }) // → "champions"
 *   classifyRFMSegment({ r: 1, f: 1, m: 1 }) // → "new" (única visita)
 */
export function classifyRFMSegment(scores: { r: number; f: number; m: number }): RFMSegment {
  const { r, f, m } = scores;

  if (f === 1) return "new";
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (f >= 4) return "loyal";
  if (r >= 4) return "potential";
  if (r <= 2 && f >= 3) return "at_risk";
  if (r === 1 && f <= 2) return "hibernating";
  return "others";
}

/**
 * Conveniência: calcula scores + classifica segmento + adiciona label.
 *
 * @example
 *   analyzeRFM({ history: [...] })
 *   // → { r, f, m, segment, segmentLabel, daysSinceLastService, ... }
 */
export function analyzeRFM(input: RFMInput): RFMResult {
  const scores = calculateRFMScores(input);
  const segment = classifyRFMSegment(scores);
  return {
    ...scores,
    segment,
    segmentLabel: SEGMENT_LABELS[segment]
  };
}
