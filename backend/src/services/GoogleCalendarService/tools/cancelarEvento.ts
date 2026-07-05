/**
 * Tool: cancelar_evento
 * Cancela agendamento: remove do Google Calendar e atualiza Schedule.
 * Se Google Calendar estiver offline, ainda cancela no banco (com aviso).
 */

import Schedule from "../../../models/Schedule";
import UserCalendar from "../../../models/UserCalendar";
import Contact from "../../../models/Contact";
import { deleteCalendarEvent, executeWithCalendarErrorHandling } from "../calendarApi";
import { logger } from "../../../utils/logger";
import { getIO } from "../../../libs/socket";

interface CancelarArgs { scheduleId: number; }

interface CancelarResult {
  sucesso: boolean;
  mensagem?: string;
  aviso?: string;
  erro?: string;
}

export async function cancelarEvento(
  args: CancelarArgs,
  companyId: number
): Promise<CancelarResult> {
  const schedule = await Schedule.findOne({
    where: { id: args.scheduleId, companyId },
    include: [{ model: Contact, as: "contact", attributes: ["name"] }]
  });

  if (!schedule) {
    return { sucesso: false, erro: `Agendamento #${args.scheduleId} não encontrado.` };
  }

  const s = schedule as any;

  // Furo #3 (2026-06-20): idempotência. Se o agendamento JÁ está cancelado,
  // não tentamos deletar de novo no Google (geraria 404/410 → falso alarme de
  // "cancelamento parcial"). LLMs baratos às vezes chamam cancelar_evento duas
  // vezes (cliente repete "cancela aí"). Resposta clara e honesta, sem efeito
  // colateral.
  if (s.status === "CANCELADO") {
    const nome = s.contact?.name ?? "cliente";
    return {
      sucesso: true,
      mensagem: `O agendamento #${args.scheduleId} de ${nome} já estava cancelado. Nenhuma ação necessária.`
    };
  }

  let googleFailed = false;
  let aviso: string | undefined;

  if (s.googleEventId && s.professionalId) {
    const userCalendar = await UserCalendar.findOne({
      where: { userId: s.professionalId, companyId, isActive: true }
    });

    if (userCalendar) {
      try {
        // Wrapper invalida UserCalendar.isActive=false se o token estiver morto
        // (invalid_grant / sem scope) e repropaga — o catch abaixo trata o
        // cancelamento parcial normalmente.
        await executeWithCalendarErrorHandling(
          () => deleteCalendarEvent({
            calendarId: (userCalendar as any).calendarId,
            credentials: userCalendar as any,
            eventId: s.googleEventId
          }),
          (userCalendar as any).id,
          "cancelar_evento"
        );
      } catch (err) {
        // Catch silencioso anterior fazia o LLM responder "✅ cancelado" enquanto
        // o evento permanecia vivo no Google Calendar. CLAUDE.md II.5 proíbe
        // catch sem log; e a mensagem ao cliente precisa refletir o estado real.
        googleFailed = true;
        logger.error(
          `[cancelar_evento] falha ao deletar do Google Calendar (scheduleId=${args.scheduleId} eventId=${s.googleEventId} company=${companyId}): ${(err as Error).message}`
        );
        aviso = "Não foi possível remover o evento da agenda do profissional no Google Calendar — verifique manualmente; pode ser necessário sincronização.";
      }
    }
  }

  await (schedule as any).update({ status: "CANCELADO", reminderStatus: "cancelled" });

  // Bug #26 (Round 10): emite socket event para o frontend remover o agendamento
  // do calendário em tempo real — sem isso, o evento permanecia visível até o
  // próximo refresh da página (e ainda voltaria, pois o ListService não filtrava
  // CANCELADO). Usa o mesmo canal que ScheduleController usa para updates.
  try {
    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-schedule`, {
      action: "delete",
      scheduleId: args.scheduleId
    });
  } catch (socketErr) {
    // Socket pode não estar disponível em testes ou em contextos isolados —
    // não bloqueia o cancelamento. O ListService já exclui CANCELADO do query,
    // então o calendário ficará correto no próximo carregamento de qualquer forma.
    logger.warn(`[cancelar_evento] falha ao emitir socket event (scheduleId=${args.scheduleId}): ${(socketErr as Error).message}`);
  }

  const clienteNome = s.contact?.name ?? "cliente";
  // Cancelamento parcial deve ter mensagem distinta — sem isso o LLM repassa
  // "✅ cancelado" idêntico ao caso de sucesso completo, induzindo o cliente.
  const mensagem = googleFailed
    ? `⚠️ Agendamento #${args.scheduleId} de ${clienteNome} cancelado parcialmente: marcado como CANCELADO no sistema, mas o evento ainda PODE permanecer na agenda do profissional. Recomende verificar.`
    : `✅ Agendamento #${args.scheduleId} de ${clienteNome} cancelado.`;

  return {
    sucesso: true,
    mensagem,
    ...(aviso ? { aviso } : {})
  };
}

export const cancelarEventoDefinition = {
  name: "cancelar_evento",
  description: "Cancela um agendamento e remove do Google Calendar do profissional.",
  parameters: {
    type: "object",
    properties: {
      scheduleId: { type: "number", description: "ID do agendamento a cancelar" }
    },
    required: ["scheduleId"]
  }
};
