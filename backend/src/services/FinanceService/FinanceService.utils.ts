/**
 * FinanceService.utils — Funções puras para o módulo financeiro.
 *
 * Zero I/O. Sem imports de Sequelize, wbot ou baileys.
 * Todas as funções são determinísticas e testáveis isoladamente.
 *
 * Responsabilidades:
 *   - `calculateGrowthRate`      — % de crescimento entre dois períodos
 *   - `calculateAverageTicket`   — ticket médio (receita / nº transações)
 *   - `getWeekdayName`           — nome PT-BR de um dia da semana por índice
 *   - `applyDateRangeDefaults`   — aplica defaults de período (início do mês até agora)
 *   - `buildPreviousPeriod`      — calcula período anterior com mesma duração
 *
 * Diretiva: Fase 7 — Módulo Financeiro Real.
 */

// ── calculateGrowthRate ───────────────────────────────────────────────────────

/**
 * Calcula a taxa de crescimento percentual entre dois períodos.
 *
 * @param current  - Valor do período atual
 * @param previous - Valor do período anterior
 * @returns Variação em % (1 casa decimal), ou null se previous = 0
 *
 * @example
 *   calculateGrowthRate(300, 200)  // 50
 *   calculateGrowthRate(100, 200)  // -50
 *   calculateGrowthRate(100, 0)    // null
 */
export function calculateGrowthRate(
  current: number,
  previous: number
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── calculateAverageTicket ────────────────────────────────────────────────────

/**
 * Calcula o ticket médio (valor médio por transação).
 *
 * @param totalRevenue - Receita total do período
 * @param count        - Número de transações no período
 * @returns Ticket médio arredondado a 2 casas, ou null se count = 0
 *
 * @example
 *   calculateAverageTicket(400, 4)  // 100
 *   calculateAverageTicket(100, 3)  // 33.33
 *   calculateAverageTicket(400, 0)  // null
 */
export function calculateAverageTicket(
  totalRevenue: number,
  count: number
): number | null {
  if (count === 0) return null;
  return Math.round((totalRevenue / count) * 100) / 100;
}

// ── getWeekdayName ────────────────────────────────────────────────────────────

const WEEKDAY_NAMES_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/**
 * Retorna o nome em PT-BR de um dia da semana pelo índice (0 = Domingo).
 *
 * @param dayIndex - Índice do dia (0–6, conforme Date.getDay())
 * @returns Nome do dia em português, ou "Desconhecido" para índice inválido
 *
 * @example
 *   getWeekdayName(0) // "Domingo"
 *   getWeekdayName(5) // "Sexta"
 *   getWeekdayName(7) // "Desconhecido"
 */
export function getWeekdayName(dayIndex: number): string {
  return WEEKDAY_NAMES_PT[dayIndex] ?? "Desconhecido";
}

// ── applyDateRangeDefaults ────────────────────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Detecta se uma string está no formato YYYY-MM-DD (data sem timestamp).
 * Usado para decidir se devemos estender para start/end-of-day.
 */
function isDateOnly(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

/**
 * Parseia uma string ISO de forma defensiva: retorna null se inválida ou vazia.
 * `new Date("xyz")` retorna `Invalid Date` cujo `.getTime()` é `NaN`.
 */
function safeParseDate(input?: string): Date | null {
  if (!input || !input.trim()) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Aplica valores padrão a um intervalo de datas com defesas anti-bug:
 *
 * - `startDate` ausente/inválido → 1º dia do mês da referência (00:00:00.000 UTC)
 * - `endDate` ausente/inválido   → data de referência (agora)
 * - `startDate` em YYYY-MM-DD → início do dia (00:00:00.000 UTC)
 * - `endDate` em YYYY-MM-DD → **fim do dia** (23:59:59.999 UTC) — corrige bug
 *   onde "2026-05-22" virava 00:00 e excluía todo o dia 22 do BETWEEN.
 * - Timestamps explícitos (ISO completo) são preservados sem modificação.
 *
 * @param startDate     - Data inicial opcional (string ISO ou undefined)
 * @param endDate       - Data final opcional (string ISO ou undefined)
 * @param referenceDate - Data de referência para defaults. Default: new Date()
 * @returns { start: Date, end: Date }
 *
 * @example
 *   applyDateRangeDefaults("2026-05-01", "2026-05-22")
 *   // { start: 2026-05-01T00:00:00.000Z, end: 2026-05-22T23:59:59.999Z }
 */
export function applyDateRangeDefaults(
  startDate?: string,
  endDate?: string,
  referenceDate?: Date
): DateRange {
  const now = referenceDate ?? new Date();

  // Default start: 1º do mês UTC
  const defaultStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );

  // Parse start: YYYY-MM-DD → 00:00:00.000Z (comportamento padrão do JS),
  // timestamp explícito → preservado, inválido/vazio → default
  const parsedStart = safeParseDate(startDate);
  const start = parsedStart ?? defaultStart;

  // Parse end: YYYY-MM-DD → estender para 23:59:59.999Z (corrige o bug),
  // timestamp explícito → preservado, inválido/vazio → referência (now)
  let end: Date;
  if (endDate && isDateOnly(endDate)) {
    end = new Date(`${endDate}T23:59:59.999Z`);
  } else {
    end = safeParseDate(endDate) ?? now;
  }

  return { start, end };
}

// ── clampLimit ────────────────────────────────────────────────────────────────

/**
 * Sanitiza um parâmetro `limit` vindo de fonte não-confiável (query string ou LLM).
 * Defende contra NaN (ex: "abc"), zero, negativo, fração e overflow.
 *
 * @param raw - Valor bruto (pode ser qualquer coisa: string, number, undefined)
 * @param max - Teto máximo permitido (default: 50)
 * @param def - Valor padrão se raw for inválido (default: 10)
 * @returns Inteiro positivo entre 1 e max
 *
 * @example
 *   clampLimit("8", 20, 10)  // 8
 *   clampLimit(100, 20, 10)  // 20
 *   clampLimit("abc", 20, 10) // 10
 *   clampLimit(0, 20, 10)    // 10
 */
export function clampLimit(raw: unknown, max = 50, def = 10): number {
  const parsed = Math.floor(Number(raw));
  if (!isFinite(parsed) || parsed <= 0) return def;
  return Math.min(parsed, max);
}

// ── buildPreviousPeriod ───────────────────────────────────────────────────────

/**
 * Calcula o período anterior com a mesma duração do período fornecido.
 *
 * Usado para calcular a taxa de crescimento: compara o período atual com
 * um período imediatamente anterior de igual duração.
 *
 * @param start - Início do período atual
 * @param end   - Fim do período atual
 * @returns { start, end } do período anterior (mesmo número de milissegundos)
 *
 * @example
 *   // Período 01/05 – 31/05 (30 dias) → anterior: 01/04 – 01/05
 *   buildPreviousPeriod(new Date("2026-05-01"), new Date("2026-05-31"))
 */
export function buildPreviousPeriod(start: Date, end: Date): DateRange {
  const duration = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - duration),
    end: new Date(end.getTime() - duration),
  };
}
