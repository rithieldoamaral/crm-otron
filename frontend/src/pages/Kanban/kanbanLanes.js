/**
 * kanbanLanes — lógica pura de distribuição de tickets nas lanes do Kanban.
 * Separada do componente para permitir testes unitários isolados.
 */

/**
 * Calcula quantidades por lane.
 * @param {Array} tickets
 * @param {Array} tags
 * @returns {Object} mapa laneId → count
 */
export function calcLaneQuantities(tickets, tags) {
  const quantities = {};
  quantities["ai"] = tickets.filter(t => t.chatbot && t.tags.length === 0).length;
  quantities["0"] = tickets.filter(t => !t.chatbot && t.tags.length === 0).length;
  tags.forEach(tag => {
    quantities[tag.id.toString()] = tickets.filter(t =>
      t.tags.some(tt => tt.id === tag.id)
    ).length;
  });
  return quantities;
}

/**
 * Filtra tickets da lane "Agente IA":
 * chatbot ativo e sem tags atribuídas.
 * @param {Array} tickets
 * @returns {Array}
 */
export function agentLaneTickets(tickets) {
  return tickets.filter(t => t.chatbot && t.tags.length === 0);
}

/**
 * Filtra tickets da lane "Em aberto":
 * sem chatbot e sem tags atribuídas.
 * @param {Array} tickets
 * @returns {Array}
 */
export function openLaneTickets(tickets) {
  return tickets.filter(t => !t.chatbot && t.tags.length === 0);
}

/**
 * Filtra tickets de uma lane de tag específica.
 * @param {Array} tickets
 * @param {number} tagId
 * @returns {Array}
 */
export function tagLaneTickets(tickets, tagId) {
  return tickets.filter(t => t.tags.some(tt => tt.id === tagId));
}
