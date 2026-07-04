/**
 * AutoCloseScheduledService — lógica PURA, sem dependências de I/O.
 *
 * Isolada em arquivo próprio para que os testes consigam importar sem puxar
 * UpdateTicketService → socket → JWT (que falha em ambiente de teste).
 *
 * A camada de I/O (`runAutoCloseScheduled`) vive em `AutoCloseScheduledService.ts`
 * e importa estas funções.
 */

// ── Constantes default ─────────────────────────────────────────────
export const DEFAULT_AUTO_CLOSE_MINUTES = 60;
export const DEFAULT_INACTIVITY_WINDOW = 15;

// ── Types ──────────────────────────────────────────────────────────
export interface AutoCloseConfig {
  autoCloseMinutes: number;
  inactivityWindow: number;
}

export interface ScheduleLike {
  sendAt: Date;
  ticketId: number | null;
}

export interface TicketLike {
  status: string;
}

export interface CloseDecision {
  shouldClose: boolean;
  reason: string;
}

/**
 * Decide se um agendamento com ticket associado deve ser auto-fechado.
 *
 * Regras (todas devem ser true para `shouldClose = true`):
 *   1. Schedule tem ticketId (não pode fechar o que não existe)
 *   2. Ticket está aberto (status diferente de 'closed')
 *   3. Passou autoCloseMinutes desde sendAt
 *   4. Não houve mensagem nos últimos inactivityWindow minutos
 *
 * @param schedule { sendAt, ticketId }
 * @param ticket { status }
 * @param lastMessageAt Data da última mensagem do ticket, ou null se não houver
 * @param config { autoCloseMinutes, inactivityWindow }
 * @param now Data de referência (default: agora). Injetável para testes.
 * @returns { shouldClose, reason }
 *
 * @example
 *   shouldCloseSchedule(
 *     { sendAt: new Date('2026-05-19T08:00:00Z'), ticketId: 42 },
 *     { status: 'open' },
 *     null,
 *     { autoCloseMinutes: 60, inactivityWindow: 15 },
 *     new Date('2026-05-19T09:30:00Z')
 *   )
 *   // → { shouldClose: true, reason: 'Timeout expirou e ticket inactive — pode fechar' }
 */
export function shouldCloseSchedule(
  schedule: ScheduleLike,
  ticket: TicketLike,
  lastMessageAt: Date | null,
  config: AutoCloseConfig,
  now: Date = new Date()
): CloseDecision {
  // Regra 1: precisa de ticket
  if (!schedule.ticketId) {
    return { shouldClose: false, reason: "Sem ticket associado (no ticket)" };
  }

  // Regra 2: ticket precisa estar aberto/pendente
  if (ticket.status === "closed") {
    return { shouldClose: false, reason: "Ticket já fechado (already closed)" };
  }

  // Regra 3: tempo de auto-close precisa ter passado
  const closeThreshold = new Date(schedule.sendAt.getTime() + config.autoCloseMinutes * 60_000);
  if (now < closeThreshold) {
    const minutesLeft = Math.ceil((closeThreshold.getTime() - now.getTime()) / 60_000);
    return {
      shouldClose: false,
      reason: `Não passou o prazo ainda (faltam ${minutesLeft} min) — antes do prazo / too early`
    };
  }

  // Regra 4: não pode haver interação recente (conversa ativa)
  if (lastMessageAt) {
    // Janela exclusiva no limite: msg em "exatamente N min atrás" considera-se FORA da janela
    const inactivityThreshold = new Date(now.getTime() - config.inactivityWindow * 60_000);
    if (lastMessageAt > inactivityThreshold) {
      const minutesSinceMsg = Math.floor((now.getTime() - lastMessageAt.getTime()) / 60_000);
      return {
        shouldClose: false,
        reason: `Interação recente (última msg há ${minutesSinceMsg} min, dentro de janela ${config.inactivityWindow}min) — active/recent`
      };
    }
  }

  return {
    shouldClose: true,
    reason: "Timeout expirou e ticket inactive — pode fechar"
  };
}
