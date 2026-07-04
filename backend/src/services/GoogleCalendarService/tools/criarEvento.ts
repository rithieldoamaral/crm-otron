/**
 * Tool: criar_evento
 * Cria evento no Google Calendar do profissional e registra no Schedule.
 * Google Calendar primeiro — se falhar, não cria Schedule (evita inconsistência).
 */

import { Op } from "sequelize";
import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import User from "../../../models/User";
import Contact from "../../../models/Contact";
import UserCalendar from "../../../models/UserCalendar";
import UserWorkingHours from "../../../models/UserWorkingHours";
import Schedule from "../../../models/Schedule";
import { createCalendarEvent, getBusyPeriods } from "../calendarApi";
import { gerarLinkGoogleCalendar } from "./gerarLinkGoogleCalendar";
import { brtWallClockToInstant } from "../timezone";
import { calculateAvailableSlots, slotsToRanges, formatDateWithWeekdayBRT } from "../availabilityEngine";
import { logger } from "../../../utils/logger";

/**
 * Bug #18 (Round 7): traduz erros crus do Google OAuth/Calendar em mensagens
 * que o LLM consegue usar para informar o cliente E que sinalizam ao operador
 * o que reparar. O erro `invalid_grant` é o mais comum: refresh_token revogado
 * ou expirado por inatividade. Repassar a string crua mete o LLM em loop.
 *
 * Bug #21 (Round 7+): "insufficient authentication scopes" — token aceito
 * sem scope `auth/calendar`. Usuário desmarcou a checkbox na tela de consent
 * sem perceber. Token está VIVO mas sem permissão. UI continuava mostrando
 * "Conectado" verde. Fix: aqui detectamos o erro de scope em runtime e o
 * caller (criarEvento) marca isActive=false — UI volta a mostrar "Desconectado"
 * automaticamente, forçando o usuário a reconectar.
 *
 * Não tratamos aqui erros de quota / rede transitórios — esses caem no
 * fallback genérico do try/catch original (mensagem do err.message).
 */
export interface ErroGoogleTraduzido {
  /** Mensagem amigável para o LLM repassar ao cliente. */
  mensagem: string;
  /**
   * Quando true, o caller deve marcar UserCalendar.isActive=false porque
   * o token está em estado inválido permanente (não vai reativar sozinho).
   */
  invalidarConexao: boolean;
}

export function traduzirErroGoogleCalendar(
  err: any,
  profissionalNome: string
): ErroGoogleTraduzido | null {
  const raw: string = (err?.message ?? "").toString().toLowerCase();

  if (raw.includes("invalid_grant")) {
    return {
      invalidarConexao: true,
      mensagem:
        `Conexão com o Google Calendar de ${profissionalNome} expirou ou foi revogada. ` +
        `Não foi possível agendar agora. Avise ao cliente que houve um problema técnico ` +
        `com o calendário e que a clínica entrará em contato — e use a tool ` +
        `notificar_proprietario para sinalizar que o calendário precisa ser reconectado ` +
        `nas Configurações.`
    };
  }
  if (raw.includes("insufficient authentication scopes")) {
    return {
      invalidarConexao: true,
      mensagem:
        `O Google Calendar de ${profissionalNome} foi conectado SEM permissão de calendário ` +
        `(usuário pode ter desmarcado a opção na tela do Google). Não é possível agendar. ` +
        `Avise ao cliente que houve problema técnico e use notificar_proprietario para ` +
        `sinalizar que a clínica precisa reconectar o calendário marcando todas as permissões.`
    };
  }
  if (raw.includes("invalid_client") || raw.includes("unauthorized_client")) {
    return {
      invalidarConexao: false,
      mensagem:
        `Erro de autenticação OAuth com o Google Calendar (${err.message}). ` +
        `Avise ao cliente que houve problema técnico e use notificar_proprietario.`
    };
  }
  return null;
}

/**
 * Calcula o início do dia atual em fuso BRT, em UTC.
 * Compartilha lógica com buscarAgendamentoCliente.startOfTodayBRT — mantida
 * inline aqui para preservar isolamento de tools (CLAUDE.md III.4) e evitar
 * acoplamento entre arquivos por uma helper de 5 linhas.
 */
function startOfTodayBRT(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return new Date(`${map.year}-${map.month}-${map.day}T03:00:00Z`);
}

interface CriarEventoArgs {
  servicoId: number;
  atendenteId: number;
  data: string;
  hora: string;
  contactId: number;
}

interface CriarEventoResult {
  sucesso: boolean;
  agendamentoId?: number;
  mensagem?: string;
  erro?: string;
  /** URL do Google Calendar pré-preenchida — ofereça ao cliente após agendamento. */
  linkCalendario?: string;
}

export async function criarEvento(
  args: CriarEventoArgs,
  companyId: number
): Promise<CriarEventoResult> {
  const { servicoId, atendenteId, data, hora, contactId } = args;

  const [servico, profissional, contato] = await Promise.all([
    Service.findOne({ where: { id: servicoId, companyId } }),
    User.findOne({ where: { id: atendenteId, companyId } }),
    Contact.findOne({ where: { id: contactId, companyId } })
  ]);

  if (!servico) return { sucesso: false, erro: `Serviço #${servicoId} não encontrado.` };
  if (!profissional) return { sucesso: false, erro: `Profissional #${atendenteId} não encontrado.` };
  if (!contato) return { sucesso: false, erro: `Contato #${contactId} não encontrado.` };

  // Furo #4 (2026-06-20): valida que o profissional REALMENTE realiza o serviço.
  // As tools de disponibilidade só devolvem profissionais vinculados ao serviço,
  // mas um LLM barato pode alucinar um atendenteId (classe do Bug #8, onde o
  // gpt-oss-120b passou atendenteId=1 errado). Sem esta checagem, o agendamento
  // seria criado com um profissional que não faz o procedimento — usando o
  // expediente DELE para validar disponibilidade, gerando agenda incoerente.
  const vinculo = await ServiceProfessional.findOne({
    where: { serviceId: servicoId, userId: atendenteId, companyId }
  });
  if (!vinculo) {
    return {
      sucesso: false,
      erro:
        `${(profissional as any).name} não realiza o serviço "${(servico as any).name}". ` +
        `Use verificar_disponibilidade ou buscar_proximo_horario para ver quais ` +
        `profissionais atendem esse serviço e escolha um deles.`
    };
  }

  const userCalendar = await UserCalendar.findOne({
    where: { userId: atendenteId, companyId, isActive: true }
  });
  if (!userCalendar) {
    return { sucesso: false, erro: `Profissional ${(profissional as any).name} sem calendário conectado.` };
  }

  // Bug #13 (Round 4): defesa determinística contra agendamento no passado.
  // O agente pode receber mensagens 24/7 — não é restrição do MOMENTO em
  // que a tool é chamada, e sim do INSTANTE do agendamento. Em 27/04 19:47
  // BRT o LLM (sem conceito de "agora") aceitou marcar 27/04 11:00 (8h
  // atrás). Sem essa guarda, depender só do prompt deixaria o sintoma
  // possível em qualquer modelo barato que perde o contexto temporal.
  //
  // Bug #36 (2026-05-28): `data`+`hora` são horário de PAREDE BRT. Antes usávamos
  // `new Date(`${data}T${hora}:00`)` (sem offset), interpretado no fuso do
  // processo — em produção (UTC) o instante saía 3h adiantado, podendo rejeitar
  // horários futuros válidos. brtWallClockToInstant fixa o offset -03:00.
  const sendAt = brtWallClockToInstant(data, hora);
  if (sendAt.getTime() <= Date.now()) {
    return {
      sucesso: false,
      erro: `Não é possível agendar para ${formatDateWithWeekdayBRT(data)} às ${hora} — esse instante já passou. Ofereça ao cliente um horário FUTURO.`
    };
  }

  // Bug #8 + #15 (Round 5): defesa unificada contra agendamentos inconsistentes.
  //
  // Bug #8: LLM chamava criar_evento DUAS vezes no mesmo turn (mesmo slot exato)
  //   → check de duplicata exata.
  // Bug #15: LLM tentava criar agendamento NOVO em horário diferente sem
  //   cancelar/remarcar o existente, deixando cliente com 2 agendamentos no
  //   mesmo dia → check ampliado para QUALQUER PENDENTE futuro.
  //
  // Estratégia: uma única query busca o próximo Schedule PENDENTE do cliente
  // (sendAt >= início-do-dia-BRT). Se existir, classificamos:
  //   (a) mesmo slot exato → erro de duplicata literal (bug #8)
  //   (b) slot diferente   → erro orientando ao próximo passo (bug #15)
  //
  // O texto do erro é DIRECIONADO AO LLM (ele lê o JSON do tool result) e
  // contém o nome literal das tools alternativas — `reagendar_evento` para
  // mover, `cancelar_evento` para cancelar e depois criar. Sem essa
  // orientação, modelos baratos ficam em loop tentando criar de novo.
  // Bug #24 (Round 9): o check de duplicata verificava apenas "PENDENTE".
  // Um agendamento "ENVIADA" (lembrete já disparado) era invisível aqui,
  // permitindo criação de duplicata silenciosa. Ambos os status representam
  // agendamentos ativos que devem bloquear nova criação.
  const existing = await Schedule.findOne({
    where: {
      companyId,
      contactId,
      status: { [Op.in]: ["PENDENTE", "ENVIADA"] },
      sendAt: { [Op.gte]: startOfTodayBRT() }
    },
    include: [{ model: Service, as: "service", attributes: ["name"] }],
    order: [["sendAt", "ASC"]]
  });
  if (existing) {
    const e = existing as any;
    const existingMs = e.sendAt ? new Date(e.sendAt).getTime() : NaN;
    const sameSlot =
      existingMs === sendAt.getTime() && e.professionalId === atendenteId;

    if (sameSlot) {
      return {
        sucesso: false,
        erro:
          `Já existe agendamento #${e.id} pendente para este cliente em ${formatDateWithWeekdayBRT(data)} às ${hora} ` +
          `com este profissional. Não criei duplicata — confirme com o cliente antes de remarcar.`
      };
    }

    // Slot diferente — cliente já tem agendamento ativo em outro horário.
    // Formatamos data/hora existentes em BRT para o erro ser legível pelo LLM.
    const fmtDate = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric"
    });
    const fmtTime = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false
    });
    const dataExistente = fmtDate.format(new Date(existingMs));
    const horaExistente = fmtTime.format(new Date(existingMs));
    const servicoExistente = e.service?.name ?? "agendamento";

    return {
      sucesso: false,
      erro:
        `Cliente já tem agendamento #${e.id} pendente (${servicoExistente} em ${dataExistente} ` +
        `às ${horaExistente}). Para mudar para ${data} às ${hora}, use ` +
        `reagendar_evento(scheduleId=${e.id}, novaData="${data}", novaHora="${hora}") em vez ` +
        `de criar novo. Ou cancele primeiro com cancelar_evento(scheduleId=${e.id}) se o cliente ` +
        `quiser desistir antes de remarcar.`
    };
  }

  // Bug #39 (2026-05-31): validação DETERMINÍSTICA de disponibilidade.
  // Antes, criar_evento confiava que o LLM havia escolhido um horário válido
  // (presente na lista de slots de verificar_disponibilidade). Com a Feature
  // UX-1, a tool de disponibilidade passou a devolver apenas a FAIXA ("das
  // 12:00 às 18:00"), não a lista de slots — então o LLM não tem mais a lista
  // exata para validar a escolha do cliente. Esta checagem fecha a lacuna:
  // recalcula os horários livres do profissional no dia e recusa o agendamento
  // se `hora` não for um slot válido (fora do expediente OU sobre um horário já
  // ocupado). É a única garantia determinística contra double-booking e
  // horários fora da grade — independente do que o LLM enviar.
  const durationMinutes = (servico as any).durationMinutes;
  const [vy, vm, vd] = data.split("-").map(Number);
  const dayOfWeek = new Date(vy, vm - 1, vd).getDay(); // weekday TZ-independente (ver Bug #10)

  const workingHours = await UserWorkingHours.findOne({
    where: { userId: atendenteId, companyId, dayOfWeek }
  });
  if (!workingHours || !(workingHours as any).isWorking) {
    return {
      sucesso: false,
      erro:
        `${(profissional as any).name} não atende em ${formatDateWithWeekdayBRT(data)}. ` +
        `Verifique a disponibilidade em outro dia antes de agendar.`
    };
  }

  // getBusyPeriods pode falhar por erro transitório do Google. Fail-open:
  // null sinaliza "não consegui checar a agenda" → não bloqueia o agendamento
  // (o check anti-duplicata acima já evita o pior caso). [] = checou, sem conflitos.
  const busy = await getBusyPeriods({
    calendarId: (userCalendar as any).calendarId,
    credentials: userCalendar as any,
    date: data
  }).catch(() => null);

  if (busy !== null) {
    const livres = calculateAvailableSlots({
      date: data,
      durationMinutes,
      workingHours: workingHours as any,
      busyPeriods: busy,
      now: new Date()
    });
    if (!livres.includes(hora)) {
      const range = slotsToRanges(livres, durationMinutes);
      return {
        sucesso: false,
        erro:
          `O horário ${hora} não está disponível para ${(profissional as any).name} em ${formatDateWithWeekdayBRT(data)} ` +
          `(fora do expediente ou já ocupado). ` +
          (range
            ? `Horários livres: ${range}. Ofereça um desses ao cliente.`
            : `Não há horários livres nesse dia — ofereça outro dia.`)
      };
    }
  }

  // Reusa `sendAt` (já no instante BRT correto — Bug #36) em vez de reconstruir.
  const startISO = sendAt.toISOString();
  const endDate = new Date(sendAt.getTime());
  endDate.setMinutes(endDate.getMinutes() + (servico as any).durationMinutes);
  const endISO = endDate.toISOString();

  let googleEventId: string;
  try {
    const event = await createCalendarEvent({
      calendarId: (userCalendar as any).calendarId,
      credentials: userCalendar as any,
      summary: `${(servico as any).name} — ${(contato as any).name}`,
      description: `Cliente: ${(contato as any).name} (${(contato as any).number})`,
      startDateTime: startISO,
      endDateTime: endISO
    });
    googleEventId = event.id;
  } catch (err: any) {
    // Erros recorrentes do Google viram mensagens orientativas para o LLM.
    // Logamos sempre o erro original para diagnóstico no servidor.
    logger.error(
      `[criar_evento] falha do Google Calendar | atendenteId=${atendenteId} ` +
      `userCalendarId=${(userCalendar as any).id} err=${err?.message}`
    );
    const traduzido = traduzirErroGoogleCalendar(err, (profissional as any).name);

    // Quando o token entrou em estado inválido permanente (revogado / sem
    // scopes), marcamos isActive=false. O frontend lê esse campo no
    // /google-calendar/status e mostra "Desconectado" — chamando o usuário à
    // ação de reconectar. Sem isso, a UI ficava mentindo "Conectado" verde
    // enquanto cada chamada à API falhava em silêncio.
    if (traduzido?.invalidarConexao) {
      try {
        await UserCalendar.update(
          { isActive: false } as any,
          { where: { id: (userCalendar as any).id } }
        );
        logger.warn(
          `[criar_evento] UserCalendar #${(userCalendar as any).id} marcado isActive=false ` +
          `devido a token inválido (${err.message?.slice(0, 80)})`
        );
      } catch (updateErr: any) {
        logger.error(
          `[criar_evento] falha ao marcar isActive=false | userCalendar=${(userCalendar as any).id}: ${updateErr.message}`
        );
      }
    }

    return { sucesso: false, erro: traduzido?.mensagem ?? err.message };
  }

  const schedule = await Schedule.create({
    body: (servico as any).name,
    sendAt, // Bug #36: instante BRT correto, já validado acima
    contactId,
    userId: atendenteId,
    companyId,
    serviceId: servicoId,
    professionalId: atendenteId,
    googleEventId,
    status: "PENDENTE",
    reminderStatus: "pending"
  } as any);

  const s = servico as any;
  const p = profissional as any;
  const c = contato as any;

  const linkCalendario = gerarLinkGoogleCalendar({
    title: `${s.name} — ${c.name}`,
    data,
    hora,
    durationMinutes: s.durationMinutes,
    details: `Profissional: ${p.name}`
  });

  return {
    sucesso: true,
    agendamentoId: (schedule as any).id,
    mensagem: `✅ Agendado! ${s.name} com ${p.name} em ${formatDateWithWeekdayBRT(data)} às ${hora} (${s.durationMinutes}min).`,
    linkCalendario
  };
}

export const criarEventoDefinition = {
  name: "criar_evento",
  description: "Cria agendamento no Google Calendar do profissional e registra no sistema. Use após o cliente confirmar serviço, profissional e horário. Quando sucesso, o resultado inclui 'linkCalendario' — ofereça ao cliente: 'Quer adicionar ao seu Google Calendar? Acesse: [link]'.",
  parameters: {
    type: "object",
    properties: {
      servicoId: { type: "number", description: "ID do serviço" },
      atendenteId: { type: "number", description: "ID do profissional" },
      data: { type: "string", description: "Data no formato YYYY-MM-DD" },
      hora: { type: "string", description: "Horário no formato HH:MM" },
      contactId: { type: "number", description: "ID do contato (cliente)" }
    },
    required: ["servicoId", "atendenteId", "data", "hora", "contactId"]
  }
};
