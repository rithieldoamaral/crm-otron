/**
 * Tool: gerar_mensagem_contextualizada
 * Redige um rascunho de mensagem para um cliente usando contexto real do ticket
 * e salva no Redis para confirmação pelo admin antes do envio.
 *
 * Fluxo multi-turno:
 *   Admin: "avise o Carlos que o produto chegou"
 *   → tool busca o ticket do Carlos
 *   → sub-LLM redige a mensagem com base no histórico
 *   → salva { ticketId, body, contactName } como pendingAction no Redis
 *   → retorna o rascunho para o secretaryLoop apresentar ao admin
 *
 *   Admin: "sim"
 *   → secretaryLoop intercepta (pendingAction existe + isConfirmation)
 *   → executa enviar_mensagem_para_cliente
 *   → limpa pendingAction
 *
 * Por que não enviar diretamente:
 *   Mensagens enviadas a clientes são irreversíveis. O admin precisa
 *   revisar o rascunho antes do envio — esta etapa de confirmação é intencional.
 */

import { Op } from "sequelize";
import Contact  from "../../../models/Contact";
import Ticket   from "../../../models/Ticket";
import Message  from "../../../models/Message";
import { getSettingsByCompany }         from "../../AgentService/settingsCache";
import { AIProviderFactory }            from "../../AgentService/providers/AIProviderFactory";
import { ProviderConfig }               from "../../AgentService/providers/interfaces";
import { savePendingAction }            from "../pendingAction";

// ── Constantes ──────────────────────────────────────────────────────────────

const MAX_MESSAGES_CONTEXT = 10; // mensagens de contexto para o sub-LLM

const DRAFT_SYSTEM_PROMPT = `Você é um assistente especializado em redigir mensagens de WhatsApp para clientes.
Com base na intenção do admin e no histórico da conversa (se disponível), redija uma mensagem:
• Clara e objetiva (máximo 2-3 parágrafos curtos)
• Tom profissional mas amigável e próximo
• Em português brasileiro
Retorne APENAS o texto da mensagem, sem explicações, prefixos ou aspas.`;

// ── Interfaces ──────────────────────────────────────────────────────────────

interface GerarMensagemArgs {
  /** Intenção do admin: o que ele quer comunicar ao cliente. */
  intencao: string;
  /** Nome parcial ou telefone do cliente. Obrigatório se ticketId não for fornecido. */
  cliente?: string;
  /** ID do ticket específico (preferido quando disponível). */
  ticketId?: number;
  /** Número do remetente admin (para salvar a pendingAction corretamente). */
  senderNumber: string;
}

interface GerarMensagemResult {
  sucesso: boolean;
  rascunho?: string;
  ticketId?: number;
  contactName?: string;
  /** Instrução para o secretaryLoop apresentar ao admin. */
  instrucao?: string;
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

/** Busca o ticket mais relevante do cliente (open first, então mais recente). */
async function findBestTicket(companyId: number, contactId: number): Promise<any | null> {
  // Prefere ticket aberto
  const openTicket = await Ticket.findOne({
    where: { companyId, contactId, status: "open" },
    order: [["updatedAt", "DESC"]],
    attributes: ["id", "status", "contactId", "createdAt", "updatedAt"]
  });
  if (openTicket) return openTicket;

  // Qualquer ticket recente
  return Ticket.findOne({
    where: { companyId, contactId },
    order: [["updatedAt", "DESC"]],
    attributes: ["id", "status", "contactId", "createdAt", "updatedAt"]
  });
}

// ── Função principal ─────────────────────────────────────────────────────────

/**
 * Gera um rascunho de mensagem contextualizado e salva como pendingAction.
 *
 * @param args       - { intencao, cliente?, ticketId?, senderNumber }
 * @param companyId  - ID da empresa para isolamento multi-tenant
 */
export async function gerarMensagemContextualizada(
  args: GerarMensagemArgs,
  companyId: number
): Promise<GerarMensagemResult> {
  let ticket: any = null;
  let contactName = "cliente";

  // ── 1. Resolve ticket + contato ───────────────────────────────────────────

  if (args.ticketId) {
    // ticketId explícito — caminho mais direto
    ticket = await Ticket.findOne({
      where: { id: args.ticketId, companyId },
      include: [{ model: Contact, as: "contact", attributes: ["id", "name", "number"] }],
      attributes: ["id", "status", "contactId", "createdAt"]
    });

    if (!ticket) {
      return { sucesso: false, erro: `Ticket #${args.ticketId} não encontrado.` };
    }
    contactName = ticket.contact?.name ?? "cliente";

  } else if (args.cliente) {
    // Busca pelo nome/telefone do cliente
    const termo = args.cliente.trim();
    const isPhone = /^\d+$/.test(termo);
    const contactWhere: any = { companyId };
    if (isPhone) {
      contactWhere.number = { [Op.iLike]: `%${termo}%` };
    } else {
      contactWhere.name = { [Op.iLike]: `%${termo}%` };
    }

    const contact = await Contact.findOne({ where: contactWhere, order: [["name", "ASC"]] });
    if (!contact) {
      return { sucesso: false, erro: `Nenhum cliente encontrado com "${termo}".` };
    }
    const c = contact as any;
    contactName = c.name;

    ticket = await findBestTicket(companyId, c.id);
    if (!ticket) {
      return { sucesso: false, erro: `${contactName} não possui tickets registrados.` };
    }

  } else {
    return { sucesso: false, erro: "Informe o nome/telefone do cliente ou o ID do ticket." };
  }

  // ── 2. Carrega contexto das mensagens recentes ────────────────────────────

  // companyId redundante por transitividade (ticket já filtrado), mas mantido
  // como defense-in-depth contra eventual vazamento de ticketId entre empresas.
  const recentMsgs = await Message.findAll({
    where:      { ticketId: ticket.id, companyId },
    order:      [["createdAt", "DESC"]],
    limit:      MAX_MESSAGES_CONTEXT,
    attributes: ["fromMe", "body", "createdAt"]
  });

  const conversaContexto = (recentMsgs as any[])
    .reverse()
    .map((m: any) => `${m.fromMe ? "[Atendente]" : "[Cliente]"}: ${m.body ?? "(mídia)"}`)
    .join("\n");

  // ── 3. Chama sub-LLM para redigir o rascunho ─────────────────────────────

  const userPrompt = conversaContexto
    ? `Histórico recente da conversa com ${contactName}:\n${conversaContexto}\n\nIntenção do admin: ${args.intencao}\n\nRedija a mensagem.`
    : `Cliente: ${contactName}\nIntenção do admin: ${args.intencao}\n\nRedija a mensagem.`;

  let rascunho: string;
  try {
    const providerConfig = await loadProviderConfig(companyId);
    const provider       = AIProviderFactory.create(providerConfig);
    const response       = await provider.chat(
      [{ role: "user", content: userPrompt }],
      DRAFT_SYSTEM_PROMPT,
      { temperature: 0.4, maxTokens: 300 }
    );
    rascunho = response.content ?? args.intencao;
  } catch (err: any) {
    // Fallback: usa a intenção do admin como rascunho bruto
    rascunho = args.intencao;
  }

  // ── 4. Salva pendingAction no Redis ──────────────────────────────────────

  await savePendingAction(companyId, args.senderNumber, {
    type:        "enviar_mensagem",
    ticketId:    ticket.id,
    body:        rascunho,
    contactName
  });

  return {
    sucesso:     true,
    rascunho,
    ticketId:    ticket.id,
    contactName,
    instrucao:   `Apresente o rascunho ao admin e aguarde confirmação. Diga: "Vou enviar para *${contactName}*:\n\n${rascunho}\n\nConfirma? (sim/não)"`
  };
}

// ── Definição da tool ────────────────────────────────────────────────────────

export const gerarMensagemContextualizadaDefinition = {
  name: "gerar_mensagem_contextualizada",
  description:
    "Redige um rascunho de mensagem para um cliente com base no histórico real da conversa " +
    "e na intenção do admin. Salva para confirmação antes do envio. " +
    "Use quando o admin disser 'avise o cliente', 'manda uma mensagem para', " +
    "'escreve para o Carlos que...', 'como eu falo com o cliente sobre X'. " +
    "SEMPRE usar esta tool antes de enviar mensagens — ela garante que o admin revise o rascunho.",
  parameters: {
    type: "object",
    properties: {
      intencao: {
        type: "string",
        description: "O que o admin quer comunicar ao cliente (ex: 'informar que o produto chegou')"
      },
      cliente: {
        type: "string",
        description: "Nome parcial ou telefone do cliente (obrigatório se ticketId não for fornecido)"
      },
      ticketId: {
        type: "number",
        description: "ID do ticket específico (preferido quando disponível)"
      },
      senderNumber: {
        type: "string",
        description: "Número do admin que fez o pedido (preenchido automaticamente pelo sistema)"
      }
    },
    required: ["intencao", "senderNumber"]
  }
};
