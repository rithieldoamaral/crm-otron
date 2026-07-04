/**
 * Testes TDD para listarPacotes.
 *
 * A tool retorna pacotes ativos da empresa com informações do serviço vinculado,
 * para que o agente possa apresentá-los ao cliente como opções de vantagem
 * (ex: desconto vs sessões avulsas).
 *
 * Por que existe: a tool listar_servicos retorna apenas serviços avulsos.
 * Clientes que pediam "Depilação a Laser" recebiam "Esse serviço não está
 * disponível" porque o serviço só existia como pacote — o agente não tinha
 * visibilidade dos pacotes cadastrados.
 */

jest.mock("../../../../models/Package");
jest.mock("../../../../models/Service");

import { listarPacotes } from "../../tools/listarPacotes";
import Package from "../../../../models/Package";

const mockFindAll = Package.findAll as jest.Mock;

describe("listarPacotes", () => {
  const companyId = 2;

  beforeEach(() => jest.clearAllMocks());

  it("retorna lista de pacotes ativos com nome do serviço vinculado", async () => {
    mockFindAll.mockResolvedValue([
      {
        id: 1,
        name: "Pacote Laser 10 sessões",
        totalSessions: 10,
        totalPrice: "350.00",
        description: "10 sessões de depilação laser",
        service: { name: "Depilação a Laser", price: "50.00" }
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes).toHaveLength(1);
    expect(result.pacotes[0].id).toBe(1);
    expect(result.pacotes[0].nome).toBe("Pacote Laser 10 sessões");
    expect(result.pacotes[0].servico).toBe("Depilação a Laser");
    expect(result.pacotes[0].sessoes).toBe(10);
    expect(result.pacotes[0].preco).toBe(350);
    expect(result.pacotes[0].descricao).toBe("10 sessões de depilação laser");
    expect(result.total).toBe(1);
  });

  it("retorna lista vazia quando não há pacotes ativos", async () => {
    mockFindAll.mockResolvedValue([]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("calcula descontoPercent quando serviço tem preço avulso cadastrado", async () => {
    // Preço avulso total: 10 × R$50 = R$500. Pacote: R$350. Desconto: 30%.
    mockFindAll.mockResolvedValue([
      {
        id: 1,
        name: "Pacote Laser",
        totalSessions: 10,
        totalPrice: "350.00",
        description: null,
        service: { name: "Depilação a Laser", price: "50.00" }
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes[0].descontoPercent).toBe(30);
  });

  it("retorna descontoPercent null quando preço do pacote >= preço avulso total", async () => {
    // Sem desconto — pacote mais caro ou igual
    mockFindAll.mockResolvedValue([
      {
        id: 1,
        name: "Pacote Sem Desconto",
        totalSessions: 5,
        totalPrice: "500.00",
        description: null,
        service: { name: "Serviço Caro", price: "50.00" } // avulso total = 250 < 500
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes[0].descontoPercent).toBeNull();
  });

  it("retorna descontoPercent null quando serviço não tem preço cadastrado", async () => {
    mockFindAll.mockResolvedValue([
      {
        id: 1,
        name: "Pacote Genérico",
        totalSessions: 5,
        totalPrice: "200.00",
        description: null,
        service: { name: "Serviço Sem Preço", price: null }
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes[0].descontoPercent).toBeNull();
  });

  it("retorna servico null quando pacote não tem serviço vinculado (backward compat)", async () => {
    mockFindAll.mockResolvedValue([
      {
        id: 1,
        name: "Pacote Genérico Sem Serviço",
        totalSessions: 5,
        totalPrice: "200.00",
        description: null,
        service: null
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes[0].servico).toBeNull();
    expect(result.pacotes[0].descontoPercent).toBeNull();
  });

  it("retorna múltiplos pacotes ordenados por nome", async () => {
    mockFindAll.mockResolvedValue([
      {
        id: 2,
        name: "Pacote B",
        totalSessions: 5,
        totalPrice: "150.00",
        description: null,
        service: { name: "Serviço B", price: "40.00" }
      },
      {
        id: 1,
        name: "Pacote A",
        totalSessions: 10,
        totalPrice: "300.00",
        description: "Desc A",
        service: { name: "Serviço A", price: "40.00" }
      }
    ]);

    const result = await listarPacotes({}, companyId);

    expect(result.pacotes).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.pacotes[0].nome).toBe("Pacote B");
    expect(result.pacotes[1].nome).toBe("Pacote A");
  });
});
