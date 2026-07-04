/**
 * RetentionService — lógica PURA para listagem e resumo de clientes dormentes.
 *
 * Isolada para testes unitários sem Sequelize.
 * A orquestração I/O vive em `RetentionController.ts`.
 */

import { DormantStatusType } from "./DormantDetectionService";

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Status que aparecem por padrão na lista de "clientes que precisam de atenção".
 * Ordenados por urgência crescente: atrasado < adormecido < perdido.
 */
export const DEFAULT_DORMANT_STATUSES: DormantStatusType[] = [
  "atrasado",
  "adormecido",
  "perdido"
];

/**
 * Label amigável para cada status — usado em notificações e UI.
 */
export const STATUS_LABELS: Record<DormantStatusType, string> = {
  novo: "Novo cliente",
  em_dia: "Em dia",
  quase_na_hora: "Quase na hora",
  atrasado: "Atrasado",
  adormecido: "Adormecido",
  perdido: "Perdido"
};

// ── Types ──────────────────────────────────────────────────────────

/** Entrada mínima para cálculo de sumário de retenção. */
export interface DormantEntry {
  status: DormantStatusType;
}

/** Sumário agregado de uma lista de contatos classificados. */
export interface RetentionSummary {
  total: number;
  atrasado: number;
  adormecido: number;
  perdido: number;
  urgency: "low" | "medium" | "high";
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Verifica se um status faz parte dos "que precisam de atenção" padrão.
 *
 * @param status Status classificado pelo DormantDetectionService
 * @param allowedStatuses Lista customizada. Default: DEFAULT_DORMANT_STATUSES
 * @returns true se o status deve ser exibido na lista de dormentes
 *
 * @example
 *   isDormantStatus("adormecido")         // → true
 *   isDormantStatus("em_dia")             // → false
 *   isDormantStatus("atrasado", ["atrasado"]) // → true
 */
export function isDormantStatus(
  status: DormantStatusType,
  allowedStatuses: DormantStatusType[] = DEFAULT_DORMANT_STATUSES
): boolean {
  return allowedStatuses.includes(status);
}

/**
 * Calcula um sumário agregado de uma lista de contatos classificados.
 *
 * `urgency` é derivado da proporção de clientes perdidos:
 *   - low:    sem perdidos
 *   - medium: até 25% perdidos
 *   - high:   mais de 25% perdidos
 *
 * @param entries Lista de entradas classificadas (pode ser vazia)
 * @returns RetentionSummary com contagens e urgência
 *
 * @example
 *   buildDormantSummary([
 *     { status: "adormecido" },
 *     { status: "perdido" },
 *     { status: "atrasado" }
 *   ])
 *   // → { total: 3, atrasado: 1, adormecido: 1, perdido: 1, urgency: "medium" }
 */
export function buildDormantSummary(entries: DormantEntry[]): RetentionSummary {
  const counts = entries.reduce(
    (acc, e) => {
      if (e.status === "atrasado") acc.atrasado++;
      if (e.status === "adormecido") acc.adormecido++;
      if (e.status === "perdido") acc.perdido++;
      return acc;
    },
    { atrasado: 0, adormecido: 0, perdido: 0 }
  );

  const total = counts.atrasado + counts.adormecido + counts.perdido;

  let urgency: "low" | "medium" | "high" = "low";
  if (total > 0) {
    const perdidoRatio = counts.perdido / total;
    if (perdidoRatio > 0.25) urgency = "high";
    else if (counts.perdido > 0) urgency = "medium";
    else urgency = "low";
  }

  return { total, ...counts, urgency };
}
