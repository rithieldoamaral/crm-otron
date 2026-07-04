/**
 * Tool: detectar_conversas_criticas
 * Detecta os N tickets mais críticos com base em 4 sinais determinísticos.
 *
 * Sinais e pesos:
 *   ALTO  (+3): keyword de risco no lastMessage (cancelar, Procon, advogado…)
 *   ALTO  (+3): 3+ mensagens consecutivas do cliente sem resposta do agente
 *   ALTO  (+3): agendamento vinculado ao contato nas próximas 2h
 *   MÉDIO (+2): ticket sem atividade há mais de X horas (configurável)
 *
 * Nenhuma chamada LLM — regex e contagem simples para garantir velocidade
 * e determinismo. CLAUDE.md II.5: "não chamar LLM para keyword matching."
 */

import { Op } from "sequelize";
import Ticket from "../../../models/Ticket";
import Message from "../../../models/Message";
import Schedule from "../../../models/Schedule";
import Contact from "../../../models/Contact";

const PESO_ALTO = 3;
const PESO_MEDIO = 2;
// Score mínimo para prioridade "alta": pelo menos um sinal Alto disparado.
const LIMIAR_PRIORIDADE_ALTA = PESO_ALTO;

/**
 * Palavras-chave que indicam risco de churn, conflito ou reclamação formal.
 * Variações de acentuação cobertas para robustez em mensagens WhatsApp reais.
 */
const RISK_KEYWORDS =
  /cancelar|absurdo|inadmiss[ií]vel|reclama[çc][ãa]o|processo|procon|advogado/i;

interface DetectarConversasCriticasArgs {
  /** Máximo de conversas retornadas (default 5). */
  limiteResultados?: number;
  /** Horas sem atividade no ticket para sinalizar como Médio (default 4). */
  horasInatividadeAlerta?: number;
}

interface ConversaCriticaItem {
  ticketId: number;
  cliente: string;
  telefone: string;
  /** "alta" = pelo menos 1 sinal Alto; "media" = apenas sinais Médios. */
  prioridade: "alta" | "media";
  /** Lista legível dos motivos que geraram o score. */
  motivos: string[];
  /** Pontuação total — maior = mais urgente. */
  score: number;
}

interface DetectarConversasCriticasResult {
  /** Conversas críticas ordenadas por score decrescente, limitadas a N. */
  conversas: ConversaCriticaItem[];
  /** Total real de tickets críticos antes do corte pelo limite. */
  total: number;
}

/**
 * Detecta tickets críticos sem LLM.
 * Usa uma única query de schedules para todos os contatos (batch),
 * e queries paralelas de mensagens por ticket (Promise.all).
 */
export async function detectarConversasCriticas(
  args: DetectarConversasCriticasArgs,
  companyId: number
): Promise<DetectarConversasCriticasResult> {
  const limite = args.limiteResultados ?? 5;
  const horasInatividade = args.horasInatividadeAlerta ?? 4;

  // Step 1: todos os tickets ativos
  const tickets = await Ticket.findAll({
    where: { companyId, status: { [Op.in]: ["open", "pending"] } },
    include: [{ model: Contact, as: "contact", attributes: ["name", "number"] }],
    order: [["updatedAt", "ASC"]]
  });

  if (tickets.length === 0) return { conversas: [], total: 0 };

  const now = new Date();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const inactivityThreshold = new Date(now.getTime() - horasInatividade * 60 * 60 * 1000);

  // Step 2: agendamentos nas próximas 2h — uma query para todos os contactIds
  const contactIds = [...new Set(
    (tickets as any[]).map(t => t.contactId).filter((id: unknown) => id != null)
  )] as number[];

  const contactsWithAppointment = new Set<number>();
  if (contactIds.length > 0) {
    const upcoming = await Schedule.findAll({
      where: {
        companyId,
        contactId: { [Op.in]: contactIds },
        sendAt: { [(Op as any).between]: [now, in2h] }
      },
      attributes: ["contactId"]
    });
    for (const s of upcoming as any[]) {
      contactsWithAppointment.add(s.contactId);
    }
  }

  // Step 3: últimas 10 mensagens por ticket em paralelo
  const messageMaps = await Promise.all(
    (tickets as any[]).map(async (ticket) => {
      // companyId redundante por transitividade (ticket já filtrado), mas mantido
      // como defense-in-depth contra eventual vazamento de ticketId entre empresas.
      const msgs = await Message.findAll({
        where: { ticketId: ticket.id, companyId },
        attributes: ["fromMe"],
        order: [["createdAt", "DESC"]],
        limit: 10
      });
      return { ticketId: ticket.id as number, msgs: msgs as any[] };
    })
  );
  const messagesByTicket = new Map<number, any[]>(
    messageMaps.map(({ ticketId, msgs }) => [ticketId, msgs])
  );

  // Step 4: scoring determinístico
  const scored: ConversaCriticaItem[] = [];

  for (const ticket of tickets as any[]) {
    let score = 0;
    const motivos: string[] = [];

    // Sinal ALTO: keyword de risco
    if (ticket.lastMessage && RISK_KEYWORDS.test(ticket.lastMessage)) {
      score += PESO_ALTO;
      motivos.push("Mensagem com palavra-chave de risco");
    }

    // Sinal ALTO: 3+ mensagens consecutivas do cliente sem resposta
    // Mensagens já em DESC (mais recente primeiro) → conta as iniciais sem interrupção
    const msgs = messagesByTicket.get(ticket.id) ?? [];
    let consecutivasCliente = 0;
    for (const msg of msgs) {
      if (!msg.fromMe) consecutivasCliente++;
      else break;
    }
    if (consecutivasCliente >= 3) {
      score += PESO_ALTO;
      motivos.push(`${consecutivasCliente} mensagens sem resposta do agente`);
    }

    // Sinal ALTO: agendamento do cliente nas próximas 2h
    if (ticket.contactId != null && contactsWithAppointment.has(ticket.contactId)) {
      score += PESO_ALTO;
      motivos.push("Agendamento nas próximas 2h");
    }

    // Sinal MÉDIO: inatividade prolongada
    if (new Date(ticket.updatedAt) < inactivityThreshold) {
      score += PESO_MEDIO;
      const hrsAgo = Math.floor(
        (now.getTime() - new Date(ticket.updatedAt).getTime()) / 3_600_000
      );
      motivos.push(`Sem atividade há ${hrsAgo}h`);
    }

    if (score === 0) continue;

    scored.push({
      ticketId: ticket.id,
      cliente: ticket.contact?.name ?? "Desconhecido",
      telefone: ticket.contact?.number ?? "",
      prioridade: score >= LIMIAR_PRIORIDADE_ALTA ? "alta" : "media",
      motivos,
      score
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    conversas: scored.slice(0, limite),
    total: scored.length
  };
}

export const detectarConversasCriticasDefinition = {
  name: "detectar_conversas_criticas",
  description:
    "Escaneia todos os tickets ativos e identifica os mais críticos por 4 sinais: " +
    "palavras de risco na mensagem (cancelar, Procon, advogado…), " +
    "3+ mensagens do cliente sem resposta, " +
    "agendamento nas próximas 2h, inatividade prolongada. " +
    "Use quando o admin perguntar 'tem algo crítico?', 'quem precisa de atenção agora?', " +
    "'algum caso urgente?'.",
  parameters: {
    type: "object",
    properties: {
      limiteResultados: { type: "number", description: "Máximo de conversas retornadas (default 5)" },
      horasInatividadeAlerta: { type: "number", description: "Horas sem atividade para sinalizar (default 4)" }
    },
    required: []
  }
};
