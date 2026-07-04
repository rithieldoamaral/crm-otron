/**
 * Tool: enviar_mensagem
 * Envia uma mensagem WhatsApp para um contato da empresa.
 * Reutiliza a infraestrutura existente de tickets e envio do Whaticket.
 */

import Contact from "../../../models/Contact";
import FindOrCreateTicketService from "../../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../../WbotServices/SendWhatsAppMessage";

interface EnviarMensagemArgs {
  contactId: number;
  mensagem: string;
}

interface EnviarMensagemResult {
  sucesso: boolean;
  mensagem: string;
  ticketId?: number;
  erro?: string;
}

/**
 * Envia uma mensagem para um contato via WhatsApp.
 * Cria ou reutiliza um ticket aberto para o contato.
 *
 * @param args - { contactId, mensagem }
 * @param companyId - ID da empresa (isolamento multi-tenant)
 * @param whatsappId - ID da conexão WhatsApp do canal agente
 * @returns Confirmação do envio ou descrição do erro
 */
export async function enviarMensagem(
  args: EnviarMensagemArgs,
  companyId: number,
  whatsappId: number
): Promise<EnviarMensagemResult> {
  try {
    const { contactId, mensagem } = args;

    const contato = await Contact.findOne({
      where: { id: contactId, companyId }
    });

    if (!contato) {
      return {
        sucesso: false,
        mensagem: "Contato não encontrado.",
        erro: `Contato ID ${contactId} não encontrado na empresa ${companyId}.`
      };
    }

    const ticket = await FindOrCreateTicketService(
      contato,
      whatsappId,
      0,
      companyId
    );

    await SendWhatsAppMessage({ body: mensagem, ticket });

    return {
      sucesso: true,
      mensagem: `✅ Mensagem enviada para ${contato.name} (${contato.number}).`,
      ticketId: ticket.id
    };
  } catch (error) {
    return {
      sucesso: false,
      mensagem: "Erro ao enviar mensagem.",
      erro: (error as Error).message
    };
  }
}

export const enviarMensagemDefinition = {
  name: "enviar_mensagem",
  description:
    "Envia uma mensagem WhatsApp para um contato. Use buscar_contato primeiro para obter o contactId correto.",
  parameters: {
    type: "object",
    properties: {
      contactId: {
        type: "number",
        description: "ID numérico do contato (obtido via buscar_contato)"
      },
      mensagem: {
        type: "string",
        description: "Texto da mensagem a ser enviada"
      }
    },
    required: ["contactId", "mensagem"]
  }
};
