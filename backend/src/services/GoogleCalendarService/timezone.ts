/**
 * timezone — helpers PUROS de conversão de horário de parede BRT para instante UTC.
 * Sem dependências externas — 100% determinístico e testável (CLAUDE.md II.1).
 *
 * CONTEXTO (Bug #36, 2026-05-28):
 * O caminho de ESCRITA das tools de calendário (criar_evento / reagendar_evento)
 * montava o instante do agendamento com `new Date(`${data}T${hora}:00`)`, SEM
 * offset de fuso. Em Node, uma string ISO sem offset é interpretada no fuso LOCAL
 * do processo. Em produção o servidor roda em UTC (container Docker, sem env TZ),
 * então "14:00" virava 14:00 UTC = 11:00 BRT — o evento era criado 3 HORAS
 * ADIANTADO no relógio do cliente. Pior: a guarda determinística de "horário no
 * passado" (Bug #13) podia REJEITAR horários futuros válidos no fim da tarde,
 * porque comparava um instante 3h adiantado contra `Date.now()`.
 *
 * O caminho de LEITURA (getBusyPeriods) já havia sido corrigido no Bug #33 usando
 * offset explícito `-03:00`. A escrita ficou pendente — este módulo fecha a lacuna.
 *
 * Brasil aboliu o horário de verão em 2019, então o offset de BRT é FIXO em -03:00
 * o ano inteiro. Fixá-lo explicitamente torna o instante independente do fuso do
 * processo (dev em BRT, produção em UTC, CI em qualquer lugar).
 */

/** Offset fixo do horário de Brasília (BRT). Sem DST desde 2019. */
export const BRT_OFFSET = "-03:00";

/**
 * Converte data ("YYYY-MM-DD") + hora ("HH:MM") interpretadas como horário de
 * PAREDE em Brasília (BRT) no instante absoluto (Date) correspondente.
 *
 * @param data - Data no formato "YYYY-MM-DD"
 * @param hora - Hora no formato "HH:MM" (24h)
 * @returns Date apontando para o instante UTC correto daquele horário de parede BRT
 *
 * @example
 * // 14:00 BRT === 17:00 UTC, independente do fuso do servidor
 * brtWallClockToInstant("2026-05-29", "14:00").toISOString()
 * // => "2026-05-29T17:00:00.000Z"
 */
export function brtWallClockToInstant(data: string, hora: string): Date {
  return new Date(`${data}T${hora}:00${BRT_OFFSET}`);
}
