/**
 * CrossSellService — sugestões de serviços complementares.
 *
 * Lógica PURA — sem I/O. Recebe histórico já carregado.
 *
 * Algoritmo (Market Basket Analysis simplificado):
 *   1. Para cada cliente, pega o conjunto de tipos de serviço consumidos
 *   2. Para cada par (A, B) de serviços co-consumidos:
 *      - incrementa contador de coocorrência
 *      - calcula 'confidence' = clientes que têm A∩B / clientes que têm A
 *   3. Ordena pares por confidence (com support mínimo)
 *
 * Para sugestões individuais:
 *   - Para cada serviço A já consumido pelo cliente
 *   - Olha os top-N pares (A, B) onde B ainda NÃO foi consumido
 *   - Retorna ordenado por confidence
 *
 * Limitações conhecidas:
 *   - Ignora ordem temporal (compra A primeiro, depois B vs B,A)
 *   - Não considera valor monetário
 *   - Não usa algoritmos modernos (FP-Growth, Apriori) — suficiente
 *     para volumes de SMB (até ~10k transações por empresa)
 */

import { ServiceLike } from "./DormantDetectionService";

// ── Types ──────────────────────────────────────────────────────────

export interface ServiceRecord extends ServiceLike {
  contactId: number;
  serviceType?: string | null;
}

export interface ServicePair {
  /** Primeiro serviço (ordenado alfabeticamente para determinismo) */
  a: string;
  /** Segundo serviço */
  b: string;
  /** Quantos clientes consumiram ambos */
  cooccurrence: number;
  /** Quantos clientes consumiram pelo menos A */
  supportA: number;
  /** Quantos clientes consumiram pelo menos B */
  supportB: number;
  /** Probabilidade: dos que compraram A, quantos % compraram B? */
  confidenceAtoB: number;
  /** Probabilidade: dos que compraram B, quantos % compraram A? */
  confidenceBtoA: number;
}

export interface CrossSellSuggestion {
  /** Serviço sugerido (que o cliente ainda não consumiu) */
  suggestedService: string;
  /** Serviço base (que o cliente já consumiu e levou à sugestão) */
  basedOnService: string;
  /** Confidence: % de clientes com basedOnService que também têm suggestedService */
  confidence: number;
  /** Número absoluto de coocorrências */
  cooccurrence: number;
}

// ── Constantes ─────────────────────────────────────────────────────

/** Mínimo de coocorrências para considerar um par "relevante". */
export const DEFAULT_MIN_SUPPORT = 2;

/** Mínimo de confidence (%) para uma sugestão ser exibida. */
export const DEFAULT_MIN_CONFIDENCE = 30;

// ── Helpers internos ──────────────────────────────────────────────

/**
 * Agrupa records por contactId, retornando Set de tipos de serviço.
 * Records sem serviceType são ignorados.
 */
function groupByContact(records: ServiceRecord[]): Map<number, Set<string>> {
  const byContact = new Map<number, Set<string>>();
  for (const r of records) {
    const type = r.serviceType?.trim();
    if (!type) continue;
    if (!byContact.has(r.contactId)) {
      byContact.set(r.contactId, new Set());
    }
    byContact.get(r.contactId)!.add(type);
  }
  return byContact;
}

/**
 * Gera pares ordenados (a, b) com a < b para determinismo.
 */
function generatePairs(services: string[]): Array<[string, string]> {
  const sorted = [...services].sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      pairs.push([sorted[i], sorted[j]]);
    }
  }
  return pairs;
}

// ── Função principal: findServicePairs ────────────────────────────

/**
 * Calcula pares de serviços frequentemente comprados juntos.
 *
 * @param records Lista de ServiceHistory (deve incluir contactId e serviceType)
 * @param minSupport Mínimo de coocorrências (default: 2)
 * @returns Pares ordenados por confidence (descrescente)
 *
 * @example
 *   findServicePairs([
 *     { contactId: 1, occurredAt: d1, serviceType: "corte" },
 *     { contactId: 1, occurredAt: d2, serviceType: "barba" },
 *     { contactId: 2, occurredAt: d3, serviceType: "corte" },
 *     { contactId: 2, occurredAt: d4, serviceType: "barba" },
 *     { contactId: 3, occurredAt: d5, serviceType: "corte" }
 *   ], 2)
 *   // → [{ a: "barba", b: "corte", cooccurrence: 2, supportA: 2, supportB: 3,
 *   //     confidenceAtoB: 100, confidenceBtoA: 66.67 }]
 */
export function findServicePairs(
  records: ServiceRecord[],
  minSupport: number = DEFAULT_MIN_SUPPORT
): ServicePair[] {
  const byContact = groupByContact(records);

  // Contador de support individual (quantos clientes têm cada serviço)
  const supportCount = new Map<string, number>();
  // Contador de coocorrência (pares "a||b" → count)
  const pairCount = new Map<string, number>();

  for (const services of Array.from(byContact.values())) {
    const list = Array.from(services);
    for (const s of list) {
      supportCount.set(s, (supportCount.get(s) || 0) + 1);
    }
    for (const [a, b] of generatePairs(list)) {
      const key = `${a}||${b}`;
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  }

  // Monta resultado, aplica filtro de support mínimo
  const pairs: ServicePair[] = [];
  for (const [key, cooccurrence] of Array.from(pairCount.entries())) {
    if (cooccurrence < minSupport) continue;

    const [a, b] = key.split("||");
    const supportA = supportCount.get(a) || 0;
    const supportB = supportCount.get(b) || 0;

    pairs.push({
      a,
      b,
      cooccurrence,
      supportA,
      supportB,
      confidenceAtoB: supportA > 0
        ? Math.round((cooccurrence / supportA) * 10000) / 100
        : 0,
      confidenceBtoA: supportB > 0
        ? Math.round((cooccurrence / supportB) * 10000) / 100
        : 0
    });
  }

  // Ordena: maior confidence média primeiro, depois maior coocorrência
  pairs.sort((p1, p2) => {
    const avg1 = (p1.confidenceAtoB + p1.confidenceBtoA) / 2;
    const avg2 = (p2.confidenceAtoB + p2.confidenceBtoA) / 2;
    if (avg2 !== avg1) return avg2 - avg1;
    return p2.cooccurrence - p1.cooccurrence;
  });

  return pairs;
}

// ── Função principal: suggestServicesForContact ───────────────────

/**
 * Sugere serviços que o cliente ainda NÃO consumiu, baseado em pares
 * frequentes calculados sobre toda a base.
 *
 * @param contactServices Conjunto de serviços JÁ consumidos pelo cliente
 * @param allPairs Pares globais (saída de findServicePairs)
 * @param minConfidence Confidence mínimo para sugerir (default: 30%)
 * @param maxSuggestions Máximo de sugestões retornadas (default: 5)
 * @returns Sugestões ordenadas por confidence
 *
 * @example
 *   suggestServicesForContact(
 *     new Set(["corte"]),
 *     pairs,  // contém { a: "barba", b: "corte", confidenceBtoA: 80, ... }
 *     30
 *   )
 *   // → [{ suggestedService: "barba", basedOnService: "corte", confidence: 80, ... }]
 */
export function suggestServicesForContact(
  contactServices: Set<string>,
  allPairs: ServicePair[],
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
  maxSuggestions: number = 5
): CrossSellSuggestion[] {
  const suggestions: CrossSellSuggestion[] = [];

  for (const pair of allPairs) {
    // Para cada serviço já consumido, ver se o par sugere o outro
    const hasA = contactServices.has(pair.a);
    const hasB = contactServices.has(pair.b);

    // Cliente já tem ambos → não sugere
    if (hasA && hasB) continue;
    // Cliente não tem nenhum dos dois → pula (não temos base)
    if (!hasA && !hasB) continue;

    if (hasA && !hasB && pair.confidenceAtoB >= minConfidence) {
      suggestions.push({
        suggestedService: pair.b,
        basedOnService: pair.a,
        confidence: pair.confidenceAtoB,
        cooccurrence: pair.cooccurrence
      });
    } else if (hasB && !hasA && pair.confidenceBtoA >= minConfidence) {
      suggestions.push({
        suggestedService: pair.a,
        basedOnService: pair.b,
        confidence: pair.confidenceBtoA,
        cooccurrence: pair.cooccurrence
      });
    }
  }

  // Remove duplicatas de sugestão (mesmo suggestedService pode aparecer 2x)
  // Mantém a maior confidence
  const bestPerService = new Map<string, CrossSellSuggestion>();
  for (const s of suggestions) {
    const existing = bestPerService.get(s.suggestedService);
    if (!existing || existing.confidence < s.confidence) {
      bestPerService.set(s.suggestedService, s);
    }
  }

  return Array.from(bestPerService.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxSuggestions);
}
