/**
 * Testes TDD para FindOrCreateSecretaryTicketService — ticket dedicado da
 * Secretária (status="secretary").
 *
 * Regra de ouro (ticket #22): a tabela Tickets tem UNIQUE (contactId, companyId,
 * whatsappId) — só pode existir UM ticket por contato/empresa/canal. Por isso o
 * serviço CONVERTE o ticket existente do admin em "secretary" em vez de criar um
 * segundo (que lançaria SequelizeUniqueConstraintError e fazia o admin cair no agente).
 */

jest.mock("../../../models/Ticket");
jest.mock("../ShowTicketService");

import Ticket from "../../../models/Ticket";
import ShowTicketService from "../ShowTicketService";
import FindOrCreateSecretaryTicketService from "../FindOrCreateSecretaryTicketService";

const mockFindOne = Ticket.findOne as jest.Mock;
const mockCreate = Ticket.create as jest.Mock;
const mockShow = ShowTicketService as jest.Mock;

const contact: any = { id: 8, number: "554888368758", name: "Rithiel" };

beforeEach(() => {
  jest.clearAllMocks();
  mockShow.mockImplementation((id: number) => Promise.resolve({ id, status: "secretary" }));
});

describe("FindOrCreateSecretaryTicketService", () => {
  it("cria um ticket com status='secretary' quando o contato não tem nenhum ticket", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 100, status: "secretary" });

    const ticket = await FindOrCreateSecretaryTicketService(contact, 2, 1);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 8,
        status: "secretary",
        isGroup: false,
        whatsappId: 2,
        companyId: 1
      })
    );
    expect(mockShow).toHaveBeenCalledWith(100, 1);
    expect(ticket.status).toBe("secretary");
  });

  it("CONVERTE o ticket existente do admin (ex: #22 'open') em 'secretary' — NÃO cria outro", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindOne.mockResolvedValue({ id: 22, status: "open", update });

    const ticket = await FindOrCreateSecretaryTicketService(contact, 2, 2);

    // Não cria (evita violar a UNIQUE constraint).
    expect(mockCreate).not.toHaveBeenCalled();
    // Converte para secretary e limpa vínculos de atendimento humano.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "secretary",
        queueId: null,
        userId: null,
        chatbot: false
      })
    );
    expect(mockShow).toHaveBeenCalledWith(22, 2);
    expect(ticket.id).toBe(22);
  });

  it("busca o ticket por (contactId, companyId, whatsappId) — a mesma chave da UNIQUE constraint", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 101, status: "secretary" });

    await FindOrCreateSecretaryTicketService(contact, 2, 1);

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactId: 8, companyId: 1, whatsappId: 2 })
      })
    );
  });

  it("NÃO re-atualiza quando o ticket já está em 'secretary' (idempotente)", async () => {
    const update = jest.fn();
    mockFindOne.mockResolvedValue({ id: 22, status: "secretary", update });

    await FindOrCreateSecretaryTicketService(contact, 2, 2);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledWith(22, 2);
  });
});
