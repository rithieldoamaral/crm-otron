import { Op } from "sequelize";
import Ticket from "../../models/Ticket"
import Whatsapp from "../../models/Whatsapp"
import { getIO } from "../../libs/socket"
import formatBody from "../../helpers/Mustache";
import SendWhatsAppMessage from "./SendWhatsAppMessage";
import moment from "moment";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { verifyMessage } from "./wbotMessageListener";
import TicketTraking from "../../models/TicketTraking";
import { logger } from "../../utils/logger";

export const ClosedAllOpenTickets = async (companyId: number): Promise<void> => {

  // @ts-ignore: Unreachable code error
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    if (currentStatus === 'nps') {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else if (currentStatus === 'open') {

      await ticket.update({
        status: "closed",
        //  userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });

    } else {

      await ticket.update({
        status: "closed",
        //userId: ticket.userId || null,
        unreadMessages: 0
      });
    }
  };

  const io = getIO();
  try {

    const { rows: tickets } = await Ticket.findAndCountAll({
      where: { status: { [Op.in]: ["open"] }, companyId },
      order: [["updatedAt", "DESC"]]
    });

    // Loop sequencial com `for...of` + `await`: diferente de `forEach(async ...)`,
    // aqui as rejeições NÃO viram unhandled rejections. Cada ticket tem seu PRÓPRIO
    // try/catch para que uma falha isolada (ex: erro de BD num ticket) NÃO aborte o
    // lote inteiro — os demais continuam sendo processados nesta execução do cron.
    for (const ticket of tickets) {
      try {
        const showTicket = await ShowTicketService(ticket.id, companyId);
        const whatsapp = await Whatsapp.findByPk(showTicket?.whatsappId);
        const ticketTraking = await TicketTraking.findOne({
          where: {
            ticketId: ticket.id,
            finishedAt: null,
          }
        })

        if (!whatsapp) continue;

        // ticketTraking pode ser null (nenhum tracking aberto para o ticket). Sem esta
        // guarda, o `ticketTraking.update(...)` mais abaixo lançaria TypeError em runtime.
        if (!ticketTraking) {
          logger.warn(
            `[ClosedAllOpenTickets] Nenhum TicketTraking aberto para ticketId=${ticket.id} (companyId=${companyId}); pulando.`
          );
          continue;
        }

        let {
          expiresInactiveMessage, //mensage de encerramento por inatividade
          expiresTicket //tempo em horas para fechar ticket automaticamente
        } = whatsapp


        // @ts-ignore: Unreachable code error
        if (expiresTicket && expiresTicket !== "" &&
          // @ts-ignore: Unreachable code error
          expiresTicket !== "0" && Number(expiresTicket) > 0) {

          //mensagem de encerramento por inatividade
          const bodyExpiresMessageInactive = formatBody(`‎ ${expiresInactiveMessage}`, showTicket.contact);

          const dataLimite = new Date()
          dataLimite.setMinutes(dataLimite.getMinutes() - Number(expiresTicket));

          if (showTicket.status === "open" && !showTicket.isGroup) {

            const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt)

            if (dataUltimaInteracaoChamado < dataLimite && showTicket.fromMe) {

              // AWAIT: sem ele a rejeição do update escaparia deste try/catch como
              // unhandled rejection (a MESMA classe de bug que este fix elimina).
              await closeTicket(showTicket, showTicket.status, bodyExpiresMessageInactive);

              if (expiresInactiveMessage !== "" && expiresInactiveMessage !== undefined) {
                const sentMessage = await SendWhatsAppMessage({ body: bodyExpiresMessageInactive, ticket: showTicket });

                await verifyMessage(sentMessage, showTicket, showTicket.contact);
              }

              await ticketTraking.update({
                finishedAt: moment().toDate(),
                closedAt: moment().toDate(),
                whatsappId: ticket.whatsappId,
                userId: ticket.userId,
              })

              io.to("open").emit(`company-${companyId}-ticket`, {
                action: "delete",
                ticketId: showTicket.id
              });

            }
          }
        }
      } catch (ticketErr: any) {
        // Falha isolada de um ticket não aborta o lote (cron roda a cada 5 min;
        // o ticket volta a ser tentado na próxima execução).
        logger.error(
          `[ClosedAllOpenTickets] Falha ao processar ticketId=${ticket.id} (companyId=${companyId}): ${ticketErr?.message || ticketErr}`
        );
      }
    }

  } catch (e: any) {
    logger.error(
      `[ClosedAllOpenTickets] Erro ao listar/fechar tickets abertos (companyId=${companyId}): ${e?.message || e}`
    );
  }

}
