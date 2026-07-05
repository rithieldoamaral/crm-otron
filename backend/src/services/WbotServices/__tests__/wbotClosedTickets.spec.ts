/**
 * Testes TDD para ClosedAllOpenTickets (auto-close de tickets abertos).
 *
 * Foco do fix coberto por estes testes:
 *  1. `ticketTraking` null → NÃO lança, loga warn e continua (guarda contra TypeError).
 *  2. Um ticket que lança erro no meio da iteração é capturado pelo try/catch externo
 *     (não vira unhandled rejection) — o loop sequencial `for...of` mantém a exceção
 *     dentro do escopo do try, ao contrário do antigo `forEach(async ...)`.
 *
 * As dependências pesadas (baileys/ESM via wbotMessageListener, socket, wbot e models)
 * são mockadas — mesmo padrão de enviarMensagemParaCliente.spec.ts.
 */

jest.mock("../wbotMessageListener", () => ({ verifyMessage: jest.fn() }));
jest.mock("../../../libs/wbot", () => ({}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../../models/Ticket");
jest.mock("../../../models/Whatsapp");
jest.mock("../../../models/TicketTraking");
jest.mock("../SendWhatsAppMessage");
jest.mock("../../TicketServices/ShowTicketService");
jest.mock("../../../helpers/Mustache", () => jest.fn(() => "corpo"));
jest.mock("../../../utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import { ClosedAllOpenTickets } from "../wbotClosedTickets";
import Ticket from "../../../models/Ticket";
import Whatsapp from "../../../models/Whatsapp";
import TicketTraking from "../../../models/TicketTraking";
import ShowTicketService from "../../TicketServices/ShowTicketService";
import { logger } from "../../../utils/logger";

const mockTicketFindAll = Ticket.findAndCountAll as jest.Mock;
const mockWhatsappFindByPk = Whatsapp.findByPk as jest.Mock;
const mockTrakingFindOne = TicketTraking.findOne as jest.Mock;
const mockShowTicket = ShowTicketService as unknown as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;
const mockLoggerError = logger.error as jest.Mock;

const companyId = 1;

describe("ClosedAllOpenTickets", () => {
  beforeEach(() => jest.clearAllMocks());

  it("quando ticketTraking é null: não lança, loga warn e continua (sem TypeError)", async () => {
    mockTicketFindAll.mockResolvedValue({ rows: [{ id: 10 }] });
    mockShowTicket.mockResolvedValue({
      id: 10,
      whatsappId: 2,
      status: "open",
      isGroup: false,
      fromMe: true,
      // updatedAt bem no passado para satisfazer o gate de inatividade, provando
      // que sem a guarda o ticketTraking.update seria alcançado e lançaria.
      updatedAt: new Date("2000-01-01T00:00:00Z"),
      contact: { name: "Cliente" }
    });
    mockWhatsappFindByPk.mockResolvedValue({
      expiresTicket: "60",
      expiresInactiveMessage: ""
    });
    mockTrakingFindOne.mockResolvedValue(null);

    await expect(ClosedAllOpenTickets(companyId)).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn.mock.calls[0][0]).toMatch(/TicketTraking/i);
    // Como não houve exceção, o catch de erro NÃO deve ter sido acionado.
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("um ticket que lança NÃO aborta o lote: erro é logado e o próximo ticket ainda é processado", async () => {
    mockTicketFindAll.mockResolvedValue({ rows: [{ id: 20 }, { id: 21 }] });
    // Ticket 20 falha no ShowTicket; ticket 21 processa normal. Com o antigo
    // `forEach(async ...)` a rejeição do 20 escaparia (unhandled rejection); com o
    // try/catch POR-TICKET, o 20 é logado e o 21 SEGUE sendo processado.
    mockShowTicket.mockImplementation((id: number) => {
      if (id === 20) return Promise.reject(new Error("falha no ShowTicket"));
      return Promise.resolve({
        id: 21, whatsappId: 2, status: "open", isGroup: false, fromMe: true,
        updatedAt: new Date(), contact: { name: "Cliente" }
      });
    });
    mockWhatsappFindByPk.mockResolvedValue({ expiresTicket: "0", expiresInactiveMessage: "" });
    mockTrakingFindOne.mockResolvedValue({ update: jest.fn() });

    await expect(ClosedAllOpenTickets(companyId)).resolves.toBeUndefined();

    // O erro do ticket 20 foi logado (não virou unhandled rejection)...
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0][0]).toMatch(/falha no ShowTicket/);
    // ...E o ticket 21 ainda foi processado (o lote não abortou no erro do 20).
    expect(mockShowTicket).toHaveBeenCalledWith(21, companyId);
  });

  it("caminho feliz sem expiração configurada: não fecha nada e não loga erro/warn", async () => {
    mockTicketFindAll.mockResolvedValue({ rows: [{ id: 30 }] });
    mockShowTicket.mockResolvedValue({
      id: 30,
      whatsappId: 2,
      status: "open",
      isGroup: false,
      fromMe: true,
      updatedAt: new Date(),
      contact: { name: "Cliente" }
    });
    // expiresTicket "0" → gate de expiração não entra; ticketTraking presente.
    mockWhatsappFindByPk.mockResolvedValue({
      expiresTicket: "0",
      expiresInactiveMessage: ""
    });
    mockTrakingFindOne.mockResolvedValue({ update: jest.fn() });

    await expect(ClosedAllOpenTickets(companyId)).resolves.toBeUndefined();

    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});
