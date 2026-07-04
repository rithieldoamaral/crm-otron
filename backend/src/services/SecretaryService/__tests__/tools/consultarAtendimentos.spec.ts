/**
 * Testes TDD para a tool consultarAtendimentos.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Queue");

import { consultarAtendimentos } from "../../tools/consultarAtendimentos";
import Ticket from "../../../../models/Ticket";

describe("consultarAtendimentos", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna lista de tickets quando há atendimentos abertos", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([
      { id: 1, status: "open", contact: { name: "João Silva", number: "5511999990001" }, queue: { name: "Agente IA" }, lastMessage: "Olá" },
      { id: 2, status: "open", contact: { name: "Maria Costa", number: "5511999990002" }, queue: { name: "Suporte" }, lastMessage: "Preciso de ajuda" }
    ]);

    const result = await consultarAtendimentos({ status: "open" }, companyId);

    expect(Ticket.findAll).toHaveBeenCalledTimes(1);
    expect(result.atendimentos).toHaveLength(2);
    expect(result.atendimentos[0]).toMatchObject({ id: 1, cliente: "João Silva" });
    expect(result.total).toBe(2);
  });

  it("filtra por fila quando filaId é fornecido", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([
      { id: 5, status: "pending", contact: { name: "Ana", number: "5511999990003" }, queue: { name: "Suporte" }, lastMessage: "" }
    ]);

    const result = await consultarAtendimentos({ status: "pending", filaId: 3 }, companyId);

    const callArgs = (Ticket.findAll as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ queueId: 3 });
    expect(result.atendimentos).toHaveLength(1);
  });

  it("retorna lista vazia quando não há atendimentos", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([]);

    const result = await consultarAtendimentos({ status: "open" }, companyId);

    expect(result.atendimentos).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("usa status 'open' como padrão quando não informado", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([]);

    await consultarAtendimentos({}, companyId);

    const callArgs = (Ticket.findAll as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ status: "open" });
  });
});
