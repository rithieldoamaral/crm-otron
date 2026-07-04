/**
 * DormantDetectionService — classifica clientes em faixas de retenção
 * baseado no histórico de serviços.
 *
 * Algoritmo (RFM-lite):
 *   1. Coleta últimos N serviços do cliente (default: 6)
 *   2. Calcula intervalo médio entre os últimos 5 intervalos
 *   3. Calcula dias desde a última visita
 *   4. ratio = dias_desde_ultima / intervalo_medio
 *   5. Classifica em faixa baseado no ratio
 *
 * Faixas:
 *   - novo:            < 3 serviços no histórico
 *   - em_dia:          ratio < 0.8
 *   - quase_na_hora:   0.8 ≤ ratio < 1.2
 *   - atrasado:        1.2 ≤ ratio < 2.0
 *   - adormecido:      2.0 ≤ ratio < 4.0
 *   - perdido:         ratio ≥ 4.0
 *
 * IMPORTANTE: este módulo é LÓGICA PURA. Não acessa banco nem rede.
 * Consumir via classify(services) onde `services` vem de query do model.
 */

// ── Constantes do algoritmo ──────────────────────────────────────────
export const MIN_SERVICES_FOR_DETECTION = 3;
export const MAX_INTERVALS_TO_AVERAGE = 5;

// Faixas de classificação (inclusivas no limite inferior, exclusivas no superior)
export const THRESHOLDS = {
  EM_DIA_MAX: 0.8,
  QUASE_NA_HORA_MAX: 1.2,
  ATRASADO_MAX: 2.0,
  ADORMECIDO_MAX: 4.0
} as const;

// ── Tipos exportados ─────────────────────────────────────────────────
export type DormantStatusType =
  | "novo"
  | "em_dia"
  | "quase_na_hora"
  | "atrasado"
  | "adormecido"
  | "perdido";

export interface ServiceLike {
  occurredAt: Date;
  id?: number;
}

export interface DormantStatus {
  status: DormantStatusType;
  daysSinceLastService: number;
  averageInterval: number;
  ratio: number;
  totalServices: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Calcula a diferença em dias inteiros entre duas datas.
 * Sempre retorna valor não-negativo (Math.abs).
 *
 * @param a Primeira data
 * @param b Segunda data
 * @returns Número de dias inteiros entre as duas datas
 *
 * @example
 *   daysBetween(new Date('2026-05-18'), new Date('2026-05-11')) === 7
 */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Calcula o intervalo médio (em dias) entre os últimos N serviços.
 * Considera no máximo MAX_INTERVALS_TO_AVERAGE intervalos.
 *
 * @param services Array de serviços (ordem não importa — é normalizada internamente)
 * @returns Intervalo médio em dias, ou 0 se há menos de 2 serviços
 */
export function calculateAverageInterval(services: ServiceLike[]): number {
  if (!services || services.length < 2) return 0;

  // Ordena do mais recente para o mais antigo
  const sorted = [...services].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );

  const intervals: number[] = [];
  const maxPairs = Math.min(MAX_INTERVALS_TO_AVERAGE, sorted.length - 1);

  for (let i = 0; i < maxPairs; i++) {
    const days = daysBetween(sorted[i].occurredAt, sorted[i + 1].occurredAt);
    intervals.push(days);
  }

  if (intervals.length === 0) return 0;

  const sum = intervals.reduce((acc, n) => acc + n, 0);
  return Math.round(sum / intervals.length);
}

/**
 * Classifica um cliente em uma faixa de retenção baseado no histórico de serviços.
 *
 * @param services Array de serviços do cliente (de ServiceHistory.findAll, por exemplo)
 * @param referenceDate Data de referência para "hoje" (default: agora). Útil para testes.
 * @returns DormantStatus com classificação e métricas
 *
 * @example
 *   const services = await ServiceHistory.findAll({ where: { contactId } });
 *   const status = classify(services);
 *   if (status.status === 'adormecido') { ... }
 */
export function classify(
  services: ServiceLike[],
  referenceDate: Date = new Date()
): DormantStatus {
  const totalServices = services?.length ?? 0;

  // Caso 1: cliente novo (sem histórico suficiente)
  if (totalServices < MIN_SERVICES_FOR_DETECTION) {
    return {
      status: "novo",
      daysSinceLastService: 0,
      averageInterval: 0,
      ratio: 0,
      totalServices
    };
  }

  // Ordena do mais recente para o mais antigo
  const sorted = [...services].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
  );

  const lastService = sorted[0];
  const daysSinceLastService = daysBetween(referenceDate, lastService.occurredAt);
  const averageInterval = calculateAverageInterval(sorted);

  // Edge case: todos os serviços no mesmo dia → intervalo médio 0
  // Evita divisão por zero retornando ratio 0 (classificado como em_dia)
  const ratio = averageInterval === 0 ? 0 : daysSinceLastService / averageInterval;

  let status: DormantStatusType;
  if (ratio < THRESHOLDS.EM_DIA_MAX) status = "em_dia";
  else if (ratio < THRESHOLDS.QUASE_NA_HORA_MAX) status = "quase_na_hora";
  else if (ratio < THRESHOLDS.ATRASADO_MAX) status = "atrasado";
  else if (ratio < THRESHOLDS.ADORMECIDO_MAX) status = "adormecido";
  else status = "perdido";

  return {
    status,
    daysSinceLastService,
    averageInterval,
    ratio,
    totalServices
  };
}

/**
 * Retorna informações pré-formatadas sobre o status para usar em UI.
 * Inclui label em pt-BR, cor sugerida e prioridade de ação.
 */
export function describeStatus(status: DormantStatusType) {
  const map = {
    novo: { label: "Novo", color: "#9e9e9e", priority: 0, emoji: "🆕" },
    em_dia: { label: "Em dia", color: "#4caf50", priority: 0, emoji: "🟢" },
    quase_na_hora: { label: "Quase na hora", color: "#ffeb3b", priority: 1, emoji: "🟡" },
    atrasado: { label: "Atrasado", color: "#ff9800", priority: 2, emoji: "🟠" },
    adormecido: { label: "Adormecido", color: "#f44336", priority: 3, emoji: "🔴" },
    perdido: { label: "Perdido", color: "#424242", priority: 4, emoji: "⚫" }
  };
  return map[status];
}

/**
 * Filtra um array de status retornando apenas os que merecem ação de reativação.
 * Útil para gerar a lista do painel "para reativar hoje".
 */
export function needsReactivation(status: DormantStatusType): boolean {
  return status === "atrasado" || status === "adormecido" || status === "perdido";
}

