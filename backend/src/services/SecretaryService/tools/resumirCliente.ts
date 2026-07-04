/**
 * Tool: resumir_cliente
 * Pipeline sub-LLM para gerar um resumo de atendimento de um cliente específico.
 *
 * Fluxo:
 *   1. Busca o contato por nome parcial ou telefone (iLike)
 *   2. Carrega os N tickets mais recentes (default: 3, max: 5)
 *   3. Para cada ticket, carrega as últimas 15 mensagens (paralelo)
 *   4. Monta prompt e faz UMA chamada `provider.chat()` — sem tools
 *   5. Retorna o resumo em bullet points gerado pelo LLM
 *
 * Por que sub-LLM e não template fixo: o histórico de mensagens é livre,
 * e só um LLM consegue extrair intenção, tom e pontos de atenção com
 * confiabilidade razoável. Usar `provider.chat()` (sem tools) mantém o
 * custo baixo — prompt simples, resposta de até ~400 tokens.
 */

import { Op } from "sequelize";
import Contact  from "../../../models/Contact";
import Ticket   from "../../../models/Ticket";
import Message  from "../../../models/Message";
import { getSettingsByCompany }   from "../../AgentService/settingsCache";
import { AIProviderFactory }      from "../../AgentService/providers/AIProviderFactory";
import { ProviderConfig }         from "../../AgentService/providers/interfaces";

// ── Constantes ──────────────────────────────────────────────────────────────

const MAX_TICKETS_DEFAULT  = 3;
const MAX_TICKETS_LIMIT    = 5;
const MAX_MESSAGES_PER_TICKET = 15;

const SUMMARY_SYSTEM_PROMPT = `Você é um assistente especializado em resumir históricos de atendimento ao cliente.
Com base nas conversas fornecidas, gere um resumo conciso em bullet points (use •) contendo:
• Principais solicitações do cliente
• Status atual e pendências
• Tom da conversa (satisfeito, frustrado, neutro)
• Última interação (quando e sobre o quê)
Seja direto, objetivo e use português brasileiro. Máximo 8 bullets.`;

// ── Interfaces ──────────────────────────────────────────────────────────────

interface ResumirClienteArgs {
  /** Nome parcial ou número de telefone do cliente. */
  cliente: string;
  /** Número de tickets recentes a analisar (default: 3, máx: 5). */
  maxTickets?: number;
}

interface ResumirClienteResult {
  clienteEncontrado: boolean;
  clienteNome?: string;
  clienteTelefone?: string;
  /** Resumo em bullet points gerado pelo sub-LLM. */
  resumo?: string;
  totalTickets?: number;
  erro?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function loadProviderConfig(companyId: number): Promise<ProviderConfig> {
  const rows = await getSettingsByCompany(companyId);
  const map  = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  return {
    provider: (map.agentProvider ?? "anthropic") as ProviderConfig["provider"],
    apiKey:   map.agentApiKey   ?? "",
    model:    map.agentModel    ?? "claude-haiku-4-5-20251001"
  };
}

/**
 * Monta o prompt do usuário para o sub-LLM com o histórico de conversas.
 */
function buildUserPrompt(
  contactName: string,
  contactNumber: string,
  ticketMessages: Array<{ ticket: any; messages: any[] }>
): string {
  const convoText = ticketMessages.map(({ ticket, messages }) => {
    const status  = ticket.status;
    const date    = new Date(ticket.createdAt).toLocaleDateString("pt-BR");
    const msgLines = messages
      .map((m: any) => `${m.fromMe ? "[Atendente]" : "[Cliente]"}: ${m.body ?? "(mídia)"}`)
      .join("\n");
    return `--- Ticket #${ticket.id} (${status}, iniciado em ${date}) ---\n${msgLines || "(sem mensagens de texto)"}`;
  }).join("\n\n");

  return `Cliente: ${contactName} (${contactNumber})\n\nConversas recentes:\n\n${convoText}\n\nGere um resumo em bullets sobre este cliente.`;
}

// ── Função principal ─────────────────────────────────────────────────────────

/**
 * Busca o histórico de um cliente e gera um resumo inteligente via sub-LLM.
 *
 * @param args       - { cliente: nome ou telefone, maxTickets?: número }
 * @param companyId  - ID da empresa para isolamento multi-tenant
 */
export async function resumirCliente(
  args: ResumirClienteArgs,
  companyId: number
): Promise<ResumirClienteResult> {
  // ── 1. Busca o contato ────────────────────────────────────────────────────

  const termo = args.cliente.trim();
  const isPhone = /^\d+$/.test(termo);

  const contactWhere: any = { companyId };
  if (isPhone) {
    contactWhere.number = { [Op.iLike]: `%${termo}%` };
  } else {
    contactWhere.name = { [Op.iLike]: `%${termo}%` };
  }

  const contact = await Contact.findOne({
    where: contactWhere,
    order: [["name", "ASC"]]
  });

  if (!contact) {
    return {
      clienteEncontrado: false,
      erro: `Nenhum cliente encontrado com "${termo}".`
    };
  }

  const c = contact as any;

  // ── 2. Busca tickets recentes ─────────────────────────────────────────────

  const maxTickets = Math.min(args.maxTickets ?? MAX_TICKETS_DEFAULT, MAX_TICKETS_LIMIT);

  const tickets = await Ticket.findAll({
    where: { companyId, contactId: c.id },
    order: [["updatedAt", "DESC"]],
    limit: maxTickets,
    attributes: ["id", "status", "contactId", "createdAt", "updatedAt"]
  });

  // Sem histórico — retorna feedback simples sem chamar o sub-LLM
  if (tickets.length === 0) {
    return {
      clienteEncontrado: true,
      clienteNome:     c.name,
      clienteTelefone: c.number,
      totalTickets:    0,
      resumo:          `• ${c.name} não possui atendimentos registrados.`
    };
  }

  // ── 3. Busca mensagens de cada ticket (paralelo) ──────────────────────────

  const ticketMessages = await Promise.all(
    (tickets as any[]).map(async (ticket) => {
      // companyId redundante por transitividade (ticket já filtrado), mas mantido
      // como defense-in-depth contra eventual vazamento de ticketId entre empresas.
      const msgs = await Message.findAll({
        where:      { ticketId: ticket.id, companyId },
        order:      [["createdAt", "DESC"]],
        limit:      MAX_MESSAGES_PER_TICKET,
        attributes: ["fromMe", "body", "createdAt"]
      });
      // Reverte para ordem cronológica (mais antiga primeiro)
      return { ticket, messages: (msgs as any[]).reverse() };
    })
  );

  // ── 4. Chama sub-LLM para gerar o resumo ─────────────────────────────────

  try {
    const providerConfig = await loadProviderConfig(companyId);
    const provider       = AIProviderFactory.create(providerConfig);

    const userPrompt = buildUserPrompt(c.name, c.number, ticketMessages);

    const response = await provider.chat(
      [{ role: "user", content: userPrompt }],
      SUMMARY_SYSTEM_PROMPT,
      { temperature: 0.3, maxTokens: 400 }
    );

    return {
      clienteEncontrado: true,
      clienteNome:     c.name,
      clienteTelefone: c.number,
      totalTickets:    tickets.length,
      resumo:          response.content ?? "• Sem resumo disponível."
    };
  } catch (err: any) {
    return {
      clienteEncontrado: true,
      clienteNome:     c.name,
      clienteTelefone: c.number,
      totalTickets:    tickets.length,
      resumo:          undefined,
      erro:            `Erro ao gerar resumo: ${err.message}`
    };
  }
}

// ── Definição da tool para o SecretaryService ───────────────────────────────

export const resumirClienteDefinition = {
  name: "resumir_cliente",
  description:
    "Gera um resumo inteligente do histórico de atendimento de um cliente: " +
    "principais solicitações, status atual, tom da conversa e última interação. " +
    "Use quando o admin perguntar 'me fala sobre o Carlos', 'o que esse cliente quer?', " +
    "'qual o histórico do número 5511...?', 'antes de ligar, me resume o cliente'.",
  parameters: {
    type: "object",
    properties: {
      cliente: {
        type: "string",
        description: "Nome parcial ou número de telefone do cliente (ex: 'Carlos', '5511999...')"
      },
      maxTickets: {
        type: "number",
        description: "Quantos tickets recentes analisar (default: 3, máx: 5)"
      }
    },
    required: ["cliente"]
  }
};
