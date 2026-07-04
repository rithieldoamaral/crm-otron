import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";

/**
 * Encontra (ou cria) o ticket DEDICADO de conversa com a Secretária IA para um
 * contato admin. Esse ticket é mantido separado dos atendimentos de cliente pelo
 * `status: "secretary"` — assim ele:
 *   - NUNCA aparece nas abas "Atendendo" (open) / "Aguardando" (pending), que
 *     filtram por status exato;
 *   - aparece na aba dedicada "Secretária" (que lista `status=secretary`);
 *   - reaproveita toda a UI de conversa (bolhas, histórico, busca) sem código novo.
 *
 * Decisão (ticket #22, 2026-06-28): usar `status` em vez de uma coluna nova
 * `isSecretary` evita migration e reaproveita o roteamento por status-room do
 * socket (`company-{companyId}-secretary`). Ver decisions_log.md.
 *
 * É idempotente: uma conversa de Secretária por (contato, canal, empresa).
 *
 * @param contact - contato admin (remetente reconhecido como admin)
 * @param whatsappId - canal por onde a mensagem chegou
 * @param companyId - empresa (multi-tenant)
 * @returns o ticket de Secretária pronto (com associações via ShowTicketService)
 */
const FindOrCreateSecretaryTicketService = async (
  contact: Contact,
  whatsappId: number,
  companyId: number
): Promise<Ticket> => {
  // A tabela Tickets tem a constraint UNIQUE (contactId, companyId, whatsappId):
  // só pode existir UM ticket por contato/empresa/canal. Por isso NÃO criamos um
  // segundo ticket para o admin (que já pode ter um ticket de teste como "cliente")
  // — isso lançaria SequelizeUniqueConstraintError. Em vez disso, buscamos o ticket
  // existente do admin (em QUALQUER status) e o CONVERTEMOS para "secretary".
  // O thread do admin É o thread da Secretária — ele não é um cliente.
  let ticket = await Ticket.findOne({
    where: {
      contactId: contact.id,
      companyId,
      whatsappId
    },
    order: [["id", "DESC"]]
  });

  if (ticket) {
    if (ticket.status !== "secretary") {
      // Converte o ticket do admin em ticket de Secretária e limpa os vínculos de
      // atendimento humano (fila/usuário/chatbot) para que ele saia das abas de
      // cliente (Atendendo/Aguardando) e o agente nunca mais o processe.
      await ticket.update({
        status: "secretary",
        unreadMessages: 0,
        queueId: null,
        userId: null,
        chatbot: false
      });
    }
  } else {
    ticket = await Ticket.create({
      contactId: contact.id,
      status: "secretary",
      isGroup: false,
      // unreadMessages: 0 — a Secretária responde na hora; não há "não lidas"
      // pendentes de um atendente humano.
      unreadMessages: 0,
      whatsappId,
      companyId
    });
  }

  return ShowTicketService(ticket.id, companyId);
};

export default FindOrCreateSecretaryTicketService;
