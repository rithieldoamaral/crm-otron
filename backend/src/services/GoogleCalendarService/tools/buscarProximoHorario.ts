/**
 * Tool: buscar_proximo_horario
 * Encontra o próximo slot livre para um serviço (nos próximos 7 dias).
 */

import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import UserCalendar from "../../../models/UserCalendar";
import UserWorkingHours from "../../../models/UserWorkingHours";
import User from "../../../models/User";
import { getBusyPeriods, executeWithCalendarErrorHandling } from "../calendarApi";
import { calculateAvailableSlots, filterSlotsByPeriod, normalizePeriod, formatDateWithWeekdayBRT } from "../availabilityEngine";
import { logger } from "../../../utils/logger";

interface BuscarProximoArgs {
  servicoId: number;
  atendenteId?: number;
  /** Período do dia desejado ("manha"/"tarde"/"noite"). Opcional. */
  periodo?: string;
}

interface ProximoHorarioResult {
  encontrado: boolean;
  data?: string;
  /**
   * Data com dia da semana por extenso ("segunda-feira, 22/06/2026"), calculada
   * deterministicamente no backend. O LLM usa ESTA string ao mencionar a data —
   * nunca calcula o dia da semana de cabeça. Problema do dia da semana, 2026-06-20.
   */
  dataFormatada?: string;
  hora?: string;
  profissional?: string;
  profissionalId?: number;
  /** Nome do serviço — usado por extractLastDiscussedService (Bug #33) */
  servico?: string;
  mensagem?: string;
}

export async function buscarProximoHorario(
  args: BuscarProximoArgs,
  companyId: number
): Promise<ProximoHorarioResult> {
  const servico = await Service.findOne({ where: { id: args.servicoId, companyId, isActive: true } });
  if (!servico) return { encontrado: false, mensagem: "Serviço não encontrado." };

  const profFilter = args.atendenteId
    ? { serviceId: args.servicoId, companyId, userId: args.atendenteId }
    : { serviceId: args.servicoId, companyId };

  // include User → expõe `nome` no retorno. Sem isso o LLM recebe `profissional: undefined`
  // e alucina placeholders textuais como "[Nome do profissional]" na resposta.
  const professionals = await ServiceProfessional.findAll({
    where: profFilter,
    include: [{ model: User, as: "user", attributes: ["id", "name"] }]
  });

  // Bug #34 (2026-05-24): rastreia CAUSA da ausência de horários para devolver
  // mensagem informativa ao LLM. Antes, a tool sempre retornava a mesma mensagem
  // "Nenhum horário disponível" independente do motivo — o LLM não conseguia
  // distinguir "agenda cheia" de "configuração pendente".
  let calendarFoundCount = 0;   // profissionais com calendário ativo
  let workingHoursFoundAny = false; // ao menos 1 dia de trabalho configurado

  // Verifica os próximos 7 dias.
  // Usa BRT consistente para dateStr e dayOfWeek — ao usar `toISOString()`
  // à noite BRT (ex: 22h BRT = 01h UTC dia seguinte) o dateStr saía no dia
  // errado em UTC, desalinhando do dayOfWeek (que é local).
  for (let d = 0; d < 7; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
    // Reparseia dateStr no fuso local para obter dayOfWeek correto e estável
    const [y, m, dd] = dateStr.split("-").map(Number);
    const dayOfWeek = new Date(y, m - 1, dd).getDay();

    for (const sp of professionals as any[]) {
      const userCalendar = await UserCalendar.findOne({
        where: { userId: sp.userId, companyId, isActive: true }
      });
      if (!userCalendar) {
        // Log diagnóstico: profissional sem Google Calendar ativo.
        // Causa mais comum de "nenhum horário disponível" em agenda vazia (Bug #33).
        if (d === 0) { // loga apenas na primeira iteração para não repetir 7x
          logger.warn(
            `[buscarProximoHorario] userId=${sp.userId} sem UserCalendar ativo — ` +
            `serviço #${args.servicoId} pulado. Verifique se o calendário está conectado ` +
            `em Configurações → Calendário.`
          );
        }
        continue;
      }
      calendarFoundCount++;

      const workingHours = await UserWorkingHours.findOne({
        where: { userId: sp.userId, companyId, dayOfWeek }
      });
      if (!workingHours || !(workingHours as any).isWorking) continue;
      workingHoursFoundAny = true;

      // Fail-open preservado (.catch => []); o wrapper invalida a conexão na UI
      // se o token estiver morto (invalid_grant / sem scope).
      const busy = await executeWithCalendarErrorHandling(
        () => getBusyPeriods({
          calendarId: (userCalendar as any).calendarId,
          credentials: userCalendar as any,
          date: dateStr
        }),
        (userCalendar as any).id,
        "buscarProximoHorario"
      ).catch(() => []);

      const allSlots = calculateAvailableSlots({
        date: dateStr,
        durationMinutes: (servico as any).durationMinutes,
        workingHours: workingHours as any,
        busyPeriods: busy,
        now: new Date() // bug #12: filtra slots no passado quando d=0 (hoje)
      });

      // Bug #35 (2026-05-28): filtro de período DETERMINÍSTICO também aqui. Se o
      // cliente pediu "de tarde", filtramos por período ANTES de escolher slots[0].
      // Crucial: quando o período esvazia os slots de um dia, o loop continua para
      // o próximo dia em vez de retornar — o período se aplica a TODOS os 7 dias.
      const slots = filterSlotsByPeriod(allSlots, args.periodo);

      if (slots.length > 0) {
        const nome = sp.user?.name ?? "";
        return {
          encontrado: true,
          data: dateStr,
          dataFormatada: formatDateWithWeekdayBRT(dateStr),
          hora: slots[0],
          profissional: nome,
          profissionalId: sp.userId,
          // Bug #33: campo `servico` necessário para extractLastDiscussedService
          // injetar o serviço correto no system prompt no próximo turno.
          servico: (servico as any).name,
          mensagem: `Próximo horário disponível: ${formatDateWithWeekdayBRT(dateStr)} às ${slots[0]} com ${nome}.`
        };
      }
    }
  }

  // Retorna mensagem específica por causa — ajuda o LLM a dar resposta correta ao cliente.
  if (professionals.length === 0) {
    logger.error(`[buscarProximoHorario] Serviço #${args.servicoId} sem profissionais vinculados no companyId=${companyId}`);
    return { encontrado: false, mensagem: "Serviço sem profissionais vinculados. Acesse Catálogo de Serviços para associar um profissional." };
  }
  if (calendarFoundCount === 0) {
    return { encontrado: false, mensagem: "Nenhum profissional deste serviço tem Google Calendar conectado. Acesse Configurações → Calendário para conectar." };
  }
  if (!workingHoursFoundAny) {
    logger.warn(`[buscarProximoHorario] Serviço #${args.servicoId}: calendário conectado mas horários de trabalho não configurados no companyId=${companyId}`);
    return { encontrado: false, mensagem: "Horários de trabalho não configurados. Acesse Configurações → Calendário → Horário de Trabalho e salve os horários do profissional." };
  }
  const periodoNorm = normalizePeriod(args.periodo);
  if (periodoNorm) {
    const label = periodoNorm === "manha" ? "de manhã" : periodoNorm === "tarde" ? "à tarde" : "à noite";
    return { encontrado: false, mensagem: `Nenhum horário disponível ${label} nos próximos 7 dias. Há vagas em outros períodos do dia?` };
  }
  return { encontrado: false, mensagem: "Nenhum horário disponível nos próximos 7 dias." };
}

export const buscarProximoHorarioDefinition = {
  name: "buscar_proximo_horario",
  // Bug #28 (Round 10): descrição anterior muito restrita ("Use quando o cliente
  // perguntar 'qual o próximo horário livre?'") fazia o LLM escolher
  // verificar_disponibilidade com data de amanhã quando o cliente apenas
  // escolhia um serviço sem pedir data explícita — deixando agenda de hoje ociosa.
  // Nova descrição: torna claro que esta é a tool padrão quando NÃO há data
  // específica, e que sempre começa por HOJE.
  description: "Encontra o próximo horário disponível para um serviço, começando SEMPRE por HOJE e seguindo pelos próximos 7 dias. Use esta tool como PADRÃO quando o cliente quiser agendar sem especificar data concreta. NÃO use verificar_disponibilidade com data futura antes de confirmar com esta tool. Se o cliente mencionar um período do dia ('de manhã', 'à tarde', 'de noite'), passe o argumento `periodo` para que a busca já considere SOMENTE aquele período — não filtre você mesmo.",
  parameters: {
    type: "object",
    properties: {
      servicoId: { type: "number", description: "ID do serviço" },
      atendenteId: { type: "number", description: "ID do profissional preferido (opcional)" },
      periodo: { type: "string", description: "Período do dia desejado: 'manha' (antes de 12h), 'tarde' (12h–18h) ou 'noite' (a partir de 18h). Opcional — informe APENAS se o cliente especificar." }
    },
    required: ["servicoId"]
  }
};
