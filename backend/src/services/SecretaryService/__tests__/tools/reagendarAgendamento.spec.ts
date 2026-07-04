/**
 * Testes TDD para reagendarAgendamento (ferramenta do admin).
 *
 * Delega a lógica de atomicidade ao reagendarEvento do GoogleCalendarService
 * (já testado, já lida com create-new → delete-old → update-DB).
 * Esta tool é a interface de entrada do admin: valida args e passa o resultado.
 */

jest.mock("../../../GoogleCalendarService/tools/reagendarEvento");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { reagendarAgendamento } from "../../tools/reagendarAgendamento";
import { reagendarEvento } from "../../../GoogleCalendarService/tools/reagendarEvento";

const mockReagendar = reagendarEvento as jest.Mock;

describe("reagendarAgendamento", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna sucesso quando reagendarEvento conclui com sucesso", async () => {
    mockReagendar.mockResolvedValue({
      sucesso: true,
      mensagem: "✅ Reagendado para 2026-06-10 às 14:00.",
      linkCalendario: "https://calendar.google.com/calendar/render?action=TEMPLATE"
    });

    const result = await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00" },
      companyId
    );

    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/reagendado|2026-06-10|14:00/i);
  });

  it("repassa erro quando reagendarEvento falha (ex.: Google API timeout)", async () => {
    mockReagendar.mockResolvedValue({
      sucesso: false,
      erro: "Google API timeout"
    });

    const result = await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/Google API timeout|falha|erro/i);
  });

  it("passa scheduleId, novaData e novaHora corretamente para reagendarEvento", async () => {
    mockReagendar.mockResolvedValue({ sucesso: true, mensagem: "ok" });

    await reagendarAgendamento(
      { scheduleId: 77, novaData: "2026-07-20", novaHora: "09:30" },
      companyId
    );

    expect(mockReagendar).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 77,
        novaData: "2026-07-20",
        novaHora: "09:30"
      }),
      companyId
    );
  });

  it("passa novoAtendenteId quando fornecido (troca de profissional)", async () => {
    mockReagendar.mockResolvedValue({ sucesso: true, mensagem: "ok" });

    await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00", novoAtendenteId: 8 },
      companyId
    );

    expect(mockReagendar).toHaveBeenCalledWith(
      expect.objectContaining({ novoAtendenteId: 8 }),
      companyId
    );
  });

  it("não passa novoAtendenteId quando não fornecido", async () => {
    mockReagendar.mockResolvedValue({ sucesso: true, mensagem: "ok" });

    await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00" },
      companyId
    );

    const callArgs = mockReagendar.mock.calls[0][0];
    expect(callArgs.novoAtendenteId).toBeUndefined();
  });

  it("repassa aviso quando delete do evento antigo falhou mas novo foi criado", async () => {
    mockReagendar.mockResolvedValue({
      sucesso: true,
      mensagem: "✅ Reagendado.",
      aviso: "Novo horário criado, mas evento antigo pode ter ficado na agenda do profissional."
    });

    const result = await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00" },
      companyId
    );

    expect(result.sucesso).toBe(true);
    expect(result.aviso).toBeDefined();
    expect(result.aviso).toMatch(/agenda|antigo|profissional/i);
  });

  it("usa companyId correto na chamada ao reagendarEvento", async () => {
    mockReagendar.mockResolvedValue({ sucesso: true, mensagem: "ok" });

    await reagendarAgendamento(
      { scheduleId: 42, novaData: "2026-06-10", novaHora: "14:00" },
      55 // companyId específico
    );

    expect(mockReagendar).toHaveBeenCalledWith(expect.anything(), 55);
  });

  // ── Validação de formato (defesa contra alucinação do LLM) ───────────────

  describe("validação de formato", () => {
    it.each([
      ["10/06/2026"], // formato brasileiro
      ["2026/06/10"], // separador errado
      ["26-06-10"],   // ano com 2 dígitos
      ["2026-6-10"],  // sem zero à esquerda
      ["amanhã"],     // texto natural
      [""],           // vazio
    ])('rejeita data inválida "%s" sem chamar reagendarEvento', async (novaData) => {
      const result = await reagendarAgendamento(
        { scheduleId: 42, novaData, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/data|YYYY-MM-DD/i);
      expect(mockReagendar).not.toHaveBeenCalled();
    });

    it.each([
      ["25:99"], // hora/min fora do range
      ["24:00"], // hora inválida (00-23)
      ["14:60"], // minuto inválido (00-59)
      ["1:00"],  // sem zero à esquerda
      ["14h00"], // separador errado
      [""],      // vazio
    ])('rejeita hora inválida "%s" sem chamar reagendarEvento', async (novaHora) => {
      const result = await reagendarAgendamento(
        { scheduleId: 42, novaData: "2026-06-10", novaHora },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/hor[áa]rio|HH:MM/i);
      expect(mockReagendar).not.toHaveBeenCalled();
    });

    it("rejeita data calendaricamente impossível (2026-02-30)", async () => {
      const result = await reagendarAgendamento(
        { scheduleId: 42, novaData: "2026-02-30", novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/inv[áa]lid/i);
      expect(mockReagendar).not.toHaveBeenCalled();
    });
  });
});
