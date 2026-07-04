/**
 * Testes TDD para a tool consultarAgendamentos.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/Contact");

import { consultarAgendamentos } from "../../tools/consultarAgendamentos";
import Schedule from "../../../../models/Schedule";

describe("consultarAgendamentos", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna agendamentos do dia quando nenhuma data é informada", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([
      {
        id: 1,
        body: "Banho e tosa",
        sendAt: new Date("2026-04-21T10:00:00"),
        status: "PENDENTE",
        contact: { name: "Rex Owner", number: "5511999990001" }
      },
      {
        id: 2,
        body: "Consulta veterinária",
        sendAt: new Date("2026-04-21T14:00:00"),
        status: "PENDENTE",
        contact: { name: "Bolinha Owner", number: "5511999990002" }
      }
    ]);

    const result = await consultarAgendamentos({}, companyId);

    expect(Schedule.findAll).toHaveBeenCalledTimes(1);
    expect(result.agendamentos).toHaveLength(2);
    expect(result.agendamentos[0]).toMatchObject({ id: 1, servico: "Banho e tosa" });
    expect(result.total).toBe(2);
  });

  it("filtra por data específica quando informada", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([
      {
        id: 3,
        body: "Tosa",
        sendAt: new Date("2026-04-25T09:00:00"),
        status: "PENDENTE",
        contact: { name: "Fido Owner", number: "5511999990003" }
      }
    ]);

    const result = await consultarAgendamentos({ data: "2026-04-25" }, companyId);

    const callArgs = (Schedule.findAll as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toBeDefined();
    expect(result.agendamentos).toHaveLength(1);
    expect(result.agendamentos[0].id).toBe(3);
  });

  it("retorna lista vazia quando não há agendamentos no dia", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([]);

    const result = await consultarAgendamentos({}, companyId);

    expect(result.agendamentos).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("inclui o nome do cliente em cada agendamento", async () => {
    (Schedule.findAll as jest.Mock).mockResolvedValue([
      {
        id: 7,
        body: "Corte",
        sendAt: new Date(),
        status: "PENDENTE",
        contact: { name: "Tutora Ana", number: "5511999990004" }
      }
    ]);

    const result = await consultarAgendamentos({}, companyId);

    expect(result.agendamentos[0].cliente).toBe("Tutora Ana");
  });

  // ── Validação de formato (defesa contra alucinação do LLM) ────────────────

  describe("validação de data", () => {
    it.each([
      ["amanhã"],     // linguagem natural
      ["25/04/2026"], // formato brasileiro
      ["2026/04/25"], // separador errado
      ["abc"],        // texto livre
      ["2026-13-32"], // mês/dia fora do range
    ])('rejeita data inválida "%s" sem chamar Schedule.findAll', async (data) => {
      const result = await consultarAgendamentos({ data }, companyId);

      expect(result.agendamentos).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.erro).toMatch(/data|YYYY-MM-DD|inv[áa]lid/i);
      expect(Schedule.findAll).not.toHaveBeenCalled();
    });

    it("rejeita data calendaricamente impossível (2026-02-30)", async () => {
      const result = await consultarAgendamentos({ data: "2026-02-30" }, companyId);

      expect(result.erro).toBeDefined();
      expect(Schedule.findAll).not.toHaveBeenCalled();
    });

    it("aceita data válida e chama Schedule.findAll normalmente", async () => {
      (Schedule.findAll as jest.Mock).mockResolvedValue([]);

      const result = await consultarAgendamentos({ data: "2026-04-25" }, companyId);

      expect(result.erro).toBeUndefined();
      expect(Schedule.findAll).toHaveBeenCalledTimes(1);
    });
  });
});
