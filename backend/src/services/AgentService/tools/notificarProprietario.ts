/**
 * Tool: notificar_proprietario
 * Envia uma mensagem direta para o número pessoal do proprietário.
 * Usada pelo agente de atendimento para alertar sobre urgências.
 */

import Whatsapp from "../../../models/Whatsapp";
import Setting from "../../../models/Setting";
import Contact from "../../../models/Contact";
import FindOrCreateTicketService from "../../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../../WbotServices/SendWhatsAppMessage";

interface NotificarProprietarioArgs {
  mensagem: string;
  prioridade?: "normal" | "urgente";
}

interface NotificarProprietarioResult {
  sucesso: boolean;
  mensagem: string;
  erro?: string;
}

/**
 * Notifica o proprietário do negócio via WhatsApp pessoal.
 * O número do proprietário é lido da Settings da empresa (agentOwnerNumber).
 * A mensagem é enviada pelo canal agente configurado.
 *
 * @param args - { mensagem, prioridade }
 * @param companyId - ID da empresa
 * @returns Confirmação do envio ou erro
 */
export async function notificarProprietario(
  args: NotificarProprietarioArgs,
  companyId: number
): Promise<NotificarProprietarioResult> {
  try {
    const { mensagem, prioridade = "normal" } = args;

    const ownerSetting = await Setting.findOne({
      where: { companyId, key: "agentOwnerNumber" }
    });

    if (!ownerSetting?.value) {
      return {
        sucesso: false,
        mensagem: "Número do proprietário não configurado.",
        erro: "Configure o agentOwnerNumber nas configurações da empresa."
      };
    }

    const agentWhatsapp = await Whatsapp.findOne({
      where: { companyId, isAgentChannel: true, status: "CONNECTED" }
    });

    if (!agentWhatsapp) {
      return {
        sucesso: false,
        mensagem: "Canal do agente não está conectado.",
        erro: "Nenhuma conexão WhatsApp marcada como canal do agente está conectada."
      };
    }

    const numero = ownerSetting.value.replace(/\D/g, "");
    const [contatoProprietario] = await Contact.findOrCreate({
      where: { number: numero, companyId },
      defaults: { name: "Proprietário", number: numero, companyId } as any
    });

    const ticket = await FindOrCreateTicketService(
      contatoProprietario,
      agentWhatsapp.id,
      0,
      companyId
    );

    const prefixo = prioridade === "urgente" ? "🚨 *URGENTE* — " : "📢 ";
    await SendWhatsAppMessage({ body: `${prefixo}${mensagem}`, ticket });

    return {
      sucesso: true,
      mensagem: `✅ Proprietário notificado (${prioridade}).`
    };
  } catch (error) {
    return {
      sucesso: false,
      mensagem: "Erro ao notificar proprietário.",
      erro: (error as Error).message
    };
  }
}

export const notificarProprietarioDefinition = {
  name: "notificar_proprietario",
  description:
    "Envia uma notificação para o proprietário do negócio via WhatsApp. Use para urgências, emergências ou situações que requerem decisão humana imediata.",
  parameters: {
    type: "object",
    properties: {
      mensagem: {
        type: "string",
        description: "Texto da notificação para o proprietário"
      },
      prioridade: {
        type: "string",
        enum: ["normal", "urgente"],
        description: "'urgente' adiciona prefixo 🚨 URGENTE na mensagem"
      }
    },
    required: ["mensagem"]
  }
};
