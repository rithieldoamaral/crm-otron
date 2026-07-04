/**
 * Testes TDD para buscarProximoHorario.
 * Cobre:
 * - retorno do nome do profissional (regressão: vazou "[Nome do profissional]"
 *   na resposta do LLM por o campo nome não vir populado).
 * - varredura de 7 dias (sem horário disponível).
 * - exclusão de profissional sem calendário.
 */

jest.mock("../../../../models/Service");
jest.mock("../../../../models/ServiceProfessional");
jest.mock("../../../../models/UserCalendar");
jest.mock("../../../../models/UserWorkingHours");
jest.mock("../../calendarApi");

import { buscarProximoHorario } from "../../tools/buscarProximoHorario";
import Service from "../../../../models/Service";
import ServiceProfessional from "../../../../models/ServiceProfessional";
import UserCalendar from "../../../../models/UserCalendar";
import UserWorkingHours from "../../../../models/UserWorkingHours";
import { getBusyPeriods } from "../../calendarApi";

const mockGetBusy = getBusyPeriods as jest.Mock;

describe("buscarProximoHorario", () => {
  const companyId = 2;

  beforeEach(() => jest.clearAllMocks());

  it("retorna nome do profissional junto com slot encontrado (regressão: bug #1)", async () => {
    // Causa raiz histórica: o retorno só populava `profissionalId`, deixando `profissional`
    // (nome) undefined. O LLM gpt-oss-120b inventava "[Nome do profissional]" ao redigir.
    (Service.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Reparo de dentes",
      durationMinutes: 60
    });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 2, user: { id: 2, name: "Sofia" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "sofia@gmail.com",
      isActive: true
    });
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
      isWorking: true
    });
    mockGetBusy.mockResolvedValue([]);

    const result = await buscarProximoHorario({ servicoId: 1 }, companyId);

    expect(result.encontrado).toBe(true);
    expect(result.profissionalId).toBe(2);
    // Garante que o nome chega ao LLM — sem isso ele alucina placeholder textual.
    expect(result.profissional).toBe("Sofia");
    // Problema do dia da semana (2026-06-20): dataFormatada vem com o weekday pronto.
    expect(result.dataFormatada).toMatch(
      /^(segunda|terça|quarta|quinta|sexta|sábado|domingo)(-feira)?, \d{2}\/\d{2}\/\d{4}$/
    );
    // A mensagem ao LLM também usa a data formatada (com dia da semana).
    expect(result.mensagem).toContain(result.dataFormatada);
  });

  it("retorna mensagem de configuração pendente quando profissional tem calendário mas isWorking:false em todos os dias (Bug #34)", async () => {
    // Cenário: calendário conectado, mas nenhum dia marcado como trabalho.
    // Bug #34: antes retornava "nenhum horário" que confundia "agenda cheia" com
    // "configuração pendente". Agora distingue os casos.
    (Service.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Reparo",
      durationMinutes: 60
    });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 2, user: { id: 2, name: "Sofia" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "sofia@gmail.com",
      isActive: true
    });
    // Todos os dias com isWorking:false = configuração não feita
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 0,
      startTime: "09:00",
      endTime: "18:00",
      isWorking: false
    });
    mockGetBusy.mockResolvedValue([]);

    const result = await buscarProximoHorario({ servicoId: 1 }, companyId);

    expect(result.encontrado).toBe(false);
    // Deve informar que é problema de configuração — não de agenda cheia
    expect(result.mensagem).toMatch(/horários de trabalho não configurados/i);
  });

  it("retorna 'nenhum horário' quando profissional trabalha mas todos os slots estão ocupados", async () => {
    // Cenário: calendário conectado, horário configurado, mas Google Calendar cheio.
    // Este é o caso REAL de "agenda cheia" — distinto de "configuração pendente".
    (Service.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Reparo",
      durationMinutes: 60
    });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 2, user: { id: 2, name: "Sofia" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "sofia@gmail.com",
      isActive: true
    });
    // Trabalha em todos os dias — horário configurado
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "10:00", // janela curta: 1 slot de 60min
      isWorking: true
    });
    // Google Calendar cheio — o único slot (09:00-10:00) está ocupado
    mockGetBusy.mockResolvedValue([{ start: "09:00", end: "10:00" }]);

    const result = await buscarProximoHorario({ servicoId: 1 }, companyId);

    expect(result.encontrado).toBe(false);
    expect(result.mensagem).toMatch(/nenhum horário disponível/i);
  });

  it("ignora profissional sem calendário conectado", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Reparo",
      durationMinutes: 60
    });
    (ServiceProfessional.findAll as jest.Mock).mockResolvedValue([
      { userId: 2, user: { id: 2, name: "Sofia" } }
    ]);
    (UserCalendar.findOne as jest.Mock).mockResolvedValue(null);

    const result = await buscarProximoHorario({ servicoId: 1 }, companyId);

    expect(result.encontrado).toBe(false);
  });

  it("retorna erro estruturado quando serviço não existe", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue(null);

    const result = await buscarProximoHorario({ servicoId: 999 }, companyId);

    expect(result.encontrado).toBe(false);
    expect(result.mensagem).toMatch(/não encontrado/i);
  });
});
