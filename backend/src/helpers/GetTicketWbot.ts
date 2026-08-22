import { WASocket } from "baileys";
import { getWbot } from "../libs/wbot";
import GetDefaultWhatsApp from "./GetDefaultWhatsApp";
import Ticket from "../models/Ticket";
import { Store } from "../libs/store";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import { isCanalOficial } from "../services/ChannelService/types";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

/**
 * Devolve a sessão Baileys do ticket.
 *
 * GUARDA DE CANAL (directives/canal_oficial_whatsapp.md §3.3): este helper é o
 * funil por onde passam TODOS os recursos que ainda falam com o socket direto
 * — mídia, reações, deleção de mensagem, grupos, Typebot. Canal oficial não
 * tem socket algum: é webhook + REST.
 *
 * A guarda fica aqui, e não replicada em cada um dos ~17 pontos de chamada,
 * porque um único ponto de verificação não pode ser esquecido quando alguém
 * adicionar o 18º. Sem ela, `getWbot` lançaria "ERR_WAPP_NOT_INITIALIZED" —
 * mensagem que manda o operador investigar sessão caída, quando o problema
 * real é recurso não suportado naquele canal.
 *
 * @throws {AppError} ERR_FEATURE_BAILEYS_ONLY se a conexão for canal oficial.
 */
const GetTicketWbot = async (ticket: Ticket): Promise<Session> => {
  if (!ticket.whatsappId) {
    const defaultWhatsapp = await GetDefaultWhatsApp(
      ticket.companyId,
      ticket.userId
    );

    await ticket.$set("whatsapp", defaultWhatsapp);
  }

  const conexao =
    ticket.whatsapp ?? (await Whatsapp.findByPk(ticket.whatsappId));

  if (conexao && isCanalOficial(conexao.channelType)) {
    throw new AppError(
      `ERR_FEATURE_BAILEYS_ONLY: recurso indisponível no canal ${conexao.channelType}`,
      400
    );
  }

  const wbot = getWbot(ticket.whatsappId);
  return wbot;
};

export default GetTicketWbot;
