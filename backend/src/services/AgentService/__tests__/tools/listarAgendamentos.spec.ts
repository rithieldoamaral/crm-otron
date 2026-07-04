/**
 * Testes TDD para a tool listarAgendamentos.
 */

jest.mock("../../../../models/Schedule");

import { listarAgendamentos } from "../../tools/listarAgendamentos";
import Schedule from "../../../../models/Schedule";

describe("listarAgendamentos", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna lista formatada de agendamentos para a data", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([
      {
        id: 1,
        body: "Banho e tosa - Rex",
        sendAt: new Date("2026-04-20T09:00:00"),
        status: "PENDENTE",
        Contact: { name: "Maria Silva", number: "5511999991111" }
      },
      {
        id: 2,
        body: "Consulta - Luna",
        sendAt: new Date("2026-04-20T14:30:00"),
        status: "PENDENTE",
        Contact: { name: "João Costa", number: "5511988887777" }
      }
    ]);

    const result = await listarAgendamentos({ data: "2026-04-20" }, companyId);

    expect(result.agendamentos).toHaveLength(2);
    expect(result.agendamentos[0].cliente).toBe("Maria Silva");
    expect(result.agendamentos[0].servico).toBe("Banho e tosa - Rex");
    expect(result.total).toBe(2);
  });

  it("retorna lista vazia quando não há agendamentos na data", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([]);

    const result = await listarAgendamentos({ data: "2026-04-20" }, companyId);

    expect(result.agendamentos).toHaveLength(0);
    expect(result.mensagem).toMatch(/nenhum agendamento/i);
  });

  it("retorna erro descritivo quando a consulta falha", async () => {
    (Schedule.findAll as jest.Mock).mockRejectedValue(new Error("DB error"));

    const result = await listarAgendamentos({ data: "2026-04-20" }, companyId);

    expect(result.erro).toBeDefined();
  });
});
