/**
 * Tool: verificar_disponibilidade
 * Retorna slots livres por profissional para um serviço e data específicos.
 */

import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import UserCalendar from "../../../models/UserCalendar";
import UserWorkingHours from "../../../models/UserWorkingHours";
import User from "../../../models/User";
import { getBusyPeriods } from "../calendarApi";
import { calculateAvailableSlots, filterSlotsByPeriod, normalizePeriod, slotsToRanges, formatDateWithWeekdayBRT } from "../availabilityEngine";
import { logger } from "../../../utils/logger";

interface VerificarArgs { servicoId: number; data: string; periodo?: string; hora?: string; }

interface ProfissionalSlots {
  id: number;
  nome: string;
  /**
   * Quantidade de horários livres no período consultado. Permite ao LLM saber
   * se há (>0) ou não (0) disponibilidade, sem receber a lista individual.
   */
  horariosDisponiveis: number;
  /**
   * Disponibilidade formatada como faixas de horário para apresentação ao
   * cliente (Feature UX-1 / Bug #39, 2026-05-31). Ex: "das 13:00 às 18:00" ou
   * "das 09:00 às 12:00 e das 14:00 às 18:00". String vazia quando sem horários.
   *
   * IMPORTANTE: a lista de slots individuais NÃO é mais devolvida ao LLM de
   * propósito — gpt-4o-mini despejava todos os horários um a um, ignorando a
   * instrução de usar a faixa. Sem o array, a apresentação como faixa é
   * determinística. A validação do horário escolhido pelo cliente é feita
   * deterministicamente em `criar_evento` (não depende do LLM conhecer os slots).
   */
  rangeFormatado: string;
  /**
   * Bug #B1 (2026-06-20): resposta DETERMINÍSTICA para "esse horário está livre?".
   * Presente SOMENTE quando o cliente consultou um horário específico (arg `hora`).
   * true = o profissional tem aquele horário livre; false = não.
   *
   * Sem este campo, depois do Bug #39 (que removeu a lista de slots), o LLM não
   * tinha como saber se "11:00" estava na faixa "das 12:00 às 18:00" — e soltava
   * "não consegui verificar". Agora a resposta é calculada no backend.
   */
  horaDisponivel?: boolean;
}

interface VerificarResult {
  disponivel: boolean;
  data?: string;
  /**
   * Data já formatada com o dia da semana por extenso ("segunda-feira,
   * 22/06/2026"). O LLM deve usar ESTA string ao mencionar a data ao cliente —
   * o dia da semana é calculado deterministicamente no backend (o modelo nunca
   * o calcula). Problema do dia da semana, 2026-06-20.
   */
  dataFormatada?: string;
  servico?: string;
  durationMinutes?: number;
  profissionais?: ProfissionalSlots[];
  /** Período aplicado ("manha"/"tarde"/"noite") quando o cliente o solicitou. */
  periodo?: string;
  /** Horário específico consultado pelo cliente ("HH:MM"), quando informado (Bug #B1). */
  horaConsultada?: string;
  /**
   * Bug #B1: true quando ALGUM profissional tem o `hora` consultado livre.
   * Permite ao LLM responder "sim, às 11h a Amanda está livre" ou "às 11h não
   * tem, mas tenho [faixa]" — deterministicamente, sem adivinhar.
   */
  horaConsultadaDisponivel?: boolean;
  erro?: string;
}

/**
 * Parse "YYYY-MM-DD" como data de calendário no fuso local.
 *
 * Bug #10: `new Date("2026-04-27")` é interpretado como UTC midnight. Em
 * fusos a oeste de UTC (ex: BRT, UTC-3) isso vira 21h do dia ANTERIOR no
 * relógio local — então `getDay()` devolve o weekday errado (domingo em
 * vez de segunda). Resultado: a tool consultava o expediente do dia errado
 * e retornava `slots: []` mesmo quando o profissional tinha agenda livre.
 *
 * `new Date(year, month-1, day)` cria meia-noite local da data informada,
 * o que torna `getDay()` TZ-independente para weekday.
 */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Normaliza o horário consultado pelo cliente para "HH:MM" (Bug #B1).
 * O orquestrador normalmente injeta já no formato "HH:MM" (extractTimeFromMessage),
 * mas o LLM pode passar "11", "11h" ou "9:00" diretamente — saneamos aqui para
 * casar com o formato dos slots ("HH:MM" zero-padded). Retorna null se inválido.
 */
function normalizeHora(raw?: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{1,2})\s*(?::|h)?\s*(\d{2})?/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] !== undefined ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export async function verificarDisponibilidade(
  args: VerificarArgs,
  companyId: number
): Promise<VerificarResult> {
  // CAUSA-RAIZ do "não consegui verificar" (2026-06-21): modelos baratos
  // frequentemente chamam esta tool SEM `data` (quando a data está "no contexto",
  // ex: cliente pergunta só "tem às 11h?") ou com `data` malformada (ex: "sexta").
  // `parseLocalDate(undefined).split` LANÇAVA exceção → o orquestrador devolvia
  // {erro:"Falha ao executar..."} → o LLM respondia "não consegui verificar".
  // (buscar_proximo_horario funcionava porque NÃO recebe `data`.)
  // Guarda defensiva: nunca quebra; devolve erro instrutivo e estruturado.
  // A injeção determinística da data acontece no orquestrador (AgentService),
  // espelhando a injeção de `periodo` (Bug #37) e `hora` (Bug #B1).
  if (typeof args.data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(args.data)) {
    logger.warn(
      `[verificarDisponibilidade] chamada sem data válida (data=${JSON.stringify(args.data)} ` +
      `servicoId=${args.servicoId} company=${companyId}) — devolvendo erro instrutivo`
    );
    return {
      disponivel: false,
      erro:
        "Data não informada ou em formato inválido (esperado YYYY-MM-DD). " +
        "Para o próximo horário livre use buscar_proximo_horario; para um dia específico, " +
        "informe a data ao chamar verificar_disponibilidade."
    };
  }

  const servico = await Service.findOne({ where: { id: args.servicoId, companyId, isActive: true } });
  if (!servico) return { disponivel: false, erro: `Serviço #${args.servicoId} não encontrado.` };

  const date = parseLocalDate(args.data);
  const dayOfWeek = date.getDay();
  const horaConsultada = normalizeHora(args.hora);

  const professionals = await ServiceProfessional.findAll({
    where: { serviceId: args.servicoId, companyId },
    include: [{ model: User, as: "user", attributes: ["id", "name"] }]
  });

  const results: ProfissionalSlots[] = [];

  for (const sp of professionals as any[]) {
    const userCalendar = await UserCalendar.findOne({
      where: { userId: sp.userId, companyId, isActive: true }
    });
    if (!userCalendar) continue;

    const workingHours = await UserWorkingHours.findOne({
      where: { userId: sp.userId, companyId, dayOfWeek }
    });

    if (!workingHours || !(workingHours as any).isWorking) {
      results.push({ id: sp.userId, nome: sp.user?.name ?? "", horariosDisponiveis: 0, rangeFormatado: "" });
      continue;
    }

    const busy = await getBusyPeriods({
      calendarId: (userCalendar as any).calendarId,
      credentials: userCalendar as any,
      date: args.data
    }).catch(() => []);

    const allSlots = calculateAvailableSlots({
      date: args.data,
      durationMinutes: (servico as any).durationMinutes,
      workingHours: workingHours as any,
      busyPeriods: busy,
      now: new Date() // bug #12: filtra slots no passado (apenas para hoje)
    });

    // Bug #35 (2026-05-28): filtro de período DETERMINÍSTICO. Antes, a tool
    // devolvia o dia inteiro e o LLM filtrava "tarde" — gpt-4o-mini falhava e
    // respondia "não consegui verificar a disponibilidade". Agora o filtro é
    // feito aqui; o LLM só repassa o termo do cliente em `periodo`.
    const slots = filterSlotsByPeriod(allSlots, args.periodo);
    // Feature UX-1 / Bug #39: devolve a disponibilidade como faixa ("das 13:00
    // às 18:00") + contagem, NUNCA a lista de slots individuais. Isso impede
    // deterministicamente que o LLM despeje todos os horários um a um.
    const rangeFormatado = slotsToRanges(slots, (servico as any).durationMinutes);

    const prof: ProfissionalSlots = {
      id: sp.userId,
      nome: sp.user?.name ?? "",
      horariosDisponiveis: slots.length,
      rangeFormatado
    };
    // Bug #B1 (2026-06-20): checagem determinística de horário específico.
    // Usa `allSlots` (dia inteiro, já sem passado) e NÃO `slots` (filtrado por
    // período) — "esse horário está livre?" independe de período eventualmente
    // mencionado. Só inclui o campo quando o cliente consultou um horário.
    if (horaConsultada) {
      prof.horaDisponivel = allSlots.includes(horaConsultada);
    }
    results.push(prof);
  }

  const anyAvailable = results.some(p => p.horariosDisponiveis > 0);
  const periodoNorm = normalizePeriod(args.periodo);

  return {
    disponivel: anyAvailable,
    data: args.data,
    dataFormatada: formatDateWithWeekdayBRT(args.data),
    servico: (servico as any).name,
    durationMinutes: (servico as any).durationMinutes,
    profissionais: results,
    ...(periodoNorm ? { periodo: periodoNorm } : {}),
    ...(horaConsultada
      ? {
          horaConsultada,
          horaConsultadaDisponivel: results.some(p => p.horaDisponivel === true)
        }
      : {})
  };
}

export const verificarDisponibilidadeDefinition = {
  name: "verificar_disponibilidade",
  // Bug #28 (Round 10): sem restrição na descrição o LLM chamava esta tool
  // com data de amanhã (ou outro dia futuro) antes de verificar hoje —
  // desperdiçando vagas do dia. Agora a descrição deixa claro que ela é
  // para datas ESPECÍFICAS pedidas pelo cliente; para agendamento genérico,
  // usar buscar_proximo_horario que começa por hoje.
  description: "Verifica horários disponíveis por profissional para um serviço em uma DATA ESPECÍFICA. Use SOMENTE quando o cliente já pediu explicitamente por um dia específico (ex: 'quero na sexta', 'tem vaga dia 15?', 'posso ir amanhã?'). Para agendamento sem data definida, use buscar_proximo_horario. Se o cliente mencionar um período do dia ('de manhã', 'à tarde', 'de noite'), passe o argumento `periodo` para receber SOMENTE os horários daquele período — não filtre você mesmo. SE O CLIENTE PERGUNTAR POR UM HORÁRIO ESPECÍFICO (ex: 'tem às 11h?', 'pode 14:30?'), passe o argumento `hora` — a resposta traz `horaConsultadaDisponivel` (true/false) e, por profissional, `horaDisponivel`. Responda com base nesse campo: se true, confirme aquele horário; se false, ofereça a faixa `rangeFormatado`. NUNCA diga 'não consegui verificar'. A resposta também traz `dataFormatada` (ex: 'segunda-feira, 22/06/2026') — use-a ao mencionar a data ao cliente (já inclui o dia da semana correto). Por profissional vêm `rangeFormatado` (ex: 'das 13:00 às 18:00') e `horariosDisponiveis` (quantidade). Apresente a disponibilidade USANDO `rangeFormatado` — a lista de horários individuais NÃO é fornecida. Quando o cliente escolher um horário, chame `criar_evento`; a validação de que está livre é feita automaticamente.",
  parameters: {
    type: "object",
    properties: {
      servicoId: { type: "number", description: "ID do serviço" },
      data: { type: "string", description: "Data no formato YYYY-MM-DD" },
      periodo: { type: "string", description: "Período do dia desejado: 'manha' (antes de 12h), 'tarde' (12h–18h) ou 'noite' (a partir de 18h). Opcional — informe APENAS se o cliente especificar." },
      hora: { type: "string", description: "Horário específico consultado pelo cliente no formato HH:MM (ex: '11:00'). Opcional — informe APENAS quando o cliente perguntar por um horário exato ('tem às 11h?'). A resposta dirá deterministicamente se está livre." }
    },
    required: ["servicoId", "data"]
  }
};
