/**
 * Testes TDD para reagendarEvento.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/Service");
jest.mock("../../../../models/ServiceProfessional");
jest.mock("../../../../models/User");
jest.mock("../../../../models/UserCalendar");
jest.mock("../../../../models/UserWorkingHours");
// executeWithCalendarErrorHandling: pass-through real (repropaga rejeições).
// Ver verificarDisponibilidade.spec.ts.
jest.mock("../../calendarApi", () => ({
  __esModule: true,
  getBusyPeriods: jest.fn(),
  createCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  isCalendarConnectionInvalid: jest.fn(() => false),
  executeWithCalendarErrorHandling: jest.fn((fn: () => Promise<any>) => fn())
}));
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { reagendarEvento } from "../../tools/reagendarEvento";
import Schedule from "../../../../models/Schedule";
import ServiceProfessional from "../../../../models/ServiceProfessional";
import User from "../../../../models/User";
import UserCalendar from "../../../../models/UserCalendar";
import UserWorkingHours from "../../../../models/UserWorkingHours";
import { deleteCalendarEvent, createCalendarEvent, getBusyPeriods } from "../../calendarApi";

const mockDelete = deleteCalendarEvent as jest.Mock;
const mockCreate = createCalendarEvent as jest.Mock;
const mockGetBusyPeriods = getBusyPeriods as jest.Mock;

// Data futura estável — nunca vai "passar" nem ser filtrada pelo now-filter do
// availabilityEngine (Bug #41). dayOfWeek é irrelevante porque UserWorkingHours
// é mockado para sempre devolver um dia útil.
const FUTURA_DATA = "2099-06-15";

describe("reagendarEvento", () => {
  const companyId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
    // Bug #41: reagendar_evento agora valida disponibilidade do NOVO horário.
    // Defaults = profissional trabalha 09:00–18:00 e agenda livre, então os
    // horários dos testes (09:00/10:00/14:00) são válidos. Testes que precisam
    // de outro comportamento sobrescrevem estes mocks.
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true
    });
    mockGetBusyPeriods.mockResolvedValue([]);
    // Por padrão, qualquer profissional realiza o serviço (vínculo existe).
    // Só é consultado quando há troca de profissional (novoAtendenteId).
    (ServiceProfessional.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 99, name: "Bruno" });
  });

  it("remove evento antigo, cria novo e atualiza Schedule", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000) });
    mockDelete.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: "evt_new" });

    const result = await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
      companyId
    );

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      googleEventId: "evt_new",
      sendAt: expect.any(Date)
    }));
    expect(result.sucesso).toBe(true);
    expect(result.mensagem).toMatch(/remarcado|reagendado/i);
  });

  it("retorna erro quando agendamento não é encontrado", async () => {
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);

    const result = await reagendarEvento(
      { scheduleId: 999, novaData: FUTURA_DATA, novaHora: "14:00" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não encontrado/i);
  });

  // Bug #16 (Round 5): atomicidade de reagendar.
  // Implementação anterior fazia delete-old → create-new → update. Se Google
  // Calendar caísse entre delete e create, cliente ficava SEM agendamento
  // (sintoma: "não temos registro do seu horário, sumiu da agenda"). Pior
  // que deixar o antigo: o novo nunca foi criado e o antigo já se foi.
  // Fix: ordem invertida — create-new ANTES de delete-old. Se create falhar,
  // antigo permanece intacto (rollback implícito). Se delete-old falhar
  // depois, o novo já está OK e o cliente está atendido (logamos warning
  // pois fica evento órfão na agenda do profissional, mas isso é menos
  // grave que perder o agendamento).
  it("cria novo evento ANTES de deletar o antigo (atomicidade — bug #16)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });

    const callOrder: string[] = [];
    mockCreate.mockImplementation(async () => {
      callOrder.push("create");
      return { id: "evt_new" };
    });
    mockDelete.mockImplementation(async () => {
      callOrder.push("delete");
    });

    await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
      companyId
    );

    // Ordem CRÍTICA: create primeiro (se falhar, antigo intacto)
    expect(callOrder).toEqual(["create", "delete"]);
  });

  it("não deleta evento antigo se criação do novo falhar — agendamento original permanece (bug #16)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockCreate.mockRejectedValue(new Error("Google API timeout"));

    const result = await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/Google API timeout|falha|erro/i);
    // Antigo NÃO pode ter sido deletado — cliente ainda tem agendamento
    expect(mockDelete).not.toHaveBeenCalled();
    // Schedule também não atualizado — estado consistente
    expect(mockSchedule.update).not.toHaveBeenCalled();
  });

  it("conclui com sucesso mesmo se delete do antigo falhar — novo já está criado (bug #16)", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockCreate.mockResolvedValue({ id: "evt_new" });
    mockDelete.mockRejectedValue(new Error("evento já não existia no Google"));

    const result = await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
      companyId
    );

    // Cliente tem o novo agendamento — não falhar a operação inteira só por
    // delete do antigo ter dado problema. Mas avisar (aviso, não erro).
    expect(result.sucesso).toBe(true);
    expect(result.aviso).toMatch(/agenda|antigo|google|verificar/i);
    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      googleEventId: "evt_new"
    }));
  });

  // Bug #33: após reagendar, o bot não enviava o link do Google Calendar para
  // o cliente adicionar ao próprio calendário. criarEvento já fazia isso via
  // gerarLinkGoogleCalendar — reagendarEvento simplesmente não implementava.
  it("[Bug #33] retorna linkCalendario para o cliente adicionar ao Google Calendar", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Limpeza profunda", durationMinutes: 45 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockDelete.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: "evt_new" });

    const result = await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "09:00" },
      companyId
    );

    expect(result.sucesso).toBe(true);
    // Link deve existir e ser uma URL válida do Google Calendar
    expect(result.linkCalendario).toBeDefined();
    expect(result.linkCalendario).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render/);
    // Link deve conter a data e hora corretas
    expect(result.linkCalendario).toContain("20990615");
    expect(result.linkCalendario).toContain("T090000");
  });

  it("[Bug #33] linkCalendario é retornado mesmo quando delete do evento antigo falha", async () => {
    const mockSchedule = {
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Avaliação", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findOne as jest.Mock).mockResolvedValue(mockSchedule);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    mockCreate.mockResolvedValue({ id: "evt_new" });
    mockDelete.mockRejectedValue(new Error("falha"));

    const result = await reagendarEvento(
      { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "10:00" },
      companyId
    );

    // Mesmo com aviso (delete falhou), link deve estar presente
    expect(result.sucesso).toBe(true);
    expect(result.aviso).toBeDefined();
    expect(result.linkCalendario).toBeDefined();
    expect(result.linkCalendario).toMatch(/^https:\/\/calendar\.google\.com/);
  });

  // ─── Bug #41 (2026-05-31): validação determinística do NOVO horário ──────────
  //
  // reagendar_evento tinha a MESMA lacuna que criar_evento tinha antes do Bug #39:
  // não validava se o novo horário escolhido estava dentro do expediente do
  // profissional e livre na agenda. Com a Feature UX-1, a tool de disponibilidade
  // não devolve mais a lista de slots ao LLM, então esta validação é a única
  // garantia determinística contra remarcar para fora da grade ou sobre um
  // horário já ocupado (double-booking). Espelha os 5 testes do Bug #39.
  describe("Bug #41: valida disponibilidade do novo horário antes de remarcar", () => {
    const baseSchedule = () => ({
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 60 },
      update: jest.fn().mockResolvedValue(undefined)
    });

    beforeEach(() => {
      (Schedule.findOne as jest.Mock).mockResolvedValue(baseSchedule());
      (UserCalendar.findOne as jest.Mock).mockResolvedValue({
        calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
      });
      mockCreate.mockResolvedValue({ id: "evt_new" });
      mockDelete.mockResolvedValue(undefined);
    });

    it("BLOQUEIA remarcação quando o profissional não trabalha no novo dia", async () => {
      (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({ dayOfWeek: 0, isWorking: false });

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/não atende/i);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("BLOQUEIA remarcação em horário fora do expediente (antes da abertura)", async () => {
      // Expediente 09:00–18:00; tenta 08:00 (antes da abertura)
      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "08:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/não está disponível|fora do expediente|ocupado/i);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("BLOQUEIA remarcação sobre um horário já ocupado (anti double-booking)", async () => {
      // 14:00–15:00 está ocupado na agenda do profissional
      mockGetBusyPeriods.mockResolvedValue([{ start: "14:00", end: "15:00" }]);

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/não está disponível|ocupado/i);
      // O erro deve sugerir horários livres (faixa)
      expect(result.erro).toMatch(/\d{2}:\d{2}/);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("PERMITE remarcação em horário válido e livre", async () => {
      mockGetBusyPeriods.mockResolvedValue([]);

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("FAIL-OPEN: se a checagem de agenda do Google falhar, não bloqueia a remarcação", async () => {
      // getBusyPeriods rejeita (erro transitório do Google) → reagendar prossegue
      mockGetBusyPeriods.mockRejectedValue(new Error("Google API timeout"));

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Furos 2 e 3 (2026-06-20): guarda de passado + guarda de status ──────────
  describe("Furo #2: bloqueia remarcação para o passado (paridade com criar Bug #13)", () => {
    beforeEach(() => {
      (Schedule.findOne as jest.Mock).mockResolvedValue({
        id: 42,
        googleEventId: "evt_old",
        professionalId: 10,
        status: "PENDENTE",
        contact: { id: 5, name: "João", number: "5511111111111" },
        service: { name: "Corte", durationMinutes: 30 },
        update: jest.fn().mockResolvedValue(undefined)
      });
      (UserCalendar.findOne as jest.Mock).mockResolvedValue({
        calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
      });
      mockCreate.mockResolvedValue({ id: "evt_new" });
    });

    it("recusa data/hora no passado mesmo no fail-open do Google", async () => {
      // fail-open: a validação de disponibilidade é pulada; a guarda de passado
      // precisa pegar sozinha. Data claramente passada.
      mockGetBusyPeriods.mockRejectedValue(new Error("Google instável"));

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: "2000-01-01", novaHora: "10:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/passou|passado|futuro/i);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("Round 13: valida profissional↔serviço ao TROCAR de profissional", () => {
    const scheduleComServico = () => ({
      id: 42,
      googleEventId: "evt_old",
      professionalId: 10,
      serviceId: 1,
      status: "PENDENTE",
      contact: { id: 5, name: "João", number: "5511111111111" },
      service: { name: "Corte", durationMinutes: 30 },
      update: jest.fn().mockResolvedValue(undefined)
    });

    beforeEach(() => {
      (Schedule.findOne as jest.Mock).mockResolvedValue(scheduleComServico());
      (UserCalendar.findOne as jest.Mock).mockResolvedValue({
        calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
      });
      mockCreate.mockResolvedValue({ id: "evt_new" });
      mockDelete.mockResolvedValue(undefined);
    });

    it("RECUSA quando o novo profissional não realiza o serviço", async () => {
      (ServiceProfessional.findOne as jest.Mock).mockResolvedValue(null); // sem vínculo
      (User.findOne as jest.Mock).mockResolvedValue({ id: 99, name: "Bruno" });

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00", novoAtendenteId: 99 },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/não realiza o serviço/i);
      expect(result.erro).toMatch(/Bruno/);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("PERMITE quando o novo profissional realiza o serviço", async () => {
      (ServiceProfessional.findOne as jest.Mock).mockResolvedValue({ id: 7, serviceId: 1, userId: 99 });

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00", novoAtendenteId: 99 },
        companyId
      );

      expect(result.sucesso).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("NÃO consulta o vínculo quando não há troca de profissional (sem novoAtendenteId)", async () => {
      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(true);
      // Sem troca de profissional → não precisa validar vínculo (evita query extra)
      expect(ServiceProfessional.findOne as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe("Furo #3: bloqueia remarcação de agendamento CANCELADO", () => {
    it("recusa e orienta a criar_evento quando o agendamento está CANCELADO", async () => {
      (Schedule.findOne as jest.Mock).mockResolvedValue({
        id: 42,
        googleEventId: "evt_old",
        professionalId: 10,
        status: "CANCELADO",
        contact: { id: 5, name: "João" },
        service: { name: "Corte", durationMinutes: 30 },
        update: jest.fn().mockResolvedValue(undefined)
      });

      const result = await reagendarEvento(
        { scheduleId: 42, novaData: FUTURA_DATA, novaHora: "14:00" },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/cancelado/i);
      expect(result.erro).toMatch(/criar_evento/i);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
