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
