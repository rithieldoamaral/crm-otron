/**
 * Testes TDD para a tool buscarContato.
 */

jest.mock("../../../../models/Contact");

import { buscarContato } from "../../tools/buscarContato";
import Contact from "../../../../models/Contact";

const MockContact = Contact as jest.Mocked<typeof Contact>;

describe("buscarContato", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("encontra contato por nome parcial (case-insensitive)", async () => {
    (MockContact.findAll as jest.Mock).mockResolvedValue([
      {
        id: 10,
        name: "Maria Silva",
        number: "5511999991111",
        createdAt: new Date("2026-01-01")
      }
    ]);

    const result = await buscarContato({ nome_ou_numero: "maria" }, companyId);

    expect(result.encontrados).toHaveLength(1);
    expect(result.encontrados[0].nome).toBe("Maria Silva");
    expect(result.encontrados[0].numero).toBe("5511999991111");
  });

  it("encontra contato por número", async () => {
    (MockContact.findAll as jest.Mock).mockResolvedValue([
      {
        id: 11,
        name: "João",
        number: "5511988887777",
        createdAt: new Date("2026-01-15")
      }
    ]);

    const result = await buscarContato(
      { nome_ou_numero: "5511988887777" },
      companyId
    );

    expect(result.encontrados[0].numero).toBe("5511988887777");
  });

  it("retorna lista vazia quando não encontra nenhum contato", async () => {
    (MockContact.findAll as jest.Mock).mockResolvedValue([]);

    const result = await buscarContato(
      { nome_ou_numero: "XYZ inexistente" },
      companyId
    );

    expect(result.encontrados).toHaveLength(0);
    expect(result.mensagem).toMatch(/nenhum contato encontrado/i);
  });

  it("retorna erro descritivo quando a busca falha", async () => {
    (MockContact.findAll as jest.Mock).mockRejectedValue(
      new Error("DB error")
    );

    const result = await buscarContato({ nome_ou_numero: "João" }, companyId);

    expect(result.erro).toBeDefined();
  });
});
