/**
 * Testes TDD para consultar_contatos (Secretária) — acesso à lista de contatos do CRM.
 * Reusa a busca do Agente; aqui garantimos delegação, multi-resultado (desambiguação)
 * e zero-resultado.
 */

jest.mock("../../../../models/Contact");

import Contact from "../../../../models/Contact";
import { consultarContatos } from "../consultarContatos";

const mockFindAll = Contact.findAll as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("consultarContatos", () => {
  it("retorna VÁRIOS contatos quando há ambiguidade (ex: 3 Amandas)", async () => {
    mockFindAll.mockResolvedValue([
      { id: 1, name: "Amanda G", number: "5548999990001", createdAt: new Date("2026-01-10") },
      { id: 2, name: "Amanda Silva", number: "5548999990002", createdAt: new Date("2026-02-20") },
      { id: 3, name: "Amanda Souza", number: "5548999990003", createdAt: new Date("2026-03-05") }
    ]);

    const r: any = await consultarContatos({ nome_ou_numero: "Amanda" }, 2);

    expect(r.encontrados).toHaveLength(3);
    expect(r.encontrados.map((c: any) => c.nome)).toContain("Amanda G");
    // multi-tenant: a busca foi escopada por companyId
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 2 }) })
    );
  });

  it("retorna lista vazia + mensagem quando não encontra", async () => {
    mockFindAll.mockResolvedValue([]);

    const r: any = await consultarContatos({ nome_ou_numero: "Inexistente" }, 2);

    expect(r.encontrados).toHaveLength(0);
    expect(r.mensagem).toMatch(/nenhum contato/i);
  });

  it("retorna o contato único quando há só um match", async () => {
    mockFindAll.mockResolvedValue([
      { id: 7, name: "Amanda G", number: "5548999990001", createdAt: new Date("2026-01-10") }
    ]);

    const r: any = await consultarContatos({ nome_ou_numero: "Amanda G" }, 2);

    expect(r.encontrados).toHaveLength(1);
    expect(r.encontrados[0].id).toBe(7);
  });
});
