/**
 * Tool: enviar_mensagem_para_cliente
 * Envia uma mensagem WhatsApp a um cliente.
 *
 * Aceita DUAS formas de destino:
 *   1. ticketId  — cliente que JÁ tem um atendimento aberto (fluxo original).
 *   2. contactId — QUALQUER contato do CRM (mesmo sem ticket): acha o contato,
 *      abre/encontra um ticket para ele no canal padrão e envia. Habilita o disparo
 *      proativo 1-a-1 ("avise a Amanda que tem corte amanhã") após `consultar_contatos`.
 *
 * É uma ação destrutiva/visível (envia em nome da empresa) — o loop da Secretária
 * já a estaciona para confirmação do admin antes de executar (DESTRUCTIVE_TOOLS).
 */

import Ticket from "../../../models/Ticket";
import Contact from "../../../models/Contact";
import SendWhatsAppMessage from "../../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../../TicketServices/FindOrCreateTicketService";
import GetDefaultWhatsApp from "../../../helpers/GetDefaultWhatsApp";

interface EnviarMensagemParaClienteArgs {
  ticketId?: number;
  contactId?: number;
  mensagem: string;
}

interface EnviarMensagemParaClienteResult {
  sucesso: boolean;
  mensagem?: string;
  erro?: string;
}

/**
 * Envia mensagem para um cliente, por ticketId OU contactId.
 * Autentica sempre por companyId (isolamento multi-tenant).
 *
 * @param args - { ticketId? , contactId? , mensagem }
 * @param companyId - empresa
 * @returns { sucesso, mensagem? , erro? }
 */
export async function enviarMensagemParaCliente(
  args: EnviarMensagemParaClienteArgs,
  companyId: number
): Promise<EnviarMensagemParaClienteResult> {
  const { ticketId, contactId, mensagem } = args;

  if (!mensagem || !mensagem.trim()) {
    return { sucesso: false, erro: "Mensagem vazia — informe o texto a enviar." };
  }

  let ticket: Ticket | null = null;

  if (ticketId) {
    ticket = await Ticket.findOne({
      where: { id: ticketId, companyId },
      include: [{ model: Contact, as: "contact", attributes: ["name", "number"] }]
    });
    if (!ticket) {
      return { sucesso: false, erro: `Ticket #${ticketId} não encontrado nesta empresa.` };
    }
  } else if (contactId) {
    // Disparo a um contato SEM ticket: valida o contato, pega o canal conectado da
    // empresa e abre/encontra um ticket para ele. Se o cliente responder, o atendimento
    // segue normalmente pelo agente.
    const contact = await Contact.findOne({ where: { id: contactId, companyId } });
    if (!contact) {
      return { sucesso: false, erro: `Contato #${contactId} não encontrado nesta empresa.` };
    }
    try {
      const whatsapp = await GetDefaultWhatsApp(companyId);
      ticket = await FindOrCreateTicketService(contact, whatsapp.id, 0, companyId);
    } catch (error) {
      return {
        sucesso: false,
        erro: `Não há canal de WhatsApp conectado para enviar: ${(error as Error).message}`
      };
    }
  } else {
    return { sucesso: false, erro: "Informe ticketId ou contactId para enviar a mensagem." };
  }

  try {
    await SendWhatsAppMessage({ body: mensagem, ticket: ticket as any });

    const clienteNome = (ticket as any).contact?.name ?? "cliente";
    return {
      sucesso: true,
      mensagem: `✅ Mensagem enviada para ${clienteNome} (ticket #${ticket.id}).`
    };
  } catch (error) {
    return { sucesso: false, erro: `Falha ao enviar: ${(error as Error).message}` };
  }
}

export const enviarMensagemParaClienteDefinition = {
  name: "enviar_mensagem_para_cliente",
  description:
    "Envia uma mensagem WhatsApp a um cliente. Informe ticketId (cliente com atendimento " +
    "aberto) OU contactId (qualquer contato do CRM, mesmo sem ticket — obtido via " +
    "consultar_contatos). Use quando o admin pedir para avisar, notificar ou comunicar algo " +
    "a um cliente.",
  parameters: {
    type: "object",
    properties: {
      ticketId: { type: "number", description: "ID do ticket do cliente (se já houver atendimento aberto)" },
      contactId: { type: "number", description: "ID do contato (use quando o cliente NÃO tem ticket aberto — obtenha via consultar_contatos)" },
      mensagem: { type: "string", description: "Texto da mensagem a enviar ao cliente" }
    },
    required: ["mensagem"]
  }
};
