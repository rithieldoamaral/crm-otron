/**
 * Gera um link pré-preenchido do Google Calendar para o cliente adicionar o
 * agendamento ao seu calendário pessoal com um clique, sem necessidade de
 * email ou OAuth.
 *
 * A URL usa o formato `action=TEMPLATE` do Google Calendar, que abre a tela
 * de criação de evento com título, data, hora e detalhes já preenchidos.
 * O cliente só clica em "Salvar" para adicionar ao seu calendário.
 */

interface GoogleCalendarLinkArgs {
  /** Título do evento (ex: "Reparo de dentes — Barbearia X") */
  title: string;
  /** Data no formato "YYYY-MM-DD" (horário local do cliente) */
  data: string;
  /** Hora no formato "HH:MM" (horário local do cliente) */
  hora: string;
  /** Duração do serviço em minutos — define a hora de término */
  durationMinutes: number;
  /** Detalhes adicionais opcionais (ex: "Profissional: Dr. Carlos") */
  details?: string;
}

/**
 * Converte data + hora em string de data Google Calendar (sem timezone).
 * Formato: YYYYMMDDTHHmmss — tratado como horário local pelo Google Calendar.
 *
 * @param data  - "YYYY-MM-DD"
 * @param hora  - "HH:MM"
 * @returns       "YYYYMMDDTHHmmss"
 */
function toGCalDateTime(data: string, hora: string): string {
  return `${data.replace(/-/g, "")}T${hora.replace(":", "")}00`;
}

/**
 * Soma minutos a uma data/hora local (sem conversão UTC), lidando com
 * overflow de meia-noite quando a duração do serviço cruza o dia.
 *
 * @param data           - "YYYY-MM-DD"
 * @param hora           - "HH:MM"
 * @param durationMinutes - duração em minutos a somar
 * @returns               Fim do evento no formato "YYYYMMDDTHHmmss"
 */
function addMinutesToGCalDateTime(
  data: string,
  hora: string,
  durationMinutes: number
): string {
  const [hStr, mStr] = hora.split(":");
  let totalMin = parseInt(hStr, 10) * 60 + parseInt(mStr, 10) + durationMinutes;

  // Avança o dia para cada 24h cheias (raro para serviços, mas defensivo)
  let datePart = data;
  while (totalMin >= 24 * 60) {
    // Usa UTC para avançar o dia sem ambiguidade de DST
    const d = new Date(`${datePart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    datePart = d.toISOString().slice(0, 10);
    totalMin -= 24 * 60;
  }

  const endHour = String(Math.floor(totalMin / 60)).padStart(2, "0");
  const endMin = String(totalMin % 60).padStart(2, "0");
  return `${datePart.replace(/-/g, "")}T${endHour}${endMin}00`;
}

/**
 * Gera a URL do Google Calendar com o evento pré-preenchido.
 *
 * @param args - Parâmetros do evento (ver GoogleCalendarLinkArgs)
 * @returns     URL completa e codificada para o Google Calendar
 *
 * @example
 * const link = gerarLinkGoogleCalendar({
 *   title: "Corte de cabelo",
 *   data: "2026-05-15",
 *   hora: "14:00",
 *   durationMinutes: 30,
 *   details: "Profissional: Carlos"
 * });
 * // https://calendar.google.com/calendar/render?action=TEMPLATE&text=...
 */
export function gerarLinkGoogleCalendar(args: GoogleCalendarLinkArgs): string {
  const { title, data, hora, durationMinutes, details } = args;

  const start = toGCalDateTime(data, hora);
  const end = addMinutesToGCalDateTime(data, hora, durationMinutes);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${start}/${end}`,
  });

  if (details) {
    params.set("details", details);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
