/**
 * Testes TDD para a tool buscarTicket.
 */

jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Contact");

import { buscarTicket } from "../../tools/buscarTicket";
import Ticket from "../../../../models/Ticket";
import Contact from "../../../../models/Contact";

describe("buscarTicket", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("encontra ticket pelo nome do contato", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([
      {
        id: 42,
        status: "open",
        contact: { id: 10, name: "Maria Silva", number: "5511999990001" },
        queue: { name: "Agente IA" },
        whatsappId: 2
      }
    ]);

    const result = await buscarTicket({ query: "Maria Silva" }, companyId);

    expect(result.encontrado).toBe(true);
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({ id: 42, cliente: "Maria Silva" });
  });

  it("retorna múltiplos tickets quando há mais de um match", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([
      { id: 10, status: "open", contact: { id: 1, name: "João Mendes", number: "5511111110001" }, queue: null, whatsappId: 2 },
      { id: 11, status: "pending", contact: { id: 2, name: "João Carlos", number: "5511111110002" }, queue: null, whatsappId: 2 }
    ]);

    const result = await buscarTicket({ query: "João" }, companyId);

    expect(result.encontrado).toBe(true);
    expect(result.tickets).toHaveLength(2);
  });

  it("retorna encontrado:false quando nenhum ticket é encontrado", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([]);

    const result = await buscarTicket({ query: "XYZ inexistente" }, companyId);

    expect(result.encontrado).toBe(false);
    expect(result.tickets).toHaveLength(0);
    expect(result.mensagem).toMatch(/não encontrado/i);
  });

  it("busca por número de telefone quando query parece um número", async () => {
    (Ticket.findAll as jest.Mock).mockResolvedValue([
      { id: 55, status: "open", contact: { id: 7, name: "Pedro", number: "5511988887777" }, queue: null, whatsappId: 2 }
    ]);

    const result = await buscarTicket({ query: "5511988887777" }, companyId);

    expect(result.encontrado).toBe(true);
    expect(result.tickets[0].contato.numero).toBe("5511988887777");
  });
});
