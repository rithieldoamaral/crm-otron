/**
 * Testes TDD para verificarDisponibilidade.
 * Mock da calendarApi — testa apenas a lógica de disponibilidade por profissional.
 */

jest.mock("../../../../models/Service");
jest.mock("../../../../models/ServiceProfessional");
jest.mock("../../../../models/UserCalendar");
jest.mock("../../../../models/UserWorkingHours");
jest.mock("../../calendarApi");

import { verificarDisponibilidade } from "../../tools/verificarDisponibilidade";
import Service from "../../../../models/Service";
import ServiceProfessional from "../../../../models/ServiceProfessional";
import UserCalendar from "../../../../models/UserCalendar";
import UserWorkingHours from "../../../../models/UserWorkingHours";
import { getBusyPeriods } from "../../calendarApi";

const mockGetBusy = getBusyPeriods as jest.Mock;

/**
 * Retorna a ISO date (YYYY-MM-DD) da próxima segunda-feira a partir de hoje.
 * Garante que os testes que dependem de workingHours com dayOfWeek=1 (segunda)
 * nunca usem datas passadas — evita test-rot por datas hardcoded (CLAUDE.md II.1).
 *
 * Mesmo comportamento de `dataFutura()` em criarEvento.spec.ts, mas
 * especificamente uma segunda-feira (dayOfWeek=1) para casar com o mock
 * de UserWorkingHours retornado nos testes abaixo.
 */
function proximaSegunda(): string {
  const now = new Date();
  const nowDay = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  // Se hoje for segunda, próxima segunda é daqui a 7 dias
  const daysUntilMonday = nowDay === 1 ? 7 : (8 - nowDay) % 7;
  const next = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10); // YYYY-MM-DD
}

describe("verificarDisponibilidade", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna slots por profissional para data com vagas disponíveis", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 10, user: { id: 10, name: "Carlos" } },
      { userId: 11, user: { id: 11, name: "Fabio" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "cal@gmail.com", isActive: true });
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true
    });
    mockGetBusy.mockResolvedValue([]);

    // Usa próxima segunda-feira dinâmica (evita test-rot por data hardcoded passada)
    const result = await verificarDisponibilidade(
      { servicoId: 1, data: proximaSegunda() },
      companyId
    );

    expect(result.disponivel).toBe(true);
    expect(result.profissionais).toHaveLength(2);
    expect(result.profissionais[0].nome).toBe("Carlos");
    // Feature UX-1 / Bug #39: a tool devolve contagem + faixa, não a lista de slots.
    expect(result.profissionais[0].horariosDisponiveis).toBeGreaterThan(0);
    expect(result.profissionais[0].rangeFormatado).toMatch(/das \d{2}:\d{2} às \d{2}:\d{2}/);
    // A lista de slots individuais NÃO deve mais ser exposta ao LLM.
    expect((result.profissionais[0] as any).slots).toBeUndefined();
  });

  // CAUSA-RAIZ "não consegui verificar" (2026-06-21): o LLM barato chamava a tool
  // SEM data (ou malformada) → parseLocalDate quebrava → orquestrador devolvia erro
  // genérico → bot dizia "não consegui verificar". Guarda defensiva: nunca lança.
  describe("guarda defensiva de `data` (não quebra mais)", () => {
    it("retorna erro instrutivo (sem lançar) quando data está ausente", async () => {
      const result = await verificarDisponibilidade({ servicoId: 1 } as any, companyId);
      expect(result.disponivel).toBe(false);
      expect(result.erro).toMatch(/data não informada|formato inválido|YYYY-MM-DD/i);
    });

    it("retorna erro instrutivo quando data está malformada ('sexta')", async () => {
      const result = await verificarDisponibilidade({ servicoId: 1, data: "sexta" } as any, companyId);
      expect(result.disponivel).toBe(false);
      expect(result.erro).toMatch(/data não informada|formato inválido|YYYY-MM-DD/i);
      // Não deve nem tentar buscar o serviço (curto-circuito antes do parse).
      expect(Service.findOne as jest.Mock).not.toHaveBeenCalled();
    });
  });

  it("retorna disponivel:false quando serviço não existe", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue(null);

    const result = await verificarDisponibilidade({ servicoId: 999, data: proximaSegunda() }, companyId);

    expect(result.disponivel).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });

  it("exclui profissional sem calendário conectado", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 10, user: { id: 10, name: "Carlos" } },
      { userId: 11, user: { id: 11, name: "Fabio" } }
    ]);
    // Carlos tem calendário, Fabio não
    (UserCalendar.findOne as jest.Mock)
      .mockResolvedValueOnce({ calendarId: "carlos@gmail.com", isActive: true })
      .mockResolvedValueOnce(null);
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true
    });
    mockGetBusy.mockResolvedValue([]);

    const result = await verificarDisponibilidade({ servicoId: 1, data: proximaSegunda() }, companyId);

    expect(result.profissionais).toHaveLength(1);
    expect(result.profissionais[0].nome).toBe("Carlos");
  });

  it("retorna profissional sem slots quando agenda está totalmente ocupada", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 60 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 10, user: { id: 10, name: "Carlos" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "carlos@gmail.com", isActive: true });
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true
    });
    // Dia inteiro ocupado
    mockGetBusy.mockResolvedValue([{ start: "09:00", end: "17:00" }]);

    const result = await verificarDisponibilidade({ servicoId: 1, data: proximaSegunda() }, companyId);

    expect(result.profissionais[0].horariosDisponiveis).toBe(0);
    expect(result.profissionais[0].rangeFormatado).toBe("");
    expect(result.disponivel).toBe(false);
  });

  // Regressão Bug #10: em BRT (UTC-3), `new Date("2026-04-27")` é interpretado
  // como UTC midnight, virando 21h de DOMINGO no fuso local. Aí `getDay()`
  // retornava 0 (domingo) em vez de 1 (segunda) — a tool consultava o
  // expediente do domingo e dizia que Sofia não trabalha. Tool retornava
  // slots vazios para um dia em que de fato havia agenda livre.
  // Fix: parsear "YYYY-MM-DD" como data de calendário local, via
  // new Date(y, m-1, d), que é TZ-independente para weekday.
  it("interpreta data como calendário local para dia da semana (bug #10)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Reparo", durationMinutes: 60 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 2, user: { id: 2, name: "Sofia" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "sofia@gmail.com", isActive: true });
    const findHoursSpy = UserWorkingHours.findOne as jest.Mock;
    findHoursSpy.mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true
    });
    mockGetBusy.mockResolvedValue([]);

    // 2026-04-27 é uma SEGUNDA-feira no calendário (sem ambiguidade de TZ).
    await verificarDisponibilidade({ servicoId: 1, data: "2026-04-27" }, companyId);

    // Independente do fuso da máquina, a consulta deve usar dayOfWeek=1 (segunda).
    // Em BRT, a versão buggy chamava com dayOfWeek=0 (domingo) — este teste falha.
    expect(findHoursSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dayOfWeek: 1 })
      })
    );
  });

  it("interpreta diferentes datas de calendário com weekday correto (bug #10)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "X", durationMinutes: 60 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 1, user: { id: 1, name: "Pro" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "x@x", isActive: true });
    const findHoursSpy = UserWorkingHours.findOne as jest.Mock;
    findHoursSpy.mockResolvedValue({
      dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isWorking: false
    });
    mockGetBusy.mockResolvedValue([]);

    // 2026-04-26 é DOMINGO no calendário.
    await verificarDisponibilidade({ servicoId: 1, data: "2026-04-26" }, companyId);

    expect(findHoursSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dayOfWeek: 0 })
      })
    );
  });

  // ─── dataFormatada (Problema dia da semana, 2026-06-20) ─────────────────────
  it("devolve dataFormatada com o dia da semana por extenso", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 10, user: { id: 10, name: "Amanda" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "a@a", isActive: true });
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true
    });
    mockGetBusy.mockResolvedValue([]);

    // 2026-06-22 é segunda-feira
    const result = await verificarDisponibilidade({ servicoId: 1, data: "2026-06-22" }, companyId);

    expect(result.dataFormatada).toBe("segunda-feira, 22/06/2026");
  });

  // ─── Bug #B1: horário específico responde deterministicamente ───────────────
  describe("Bug #B1 — consulta de horário específico (arg `hora`)", () => {
    function mockDiaLivre(durationMinutes = 30) {
      (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes });
      (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
        { userId: 10, user: { id: 10, name: "Amanda" } }
      ]);
      (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "a@a", isActive: true });
      (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
        dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true
      });
    }

    it("responde horaConsultadaDisponivel=true quando o horário está livre", async () => {
      mockDiaLivre(30);
      mockGetBusy.mockResolvedValue([]); // agenda vazia → 11:00 livre

      const result = await verificarDisponibilidade(
        { servicoId: 1, data: proximaSegunda(), hora: "11:00" },
        companyId
      );

      expect(result.horaConsultada).toBe("11:00");
      expect(result.horaConsultadaDisponivel).toBe(true);
      expect(result.profissionais[0].horaDisponivel).toBe(true);
    });

    it("responde horaConsultadaDisponivel=false quando o horário está ocupado", async () => {
      mockDiaLivre(60);
      // 11:00 ocupado
      mockGetBusy.mockResolvedValue([{ start: "11:00", end: "12:00" }]);

      const result = await verificarDisponibilidade(
        { servicoId: 1, data: proximaSegunda(), hora: "11:00" },
        companyId
      );

      expect(result.horaConsultadaDisponivel).toBe(false);
      expect(result.profissionais[0].horaDisponivel).toBe(false);
      // Mas ainda oferece a faixa para reofertar (não fica "sem resposta")
      expect(result.profissionais[0].rangeFormatado).toMatch(/das \d{2}:\d{2} às \d{2}:\d{2}/);
    });

    it("normaliza '11h' / '9:00' para HH:MM antes de checar", async () => {
      mockDiaLivre(30);
      mockGetBusy.mockResolvedValue([]);

      const r1 = await verificarDisponibilidade(
        { servicoId: 1, data: proximaSegunda(), hora: "11h" },
        companyId
      );
      expect(r1.horaConsultada).toBe("11:00");
      expect(r1.horaConsultadaDisponivel).toBe(true);
    });

    it("NÃO inclui os campos de hora quando `hora` não é informado", async () => {
      mockDiaLivre(30);
      mockGetBusy.mockResolvedValue([]);

      const result = await verificarDisponibilidade(
        { servicoId: 1, data: proximaSegunda() },
        companyId
      );

      expect(result.horaConsultada).toBeUndefined();
      expect(result.horaConsultadaDisponivel).toBeUndefined();
      expect(result.profissionais[0].horaDisponivel).toBeUndefined();
    });
  });
});
