/**
 * Tool: reagendar_agendamento (admin)
 * Versão administrativa do reagendamento — delega ao reagendarEvento do
 * GoogleCalendarService que já implementa a ordem atômica correta
 * (create-new → delete-old → update-DB, bug #16).
 *
 * Por que não reimplementar: DRY. A lógica de atomicidade e tratamento de
 * falha parcial do Calendar já foi testada e validada em reagendarEvento.
 * Reimplementar criaria dois lugares para manter a mesma lógica crítica.
 *
 * Diferença da versão cliente: o admin pode trocar de profissional
 * via novoAtendenteId e não precisa do fluxo de confirmação em múltiplos
 * turnos — a action é imediata porque o admin tem autoridade para isso.
 */

import { reagendarEvento } from "../../GoogleCalendarService/tools/reagendarEvento";

// Validação estrita ANTES de delegar a reagendarEvento — que faz `new Date(...)` sem
// guard, então alucinação do LLM como "2026-13-32" / "25:99" causaria Invalid Date
// e ISO toString throw. Falhar cedo com erro claro é melhor que stack trace opaco.
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;       // YYYY-MM-DD
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:MM, 00-23 : 00-59

interface ReagendarAgendamentoArgs {
  /** ID do agendamento a remarcar. */
  scheduleId: number;
  /** Nova data no formato YYYY-MM-DD. */
  novaData: string;
  /** Novo horário no formato HH:MM. */
  novaHora: string;
  /** Trocar de profissional responsável (opcional). */
  novoAtendenteId?: number;
}

interface ReagendarAgendamentoResult {
  sucesso: boolean;
  mensagem?: string;
  /** Link do Google Calendar para o cliente adicionar ao próprio calendário. */
  linkCalendario?: string;
  /**
   * Presente quando o reagendamento foi concluído mas a deleção do evento antigo
   * falhou — o novo horário está criado, mas pode haver duplicata visual na agenda
   * do profissional.
   */
  aviso?: string;
  erro?: string;
}

/**
 * Agenda o admin para remarcar um horário existente.
 * Repassa args ao reagendarEvento e devolve o resultado sem transformação
 * para preservar atomicidade e aviso de falha parcial.
 */
export async function reagendarAgendamento(
  args: ReagendarAgendamentoArgs,
  companyId: number
): Promise<ReagendarAgendamentoResult> {
  // Guards determinísticos: LLM pode alucinar formatos (Bug #20 do AgentService —
  // promise text + alucinação de dados). Validar aqui evita propagar lixo para
  // reagendarEvento que só faz `new Date(...)` direto.
  if (!DATE_REGEX.test(args.novaData)) {
    return { sucesso: false, erro: `Data inválida "${args.novaData}". Use formato YYYY-MM-DD.` };
  }
  if (!TIME_REGEX.test(args.novaHora)) {
    return { sucesso: false, erro: `Horário inválido "${args.novaHora}". Use formato HH:MM (00:00 a 23:59).` };
  }
  // Verifica se a data parseia como Date real. V8 silenciosamente faz rollover
  // de calendário ("2026-02-30" → "2026-03-02"), então um isNaN check não basta —
  // precisamos validar que a Date resultante representa exatamente a mesma data
  // que foi passada (round-trip check).
  const parsed = new Date(`${args.novaData}T${args.novaHora}:00`);
  if (isNaN(parsed.getTime())) {
    return { sucesso: false, erro: `Data/hora inválida: ${args.novaData} ${args.novaHora}.` };
  }
  const [yyyy, mm, dd] = args.novaData.split("-").map(Number);
  if (
    parsed.getFullYear() !== yyyy ||
    parsed.getMonth() + 1 !== mm ||  // getMonth é 0-indexed
    parsed.getDate() !== dd
  ) {
    return {
      sucesso: false,
      erro: `Data inválida "${args.novaData}" — esta data não existe no calendário.`
    };
  }

  return reagendarEvento(
    {
      scheduleId: args.scheduleId,
      novaData: args.novaData,
      novaHora: args.novaHora,
      ...(args.novoAtendenteId !== undefined ? { novoAtendenteId: args.novoAtendenteId } : {})
    },
    companyId
  );
}

export const reagendarAgendamentoDefinition = {
  name: "reagendar_agendamento",
  description:
    "Remarca um agendamento para nova data e horário. Atualiza o Google Calendar " +
    "automaticamente (cria novo evento e remove o antigo). " +
    "Use quando o admin precisar mover um horário — ex.: profissional chegou atrasado, " +
    "cliente pediu para mudar, ou redistribuição de agenda. " +
    "Quando sucesso, o resultado inclui 'linkCalendario' que pode ser compartilhado " +
    "com o cliente para ele adicionar ao próprio Google Calendar.",
  parameters: {
    type: "object",
    properties: {
      scheduleId: { type: "number", description: "ID do agendamento a remarcar" },
      novaData: { type: "string", description: "Nova data YYYY-MM-DD" },
      novaHora: { type: "string", description: "Novo horário HH:MM" },
      novoAtendenteId: { type: "number", description: "Trocar de profissional responsável (opcional)" }
    },
    required: ["scheduleId", "novaData", "novaHora"]
  }
};
