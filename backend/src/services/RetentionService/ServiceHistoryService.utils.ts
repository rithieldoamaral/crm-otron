/**
 * ServiceHistoryService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para permitir testes unitários sem puxar Sequelize/UpdateTicketService/Socket.
 * A camada de I/O vive em `ServiceHistoryService.ts`.
 */

// ── Types ──────────────────────────────────────────────────────────

/**
 * Representação mínima de uma tag suficiente para a decisão de conclusão.
 * Aceita Tag completa do Sequelize ou stub de testes.
 */
export interface TagLike {
  isCompletionTag?: boolean;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Verifica se a lista de tags contém alguma marcada como "tag de conclusão"
 * (fim do funil Kanban).
 *
 * Regra: basta UM elemento com `isCompletionTag === true` para retornar true.
 * Valores ausentes (`undefined`) ou `false` são considerados não-conclusivos.
 *
 * @param tags Lista de tags aplicadas ao ticket (pode ser vazia ou stubs)
 * @returns true se alguma tag é de conclusão, false caso contrário
 *
 * @example
 *   hasCompletionTag([{ isCompletionTag: false }, { isCompletionTag: true }])
 *   // → true
 *
 *   hasCompletionTag([])
 *   // → false
 */
export function hasCompletionTag(tags: TagLike[]): boolean {
  return tags.some(t => t.isCompletionTag === true);
}

/**
 * Item mínimo para agrupamento de histórico por contato.
 */
export interface ContactHistoryRow {
  contactId: number;
  occurredAt: Date;
}

/**
 * Agrupa uma lista PLANA de histórico (já ordenada por `occurredAt` DESC dentro
 * de cada contato — ou globalmente) em um mapa `contactId -> registros`,
 * mantendo no máximo `limit` registros mais recentes por contato.
 *
 * PORQUÊ (ITEM C — escala): os endpoints de retenção faziam N+1 — uma query
 * `listForContact` (com `limit: 50`, ORDER BY occurredAt DESC) por contato.
 * Para empresas com >1k contatos isso são >1k round-trips ao banco. Carregar
 * todo o histórico da empresa em UMA query e agrupar em memória aqui elimina o
 * N+1 SEM alterar nenhum número: cada grupo recebe exatamente os mesmos até-N
 * registros mais recentes que `listForContact` retornaria.
 *
 * PRÉ-CONDIÇÃO: `rows` deve estar ordenado de forma que, para cada contato, os
 * registros venham do mais recente para o mais antigo (equivalente a
 * `ORDER BY occurredAt DESC`). O caller garante isso na query. Como defesa,
 * cada grupo é reordenado DESC antes do corte, tornando a função robusta a
 * ordenação global imperfeita sem custo relevante (grupos são pequenos).
 *
 * @param rows - Registros planos com `contactId` e `occurredAt`.
 * @param limit - Máximo de registros por contato (default 50, igual a
 *   `listForContact`). `limit <= 0` retorna grupos vazios.
 * @returns Mapa `contactId -> registros[]` (cada lista com <= `limit` itens,
 *   ordenada DESC por `occurredAt`).
 *
 * @example
 *   groupHistoryByContact([
 *     { contactId: 1, occurredAt: new Date("2026-05-10") },
 *     { contactId: 1, occurredAt: new Date("2026-04-01") },
 *     { contactId: 2, occurredAt: new Date("2026-05-05") }
 *   ], 50);
 *   // → Map { 1 => [10/05, 01/04], 2 => [05/05] }
 */
export function groupHistoryByContact<T extends ContactHistoryRow>(
  rows: T[],
  limit = 50
): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    if (row.contactId == null) continue;
    const list = grouped.get(row.contactId);
    if (list) {
      list.push(row);
    } else {
      grouped.set(row.contactId, [row]);
    }
  }

  if (limit <= 0) {
    for (const key of grouped.keys()) grouped.set(key, []);
    return grouped;
  }

  // Reordena DESC e aplica o cap por contato — paridade exata com listForContact
  // (ORDER BY occurredAt DESC, LIMIT n).
  for (const [key, list] of grouped) {
    list.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    if (list.length > limit) {
      grouped.set(key, list.slice(0, limit));
    }
  }

  return grouped;
}
