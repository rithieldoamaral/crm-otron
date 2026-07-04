/**
 * Tool: buscar_agendamento_cliente
 * Retorna o próximo agendamento ativo do cliente pelo contactId.
 */

import { Op } from "sequelize";
import Schedule from "../../../models/Schedule";
import Service from "../../../models/Service";
import User from "../../../models/User";
import { formatDateWithWeekdayBRT } from "../availabilityEngine";

interface BuscarArgs { contactId: number; }

interface AgendamentoInfo {
  id: number;
  servico: string;
  profissional: string;
  /** Data DD/MM/AAAA em fuso BRT (apresentação). */
  data: string;
  /** Data ISO YYYY-MM-DD em BRT — use ao chamar reagendar_evento/criar_evento. */
  dataISO: string;
  /** Data com dia da semana por extenso ("segunda-feira, 22/06/2026") — linguagem natural. */
  dataFormatada: string;
  /** Horário HH:MM em fuso BRT. */
  hora: string;
  status: string;
  confirmado: boolean;
}

interface BuscarResult {
  encontrado: boolean;
  agendamento?: AgendamentoInfo;
  mensagem?: string;
}

/**
 * Calcula o início do dia atual em fuso BRT, em UTC.
 *
 * Bug #14 (Round 4): o filtro original `sendAt >= now` escondia
 * agendamentos do MESMO DIA cuja hora já tinha passado. Em 27/04 19:48
 * BRT, um agendamento para 27/04 11:00 era invisível para a tool —
 * o LLM então mentia ao cliente ("não havia agendamento"). Filtrando
 * por início-do-dia BRT, agendamentos do dia atual continuam visíveis
 * para cancelamento/remarcação honesta.
 */
function startOfTodayBRT(): Date {
  const now = new Date();
  // Extrai Y/M/D em BRT
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // Meia-noite BRT = 03:00 UTC do mesmo dia
  return new Date(`${map.year}-${map.month}-${map.day}T03:00:00Z`);
}

export async function buscarAgendamentoCliente(
  args: BuscarArgs,
  companyId: number
): Promise<BuscarResult> {
  const schedule = await Schedule.findOne({
    where: {
      contactId: args.contactId,
      companyId,
      // Bug #24 (Round 9): "ENVIADA" removida da exclusão — status significa
      // que o lembrete de confirmação foi enviado, mas o agendamento AINDA
      // ESTÁ ATIVO. Excluí-lo tornava o agente incapaz de encontrar horários
      // já confirmados quando o reminder rodava antes da consulta.
      // Somente "CANCELADO" representa agendamento encerrado de fato.
      status: { [Op.notIn]: ["CANCELADO"] },
      sendAt: { [Op.gte]: startOfTodayBRT() }
    },
    include: [
      { model: Service, as: "service", attributes: ["name"] },
      { model: User, as: "user", attributes: ["name"] }
    ],
    order: [["sendAt", "ASC"]]
  });

  if (!schedule) {
    return { encontrado: false, mensagem: "Nenhum agendamento ativo encontrado." };
  }

  const s = schedule as any;
  const sendAt = new Date(s.sendAt);

  // BUG (2026-06-20): `toLocaleDateString`/`toLocaleTimeString` SEM `timeZone`
  // renderizam no fuso do PROCESSO. Em produção (container Docker em UTC), um
  // agendamento de 14:00 BRT (17:00Z) era mostrado ao cliente como "17:00" —
  // 3h errado. O agente então informava o horário errado. Fix: forçar BRT
  // explicitamente em toda a formatação (mesma classe do Bug #36/#33 no
  // write/read path). Brasil sem DST desde 2019, BRT é -03:00 fixo.
  const TZ = "America/Sao_Paulo";
  const dataISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(sendAt);
  const dataBR = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric"
  }).format(sendAt);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
  }).format(sendAt);

  return {
    encontrado: true,
    agendamento: {
      id: s.id,
      servico: s.service?.name ?? s.body ?? "Serviço",
      profissional: s.user?.name ?? "Profissional",
      data: dataBR,
      dataISO,
      dataFormatada: formatDateWithWeekdayBRT(dataISO),
      hora,
      status: s.status,
      confirmado: s.reminderStatus === "confirmed"
    }
  };
}

export const buscarAgendamentoClienteDefinition = {
  name: "buscar_agendamento_cliente",
  // Bug #25 (Round 9): contactId removido dos parâmetros — o LLM não conhece
  // o ID interno do contato (o system prompt só tem nome, número e ticketId).
  // Quando contactId era "required", Claude se recusava a chamar a tool porque
  // não tinha o valor, respondendo "não encontrei agendamento" sem nem tentar
  // a query. O contactId é injetado pelo AgentService via executeCalendarTool.
  description: "Retorna o próximo agendamento ativo do cliente atual. Use quando o cliente quiser verificar, cancelar ou remarcar um horário. O resultado traz `dataFormatada` (ex: 'segunda-feira, 22/06/2026') e `hora` já no fuso correto (BRT) — use-os ao falar com o cliente. Para remarcar, passe o `id` do agendamento como scheduleId ao reagendar_evento.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};
