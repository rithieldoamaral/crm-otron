/**
 * Tool: reagendar_evento
 * Cria novo evento no Google Calendar PRIMEIRO, depois remove o antigo
 * e atualiza Schedule. Ordem importa para atomicidade — ver bug #16.
 */

import Schedule from "../../../models/Schedule";
import ServiceProfessional from "../../../models/ServiceProfessional";
import User from "../../../models/User";
import UserCalendar from "../../../models/UserCalendar";
import UserWorkingHours from "../../../models/UserWorkingHours";
import { deleteCalendarEvent, createCalendarEvent, getBusyPeriods } from "../calendarApi";
import { gerarLinkGoogleCalendar } from "./gerarLinkGoogleCalendar";
import { brtWallClockToInstant } from "../timezone";
import { calculateAvailableSlots, slotsToRanges, formatDateWithWeekdayBRT } from "../availabilityEngine";
import { logger } from "../../../utils/logger";

interface ReagendarArgs {
  scheduleId: number;
  novaData: string;
  novaHora: string;
  novoAtendenteId?: number;
}

interface ReagendarResult {
  sucesso: boolean;
  mensagem?: string;
  /**
   * Bug #33: link pré-preenchido do Google Calendar para o cliente adicionar
   * o novo horário ao próprio calendário com um clique — mesmo comportamento
   * de criarEvento. Gerado por gerarLinkGoogleCalendar após reagendamento OK.
   */
  linkCalendario?: string;
  /**
   * Aviso quando a operação concluiu mas com efeito colateral menor
   * (ex.: novo evento criado, mas delete do antigo falhou e ficou órfão
   * na agenda do profissional). Sucesso=true mesmo assim — cliente está
   * atendido. CLAUDE.md II.5 proíbe esconder o estado real, então a tool
   * sinaliza para o LLM repassar a informação ao cliente/operador.
   */
  aviso?: string;
  erro?: string;
}

/**
 * Reagendamento atômico — ordem create-new → delete-old → update-DB.
 *
 * Bug #16 (Round 5): a implementação anterior fazia delete-old PRIMEIRO,
 * depois create-new. Se Google Calendar caísse entre as duas chamadas,
 * o cliente ficava SEM agendamento (antigo deletado, novo nunca criado).
 *
 * A nova ordem garante que:
 *   - Se createCalendarEvent falhar → antigo permanece intacto, retorno
 *     é { sucesso: false, erro }. Cliente continua com seu horário original.
 *   - Se createCalendarEvent OK mas deleteCalendarEvent falhar → cliente
 *     tem o NOVO horário (que é o que ele pediu); evento antigo fica
 *     "órfão" na agenda do profissional. Retorno é { sucesso: true, aviso }.
 *     Aviso é melhor que erro porque a operação principal (mover o cliente
 *     para o novo horário) deu certo.
 *   - Se update do Schedule falhar → propagamos como erro, mas a esta
 *     altura tanto o create quanto o delete já aconteceram. Caso raro;
 *     será logado para diagnóstico manual.
 */
export async function reagendarEvento(
  args: ReagendarArgs,
  companyId: number
): Promise<ReagendarResult> {
  const schedule = await Schedule.findOne({
    where: { id: args.scheduleId, companyId },
    include: ["contact", "service"] as any
  });

  if (!schedule) {
    return { sucesso: false, erro: `Agendamento #${args.scheduleId} não encontrado.` };
  }

  const s = schedule as any;

  // Furo #3 (2026-06-20): guarda de status. Um agendamento CANCELADO não pode
  // ser "remarcado" — reagendar criaria um evento novo e ressuscitaria o
  // registro cancelado, confundindo o cliente. LLMs baratos chamam reagendar
  // sobre o agendamento errado. O fluxo correto é criar_evento novo.
  if (s.status === "CANCELADO") {
    return {
      sucesso: false,
      erro:
        `O agendamento #${args.scheduleId} está CANCELADO e não pode ser remarcado. ` +
        `Para marcar um novo horário, use criar_evento.`
    };
  }

  const atendenteId = args.novoAtendenteId ?? s.professionalId;

  // Furo (2026-06-20, round 13): quando o cliente TROCA de profissional na
  // remarcação (novoAtendenteId), validamos que o novo profissional realmente
  // realiza o serviço do agendamento — mesma blindagem do criar_evento (Furo #4),
  // contra LLM barato alucinar um atendenteId. Só checa quando há troca real e
  // o agendamento tem serviceId (registros legados sem serviceId são pulados).
  if (
    args.novoAtendenteId &&
    args.novoAtendenteId !== s.professionalId &&
    s.serviceId
  ) {
    const vinculo = await ServiceProfessional.findOne({
      where: { serviceId: s.serviceId, userId: args.novoAtendenteId, companyId }
    });
    if (!vinculo) {
      const novoProf = await User.findOne({ where: { id: args.novoAtendenteId, companyId } });
      const nome = (novoProf as any)?.name ?? `#${args.novoAtendenteId}`;
      return {
        sucesso: false,
        erro:
          `${nome} não realiza o serviço "${s.service?.name ?? "deste agendamento"}". ` +
          `Use verificar_disponibilidade para ver quais profissionais atendem esse ` +
          `serviço antes de trocar de profissional.`
      };
    }
  }

  const userCalendar = await UserCalendar.findOne({
    where: { userId: atendenteId, companyId, isActive: true }
  });

  if (!userCalendar) {
    return { sucesso: false, erro: "Profissional sem calendário conectado." };
  }

  const cal = userCalendar as any;
  const durationMin = s.service?.durationMinutes ?? 60;
  // Bug #36 (2026-05-28): novaData+novaHora são horário de PAREDE BRT. Sem o
  // offset explícito -03:00, em produção (servidor UTC) o reagendamento criava
  // o evento 3h adiantado. brtWallClockToInstant fixa o instante correto.
  const novoSendAt = brtWallClockToInstant(args.novaData, args.novaHora);

  // Furo #2 (2026-06-20): guarda determinística de passado — paridade com
  // criar_evento (Bug #13). criar_evento bloqueia agendamento no passado ANTES
  // de tudo; reagendar não tinha essa guarda. A validação de disponibilidade
  // abaixo até filtra slots passados, mas é PULADA no fail-open do Google
  // (getBusyPeriods null) — sem esta guarda, um LLM barato poderia remarcar
  // para um horário já passado quando o Google estivesse instável. Defesa em
  // profundidade, independente do estado do Google.
  if (novoSendAt.getTime() <= Date.now()) {
    return {
      sucesso: false,
      erro:
        `Não é possível remarcar para ${formatDateWithWeekdayBRT(args.novaData)} às ${args.novaHora} ` +
        `— esse horário já passou. Ofereça ao cliente um horário FUTURO.`
    };
  }

  const startISO = novoSendAt.toISOString();
  const endDate = new Date(novoSendAt.getTime());
  endDate.setMinutes(endDate.getMinutes() + durationMin);

  // Bug #41 (2026-05-31): validação DETERMINÍSTICA de disponibilidade do NOVO
  // horário — mesma lacuna que criar_evento tinha antes do Bug #39, registrada
  // como tech debt na entrada de 2026-05-31 do decisions_log.md. Sem isto,
  // reagendar_evento confiava que o LLM havia escolhido um horário válido. Com a
  // Feature UX-1, verificar_disponibilidade não devolve mais a lista de slots ao
  // LLM, então esta checagem é a única garantia determinística contra remarcar
  // para fora do expediente OU sobre um horário já ocupado (double-booking).
  // Roda ANTES do PASSO 1 para falhar rápido, sem nem tocar o Google Calendar.
  const [vy, vm, vd] = args.novaData.split("-").map(Number);
  const dayOfWeek = new Date(vy, vm - 1, vd).getDay(); // weekday TZ-independente (ver Bug #10)

  const workingHours = await UserWorkingHours.findOne({
    where: { userId: atendenteId, companyId, dayOfWeek }
  });
  if (!workingHours || !(workingHours as any).isWorking) {
    return {
      sucesso: false,
      erro:
        `O profissional não atende em ${formatDateWithWeekdayBRT(args.novaData)}. ` +
        `Verifique a disponibilidade em outro dia antes de remarcar.`
    };
  }

  // getBusyPeriods pode falhar por erro transitório do Google. Fail-open:
  // null sinaliza "não consegui checar a agenda" → não bloqueia a remarcação.
  // [] = checou, sem conflitos. Mesmo critério de criarEvento (Bug #39).
  const busy = await getBusyPeriods({
    calendarId: cal.calendarId,
    credentials: cal,
    date: args.novaData
  }).catch(() => null);

  if (busy !== null) {
    const livres = calculateAvailableSlots({
      date: args.novaData,
      durationMinutes: durationMin,
      workingHours: workingHours as any,
      busyPeriods: busy,
      now: new Date()
    });
    if (!livres.includes(args.novaHora)) {
      const range = slotsToRanges(livres, durationMin);
      return {
        sucesso: false,
        erro:
          `O horário ${args.novaHora} não está disponível em ${formatDateWithWeekdayBRT(args.novaData)} ` +
          `(fora do expediente ou já ocupado). ` +
          (range
            ? `Horários livres: ${range}. Ofereça um desses ao cliente.`
            : `Não há horários livres nesse dia — ofereça outro dia.`)
      };
    }
  }

  // PASSO 1: criar novo evento. Se falhar, antigo permanece intacto.
  let novoEvent: { id: string };
  try {
    novoEvent = await createCalendarEvent({
      calendarId: cal.calendarId,
      credentials: cal,
      summary: `${s.service?.name ?? "Serviço"} — ${s.contact?.name ?? "Cliente"}`,
      description: `Reagendado. Cliente: ${s.contact?.name} (${s.contact?.number})`,
      startDateTime: startISO,
      endDateTime: endDate.toISOString()
    });
  } catch (err) {
    logger.error(
      `[reagendar_evento] falha ao criar novo evento (scheduleId=${args.scheduleId} ` +
      `company=${companyId}): ${(err as Error).message} — agendamento original PRESERVADO`
    );
    return { sucesso: false, erro: (err as Error).message };
  }

  // PASSO 2: deletar evento antigo. Se falhar, novo já está OK — apenas avisa.
  let deleteFalhou = false;
  if (s.googleEventId) {
    try {
      await deleteCalendarEvent({
        calendarId: cal.calendarId,
        credentials: cal,
        eventId: s.googleEventId
      });
    } catch (err) {
      deleteFalhou = true;
      logger.warn(
        `[reagendar_evento] falha ao deletar evento antigo (scheduleId=${args.scheduleId} ` +
        `oldEventId=${s.googleEventId} novoEventId=${novoEvent.id} company=${companyId}): ` +
        `${(err as Error).message} — novo evento OK, antigo pode ter ficado órfão`
      );
    }
  }

  // PASSO 3: atualizar Schedule. Erro aqui é raro mas precisa propagar.
  await (schedule as any).update({
    sendAt: novoSendAt,
    professionalId: atendenteId,
    googleEventId: novoEvent.id,
    reminderStatus: "pending"
  });

  // Bug #33: gerar link para o cliente adicionar ao próprio Google Calendar.
  // Mesmo comportamento de criarEvento — sem isso o cliente precisaria abrir
  // o Google Calendar manualmente para encontrar o novo horário.
  const linkCalendario = gerarLinkGoogleCalendar({
    title: `${s.service?.name ?? "Serviço"} — ${s.contact?.name ?? "Cliente"}`,
    data: args.novaData,
    hora: args.novaHora,
    durationMinutes: s.service?.durationMinutes ?? 60,
    details: `Reagendado. Profissional: ${s.professionalId}`
  });

  if (deleteFalhou) {
    return {
      sucesso: true,
      mensagem: `✅ Reagendado para ${formatDateWithWeekdayBRT(args.novaData)} às ${args.novaHora}.`,
      linkCalendario,
      aviso:
        "Novo horário criado com sucesso, mas o evento antigo pode ter permanecido " +
        "na agenda do Google do profissional — verificar manualmente para evitar " +
        "duplicata visual."
    };
  }

  return {
    sucesso: true,
    mensagem: `✅ Reagendado para ${args.novaData} às ${args.novaHora}.`,
    linkCalendario
  };
}

export const reagendarEventoDefinition = {
  name: "reagendar_evento",
  description: "Remarca um agendamento para nova data/hora. Atualiza o Google Calendar automaticamente. Quando sucesso, o resultado inclui 'linkCalendario' — ofereça ao cliente: 'Quer adicionar ao seu Google Calendar? Acesse: [link]'.",
  parameters: {
    type: "object",
    properties: {
      scheduleId: { type: "number", description: "ID do agendamento atual" },
      novaData: { type: "string", description: "Nova data YYYY-MM-DD" },
      novaHora: { type: "string", description: "Novo horário HH:MM" },
      novoAtendenteId: { type: "number", description: "Trocar de profissional (opcional)" }
    },
    required: ["scheduleId", "novaData", "novaHora"]
  }
};
