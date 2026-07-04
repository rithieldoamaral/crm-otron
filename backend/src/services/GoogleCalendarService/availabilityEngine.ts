/**
 * availabilityEngine — lógica pura de disponibilidade de horários.
 * Recebe horários de trabalho + eventos ocupados + duração do serviço.
 * Retorna lista de slots disponíveis no formato "HH:MM".
 * Sem dependências externas — 100% determinístico e testável.
 */

export interface WorkingDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isWorking: boolean;
}

export interface BusyPeriod {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface SlotInput {
  date: string;         // "YYYY-MM-DD"
  durationMinutes: number;
  workingHours: WorkingDay;
  busyPeriods: BusyPeriod[];
  /**
   * Momento atual para filtrar slots no passado (bug #12 round 4).
   * Quando informado:
   *  - date < today (BRT): retorna []  (data passada não é agendável)
   *  - date == today (BRT): filtra slots cuja hora já passou
   *  - date > today (BRT): nenhum filtro adicional
   * Quando ausente, mantém comportamento legado (sem filtro temporal).
   */
  now?: Date;
}

export interface NormalizedDay {
  start: string;
  end: string;
  works: boolean;
}

// Nomes dos dias da semana em PT-BR, indexados por Date.getDay() (0=domingo, 6=sábado)
const DAY_NAMES_PT = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado"
];

/**
 * Formata uma data ISO ("YYYY-MM-DD") como dia-da-semana + data por extenso em
 * PT-BR para apresentação humana ao cliente. Ex: "segunda-feira, 22/06/2026".
 *
 * Por que isso existe (Problema do dia da semana, 2026-06-20):
 * - A regra antiga (Bug #5) PROIBIA o agente de dizer o dia da semana porque o
 *   LLM errava o cálculo de cabeça. O cliente perguntava "22 é que dia?" e o bot
 *   se esquivava ("recomendo conferir no seu calendário") — robótico e ruim.
 * - Esta função calcula o dia da semana DETERMINISTICAMENTE no backend (o LLM
 *   nunca calcula — apenas repassa a string pronta). Devolvida como campo
 *   `dataFormatada` pelas tools de calendário, o agente apresenta com naturalidade.
 *
 * Vive aqui (GoogleCalendarService, domínio de calendário) e não em agentUtils
 * para evitar ciclo de dependência entre as pastas — AgentService já importa
 * deste módulo (CLAUDE.md II.4).
 *
 * O weekday é derivado de `new Date(y, m-1, d)` (meia-noite LOCAL da data
 * informada) — TZ-independente, mesmo padrão anti-Bug #10.
 *
 * @param iso - Data no formato "YYYY-MM-DD"
 * @returns "dia-da-semana, DD/MM/AAAA" — ou a string original se o formato for inválido
 *
 * @example
 * formatDateWithWeekdayBRT("2026-06-22") // → "segunda-feira, 22/06/2026"
 */
export function formatDateWithWeekdayBRT(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return iso ?? "";
  const [, y, m, d] = match;
  const dayOfWeek = new Date(Number(y), Number(m) - 1, Number(d)).getDay();
  return `${DAY_NAMES_PT[dayOfWeek]}, ${d}/${m}/${y}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function normalizeWorkingHours(day: WorkingDay): NormalizedDay {
  return { start: day.startTime, end: day.endTime, works: day.isWorking };
}

/**
 * Verifica se um slot cabe dentro do horário de trabalho.
 * Um slot é válido se: startTime >= workStart && startTime + duration <= workEnd.
 */
export function isWithinWorkingHours(
  slotTime: string,
  durationMinutes: number,
  workStart: string,
  workEnd: string
): boolean {
  const slot = timeToMinutes(slotTime);
  const slotEnd = slot + durationMinutes;
  const start = timeToMinutes(workStart);
  const end = timeToMinutes(workEnd);
  return slot >= start && slotEnd <= end;
}

/**
 * Remove da lista de slots aqueles que conflitam com períodos ocupados.
 * Um slot conflita se: slot < busyEnd && slot + duration > busyStart
 */
export function subtractBusyPeriods(
  slots: string[],
  busyPeriods: BusyPeriod[],
  durationMinutes: number
): string[] {
  return slots.filter(slot => {
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + durationMinutes;
    return !busyPeriods.some(busy => {
      const busyStart = timeToMinutes(busy.start);
      const busyEnd = timeToMinutes(busy.end);
      return slotStart < busyEnd && slotEnd > busyStart;
    });
  });
}

/**
 * Formata uma Date como "YYYY-MM-DD" em fuso BRT.
 * Helper interno — usado pelo filtro de slots passados.
 */
function isoDateBRT(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

/**
 * Retorna a hora atual em BRT no formato "HH:MM".
 */
function hhmmBRT(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

/**
 * Filtra slots cujo horário já passou em relação a `now` (apenas se
 * `dateStr` corresponder ao dia atual no fuso BRT).
 *
 * Bug #12 (Round 4): sem este filtro, em 27/04 19:46 BRT a tool oferecia
 * 09:00–17:00 ao cliente — todos no passado. LLM então confirmava
 * agendamento para horários já decorridos.
 */
function filterPastSlots(slots: string[], dateStr: string, now: Date): string[] {
  const today = isoDateBRT(now);
  if (dateStr < today) return []; // data passada — nada agendável
  if (dateStr > today) return slots; // futuro — sem filtro temporal
  // dia atual: descarta slots cuja hora já passou
  const currentHHMM = hhmmBRT(now);
  return slots.filter(s => s > currentHHMM);
}

/** Período do dia para filtragem determinística de slots. */
export type DayPeriod = "manha" | "tarde" | "noite";

/**
 * Normaliza um termo de período em linguagem natural para o enum interno.
 * Aceita PT ("manhã"/"manha"/"tarde"/"noite"), EN ("morning"/"afternoon"/
 * "evening"/"night") e variações com acento, maiúsculas e espaços/prefixos
 * ("à tarde"). Retorna null quando não reconhecido — o caller então não aplica
 * filtro de período (comportamento retroativo: devolve o dia inteiro).
 *
 * Bug #35 (2026-05-28): antes, o filtro de período era responsabilidade do LLM.
 * gpt-4o-mini falhava ao filtrar a "tarde" de uma lista do dia inteiro e
 * respondia "não consegui verificar a disponibilidade". Mover a lógica para cá
 * a torna determinística (CLAUDE.md I — lógica de negócio não é probabilística).
 */
export function normalizePeriod(raw?: string | null): DayPeriod | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos combinantes (manhã → manha)
  if (s.includes("manh") || s.includes("morning") || s.includes("cedo")) return "manha";
  if (s.includes("tard") || s.includes("afternoon")) return "tarde";
  if (s.includes("noit") || s.includes("evening") || s.includes("night")) return "noite";
  return null;
}

/**
 * Filtra slots "HH:MM" pelo período do dia. Fronteiras:
 *   - manhã: 00:00 ≤ slot < 12:00
 *   - tarde: 12:00 ≤ slot < 18:00
 *   - noite: 18:00 ≤ slot < 24:00
 *
 * Quando `periodo` é null/undefined/não reconhecido, retorna a lista intacta.
 */
export function filterSlotsByPeriod(slots: string[], periodo?: string | null): string[] {
  const p = normalizePeriod(periodo);
  if (!p) return slots;
  const NOON = 12 * 60;
  const EVENING = 18 * 60;
  return slots.filter(slot => {
    const min = timeToMinutes(slot);
    if (p === "manha") return min < NOON;
    if (p === "tarde") return min >= NOON && min < EVENING;
    return min >= EVENING; // noite
  });
}

/**
 * Calcula todos os slots disponíveis para um profissional em um dia específico.
 * Slots são gerados a cada `durationMinutes` a partir do início do expediente.
 *
 * Quando `input.now` é informado, slots no passado são filtrados (bug #12).
 */
export function calculateAvailableSlots(input: SlotInput): string[] {
  const { durationMinutes, workingHours, busyPeriods, date, now } = input;
  const normalized = normalizeWorkingHours(workingHours);

  if (!normalized.works) return [];

  const startMin = timeToMinutes(normalized.start);
  const endMin = timeToMinutes(normalized.end);

  // Bug #38 (2026-05-31): com slotInterval = Math.min(durationMinutes, 60), um
  // serviço de 58 min gerava passo de 58 min — o grid partia de 09:00 e produzia
  // 09:00, 09:58, 10:56, 11:54, 12:52 … Clientes viam horários "quebrados"
  // como 12:52 em vez de 13:00. Fix: ancorar sempre a 30 ou 60 min, conforme
  // o serviço (≤30 min → grade de meia-hora; qualquer outro → hora cheia).
  const slotInterval = durationMinutes <= 30 ? 30 : 60;
  const allSlots: string[] = [];
  for (let t = startMin; t + durationMinutes <= endMin; t += slotInterval) {
    allSlots.push(minutesToTime(t));
  }

  const free = subtractBusyPeriods(allSlots, busyPeriods, durationMinutes);
  return now ? filterPastSlots(free, date, now) : free;
}

/**
 * Converte uma lista ordenada de slots em faixas contíguas de disponibilidade,
 * formatadas em português para apresentação ao cliente.
 *
 * Dois slots adjacentes são considerados "contíguos" quando a diferença entre
 * eles é exatamente `slotInterval` (30 min para serviços ≤ 30 min, 60 min para
 * os demais). Um gap maior que o intervalo indica um período ocupado entre eles.
 *
 * O fim de cada faixa é calculado como `últimoSlotDaFaixa + slotInterval`,
 * representando "até quando há disponibilidade" — não o horário de término do
 * último agendamento, mas a próxima janela que já não está disponível.
 *
 * Feature UX-1 (2026-05-31): antes, o LLM listava cada slot individualmente
 * ("12:00, 13:00, 14:00, 15:00, 16:00, 17:00"), o que era verboso e difícil
 * de ler no WhatsApp. A apresentação como faixa ("das 12:00 às 18:00") é mais
 * natural e reduz o número de tokens na resposta do agente.
 *
 * @param slots    Lista de horários disponíveis no formato "HH:MM", ordenada.
 * @param durationMinutes  Duração do serviço em minutos (para calcular slotInterval).
 * @returns Faixas no formato "das HH:MM às HH:MM" unidas por " e ".
 *          Retorna "" quando `slots` está vazio.
 *
 * @example
 * // Tarde inteira livre
 * slotsToRanges(["12:00","13:00","14:00","15:00","16:00","17:00"], 58)
 * // → "das 12:00 às 18:00"
 *
 * @example
 * // Com lacuna em 15:00 (compromisso já marcado)
 * slotsToRanges(["13:00","14:00","16:00","17:00"], 60)
 * // → "das 13:00 às 15:00 e das 16:00 às 18:00"
 */
export function slotsToRanges(slots: string[], durationMinutes: number): string {
  if (slots.length === 0) return "";

  // Mesmo critério de slotInterval usado em calculateAvailableSlots
  const interval = durationMinutes <= 30 ? 30 : 60;

  const ranges: { start: number; end: number }[] = [];
  let rangeStart = timeToMinutes(slots[0]);
  let prevMin = rangeStart;

  for (let i = 1; i < slots.length; i++) {
    const curr = timeToMinutes(slots[i]);
    if (curr - prevMin > interval) {
      // Lacuna detectada — fecha a faixa atual e abre uma nova
      ranges.push({ start: rangeStart, end: prevMin + interval });
      rangeStart = curr;
    }
    prevMin = curr;
  }
  // Fecha a última faixa
  ranges.push({ start: rangeStart, end: prevMin + interval });

  return ranges
    .map(r => `das ${minutesToTime(r.start)} às ${minutesToTime(r.end)}`)
    .join(" e ");
}
