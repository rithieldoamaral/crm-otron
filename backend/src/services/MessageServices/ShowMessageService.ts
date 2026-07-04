import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

/**
 * Busca uma mensagem pelo ID.
 *
 * SEGURANÇA: usa findByPk (parametrizado pelo Sequelize) em vez de raw query
 * com template literal para evitar SQL injection.
 *
 * Antes: `select * from "Messages" where id = '${messageId}'` — vulnerável a
 * payloads como `' OR 1=1 --` vindos de req.body em forwardMessage.
 *
 * @param messageId ID da mensagem (string ou número aceito pelo Sequelize)
 * @returns Message ou undefined se não encontrada
 */
const ShowMessageService = async (messageId: string): Promise<Message | undefined> => {
  const message = await Message.findByPk(messageId);
  return message ?? undefined;
}

export const GetWhatsAppFromMessage = async (message: Message): Promise<number | null> => {
  const ticketId = message.ticketId;
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) {
    return null;
  }
  return ticket.whatsappId;
}


export default ShowMessageService;
