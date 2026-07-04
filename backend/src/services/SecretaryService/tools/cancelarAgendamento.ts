/**
 * Tool: cancelar_agendamento
 * Admin cancela um agendamento existente.
 *
 * Ordem de operações:
 *   1. Verifica se o agendamento existe e não está já cancelado.
 *   2. Se há googleEventId e UserCalendar do profissional, deleta o evento do Calendar.
 *      Falha aqui não impede o cancelamento no BD (evento pode já ter sido deletado).
 *   3. Atualiza reminderStatus → "cancelled" no Schedule.
 *
 * Por que não deletar o registro: preservar histórico para relatórios e auditoria.
 */

import Schedule from "../../../models/Schedule";
import UserCalendar from "../../../models/UserCalendar";
import Contact from "../../../models/Contact";
import { deleteCalendarEvent } from "../../GoogleCalendarService/calendarApi";
import { logger } from "../../../utils/logger";

interface CancelarAgendamentoArgs {
  /** ID do agendamento a cancelar. */
  scheduleId: number;
}

interface CancelarAgendamentoResult {
  sucesso: boolean;
  mensagem?: string;
  /**
   * Presente quando o cancelamento no BD foi feito mas a deleção do
   * Google Calendar falhou (ex.: evento já deletado externamente).
   * Sucesso=true mesmo assim — o agendamento está cancelado no sistema.
   */
  aviso?: string;
  erro?: string;
}

/**
 * Cancela um agendamento pelo ID.
 * Tenta remover o evento do Google Calendar antes de atualizar o BD.
 * Em caso de falha do Calendar, prossegue e retorna aviso.
 */
export async function cancelarAgendamento(
  args: CancelarAgendamentoArgs,
  companyId: number
): Promise<CancelarAgendamentoResult> {
  const schedule = await Schedule.findOne({
    where: { id: args.scheduleId, companyId },
    include: [{ model: Contact, as: "contact", attributes: ["name"] }]
  });

  if (!schedule) {
    return { sucesso: false, erro: `Agendamento #${args.scheduleId} não encontrado.` };
  }

  const s = schedule as any;

  if (s.status === "CANCELADO" || s.reminderStatus === "cancelled") {
    return { sucesso: false, erro: `Agendamento #${args.scheduleId} já cancelado.` };
  }

  // Tenta deletar do Google Calendar (best-effort)
  let calendarAviso: string | undefined;
  if (s.googleEventId) {
    const userCalendar = await UserCalendar.findOne({
      where: { userId: s.professionalId, companyId, isActive: true }
    });

    if (userCalendar) {
      try {
        await deleteCalendarEvent({
          calendarId: (userCalendar as any).calendarId,
          credentials: userCalendar as any,
          eventId: s.googleEventId
        });
      } catch (err) {
        calendarAviso =
          "Agendamento cancelado no sistema, mas não foi possível remover da agenda " +
          "Google do profissional — o evento pode precisar ser deletado manualmente.";
        logger.warn(
          `[cancelar_agendamento] falha ao deletar evento do Google Calendar ` +
          `(scheduleId=${args.scheduleId} eventId=${s.googleEventId}): ` +
          `${(err as Error).message}`
        );
      }
    }
    // Sem UserCalendar → pula silenciosamente (profissional sem Calendar conectado)
  }

  // Atualiza o BD independente do resultado do Calendar.
  // CORREÇÃO (2026-06-21): também marca status="CANCELADO". Antes gravava só
  // reminderStatus="cancelled", mas o Agente filtra agendamentos ativos por
  // `status` (buscarAgendamentoCliente: status NOT IN [CANCELADO]) — então um
  // cancelamento feito pela Secretária continuava aparecendo como ATIVO para o
  // Agente e na listagem do calendário. Agora os dois canais cancelam igual.
  await s.update({ status: "CANCELADO", reminderStatus: "cancelled" });

  const clienteNome = s.contact?.name ?? "cliente";
  return {
    sucesso: true,
    mensagem: `✅ Agendamento de ${clienteNome} (#${args.scheduleId}) cancelado.`,
    ...(calendarAviso ? { aviso: calendarAviso } : {})
  };
}

export const cancelarAgendamentoDefinition = {
  name: "cancelar_agendamento",
  description:
    "Cancela um agendamento existente pelo ID. " +
    "Remove o evento do Google Calendar do profissional quando possível. " +
    "Use quando o admin precisar cancelar um horário — por ausência do profissional, " +
    "pedido do cliente, ou qualquer outro motivo operacional.",
  parameters: {
    type: "object",
    properties: {
      scheduleId: { type: "number", description: "ID do agendamento a cancelar" }
    },
    required: ["scheduleId"]
  }
};
