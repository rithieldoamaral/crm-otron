/**
 * professionalColors — mapeamento determinístico de profissional → cor.
 *
 * Why: no calendário de agendamentos (react-big-calendar) precisamos diferenciar
 * visualmente os profissionais sem exigir configuração manual. Usar cor derivada
 * do id garante consistência entre páginas e sessões.
 *
 * How to apply: chame getProfessionalColor(professionalId) no eventPropGetter
 * do Calendar e na legenda de chips.
 */

// Paleta Material-Design-friendly, distinguível em fundos claros e escuros.
// 12 cores bem distintas — suporta até ~12 profissionais sem colisão direta.
export const PROFESSIONAL_COLOR_PALETTE = [
  "#1976d2", // blue
  "#388e3c", // green
  "#f57c00", // orange
  "#7b1fa2", // purple
  "#c2185b", // pink
  "#00796b", // teal
  "#fbc02d", // yellow
  "#5d4037", // brown
  "#455a64", // blue-grey
  "#d32f2f", // red
  "#0097a7", // cyan
  "#689f38", // light green
];

// Cor para id ausente (null/undefined) — usa a cor neutra (blue-grey).
const NEUTRAL_INDEX = 8;

/**
 * Retorna cor hex determinística para um profissionalId.
 * Usa módulo simples sobre a paleta — garante que ids consecutivos
 * peguem cores diferentes (sem depender de hash complexo).
 *
 * @param {number|string|null|undefined} id - professionalId do Schedule
 * @returns {string} cor hex "#rrggbb"
 */
export function getProfessionalColor(id) {
  if (id === null || id === undefined || id === "") {
    return PROFESSIONAL_COLOR_PALETTE[NEUTRAL_INDEX];
  }
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return PROFESSIONAL_COLOR_PALETTE[NEUTRAL_INDEX];
  }
  const idx = Math.abs(Math.trunc(n)) % PROFESSIONAL_COLOR_PALETTE.length;
  return PROFESSIONAL_COLOR_PALETTE[idx];
}
