/**
 * Testes TDD para criarEvento.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/Service");
jest.mock("../../../../models/ServiceProfessional");
jest.mock("../../../../models/UserCalendar");
jest.mock("../../../../models/UserWorkingHours");
jest.mock("../../../../models/Contact");
jest.mock("../../../../models/User");
jest.mock("../../calendarApi");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { criarEvento } from "../../tools/criarEvento";
import Schedule from "../../../../models/Schedule";
import Service from "../../../../models/Service";
import ServiceProfessional from "../../../../models/ServiceProfessional";
import UserCalendar from "../../../../models/UserCalendar";
import UserWorkingHours from "../../../../models/UserWorkingHours";
import Contact from "../../../../models/Contact";
import User from "../../../../models/User";
import { createCalendarEvent, getBusyPeriods } from "../../calendarApi";

const mockCreate = createCalendarEvent as jest.Mock;
const mockGetBusyPeriods = getBusyPeriods as jest.Mock;

/**
 * Helper para gerar uma data SEMPRE futura nos testes (evita o test-rot
 * por datas hardcoded). Estratégia: 30 dias no futuro às 14:00 BRT, evitando
 * o gatilho determinístico de "horário no passado" do criarEvento.
 *
 * Retorna `data` (string YYYY-MM-DD), `hora` (HH:MM) e `sendAt` (Date) já
 * casados — alguns testes precisam alimentar o mock de Schedule.findOne com
 * o mesmo instante exato que será passado para criarEvento.
 *
 * Não usamos jest.useFakeTimers porque fixar tempo quebra outros testes do
 * mesmo arquivo que dependem da data atual (ex: bloco de bug #13 abaixo).
 */
function dataFutura(): { data: string; hora: string; sendAt: Date } {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  // YYYY-MM-DD em UTC é OK porque +30d garante margem de fuso
  const data = future.toISOString().slice(0, 10);
  const hora = "14:00";
  // Mesmo cálculo que criarEvento usa internamente: new Date(`${data}T${hora}:00`)
  // — interpretado como horário local. Mantemos paridade aqui.
  const sendAt = new Date(`${data}T${hora}:00`);
  return { data, hora, sendAt };
}

describe("criarEvento", () => {
  const companyId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
    // Bug #39: criar_evento valida disponibilidade. Defaults = profissional
    // trabalha 09:00–18:00 e agenda livre, então o horário 14:00 dos testes
    // (dataFutura) é válido. Testes que precisam de outro comportamento
    // sobrescrevem estes mocks.
    (UserWorkingHours.findOne as jest.Mock).mockResolvedValue({
      dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true
    });
    mockGetBusyPeriods.mockResolvedValue([]);
    // Furo #4: por padrão o profissional REALIZA o serviço (vínculo existe).
    // Testes que validam o bloqueio sobrescrevem para null.
    (ServiceProfessional.findOne as jest.Mock).mockResolvedValue({ id: 1, serviceId: 1, userId: 10 });
  });

  it("cria evento no Calendar e no Schedule e retorna confirmação", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João Silva", number: "5511999990001" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "carlos@gmail.com", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000) });
    mockCreate.mockResolvedValue({ id: "google_evt_123" });
    (Schedule.create as jest.Mock).mockResolvedValue({ id: 99, status: "PENDENTE" });

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(Schedule.create).toHaveBeenCalledTimes(1);
    expect(result.sucesso).toBe(true);
    expect(result.agendamentoId).toBe(99);
    expect(result.mensagem).toMatch(/Carlos/);
    expect(result.mensagem).toMatch(new RegExp(hora));
  });

  it("retorna erro quando serviço não é encontrado", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue(null);

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 999, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/serviço.*não encontrado/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Furo #4 (2026-06-20): blindagem contra LLM barato alucinar atendenteId.
  // Mesmo que o profissional exista, se NÃO realiza o serviço, recusa.
  it("recusa quando o profissional não realiza o serviço (Furo #4 — anti-hallucination de atendenteId)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 99, name: "Bruno" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    // Bruno existe, mas NÃO tem vínculo com o serviço Corte
    (ServiceProfessional.findOne as jest.Mock).mockResolvedValue(null);

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 99, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/não realiza o serviço/i);
    // Não toca o Google Calendar nem cria Schedule
    expect(mockCreate).not.toHaveBeenCalled();
    expect(Schedule.create).not.toHaveBeenCalled();
  });

  // Furo #5 (2026-06-20): a mensagem de sucesso usa data com dia da semana
  // (linguagem natural), não ISO cru.
  it("mensagem de sucesso traz a data com dia da semana por extenso (Furo #5)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João", number: "5511999990001" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "c", accessToken: "t", refreshToken: "r", tokenExpiry: new Date(Date.now() + 3600000) });
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "evt" });
    (Schedule.create as jest.Mock).mockResolvedValue({ id: 99 });

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(true);
    // Não pode aparecer a data ISO crua (YYYY-MM-DD) na mensagem ao cliente.
    expect(result.mensagem).not.toContain(data);
    // Deve conter um dia da semana por extenso.
    expect(result.mensagem).toMatch(/segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo/i);
  });

  it("retorna erro quando profissional não tem calendário conectado", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue(null);

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/calendário.*não conectado|sem calendário/i);
  });

  it("faz rollback do Schedule quando Google Calendar falha", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({ calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000) });
    mockCreate.mockRejectedValue(new Error("Google API offline"));

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/Google API offline|falha/i);
    // Schedule.create não deve ter sido chamado se Google falhou primeiro
    expect(Schedule.create).not.toHaveBeenCalled();
  });

  // Bug #18 (Round 7): refresh_token revogado/expirado pelo Google.
  // Ocorreu em 03/05/2026 — UserCalendar não usado por 8 dias, Google retornou
  // `invalid_grant`. O erro cru "invalid_grant" não orienta o LLM a NADA — ele
  // ficou em loop tentando recriar e por fim transferiu para humano sem
  // explicar o problema real ao cliente. Defesa: capturar invalid_grant e
  // retornar mensagem que o LLM possa usar para informar o cliente E sinalizar
  // ao operador que precisa reconectar o Google Calendar.
  it("retorna erro orientativo quando o refresh_token do Google está revogado", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    // googleapis SDK lança Error com `.message` contendo "invalid_grant" quando
    // o token de refresh foi revogado/expirou.
    mockCreate.mockRejectedValue(new Error("invalid_grant"));

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(false);
    // Mensagem precisa indicar problema de conexão com Google Calendar para o LLM
    expect(result.erro).toMatch(/calendário|google|reconect/i);
    // E NÃO deve repassar "invalid_grant" cru — isso confunde o LLM
    expect(result.erro).not.toMatch(/invalid_grant/);
    expect(Schedule.create).not.toHaveBeenCalled();
  });

  // Regressão bug #8: LLM gpt-oss-120b chamou criar_evento DUAS VEZES no mesmo
  // turn (primeira sucesso com atendenteId=2, segunda com atendenteId=1 errado)
  // — perdeu o contexto de que já tinha agendado e tentou de novo. Sem proteção
  // determinística, modelo barato cria duplicatas e mente para o cliente.
  it("recusa quando já existe agendamento PENDENTE do mesmo cliente/profissional/data/hora (bug #8)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    // Já existe Schedule PENDENTE no mesmo slot exato (mesmo profissional + mesma data/hora)
    const { data, hora, sendAt } = dataFutura();
    (Schedule.findOne as jest.Mock).mockResolvedValue({
      id: 77,
      status: "PENDENTE",
      sendAt,
      professionalId: 10,
      service: { name: "Corte" }
    });

    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(mockCreate).not.toHaveBeenCalled();
    expect(Schedule.create).not.toHaveBeenCalled();
    expect(result.sucesso).toBe(false);
    expect(result.erro).toMatch(/já existe|duplicad|agendamento.*#?77/i);
  });

  // Bug #15 (Round 5): cliente tinha agendamento 09:00 com Sofia. Disse "perfeito"
  // confirmando, mas LLM (gpt-oss-120b) interpretou como nova solicitação, alegou
  // que 09:00 estava ocupado, ofereceu 11:00 — e CRIOU 11:00 DUPLICADO sem
  // cancelar 09:00. Resultado: cliente com 2 agendamentos no mesmo dia.
  // Defesa: bloquear criar_evento quando cliente já tem QUALQUER Schedule
  // PENDENTE futuro (não só duplicata exata). LLM deve usar reagendar_evento
  // ou cancelar_evento antes. Erro semântico orienta o LLM ao próximo passo.
  it("recusa quando cliente já tem agendamento PENDENTE em OUTRA data/hora (bug #15)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Sofia" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "Rithiel" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    // Cliente JÁ tem agendamento PENDENTE em uma data futura X às 09:00 BRT —
    // bot tenta criar mesma data X às 11:00. Datas relativas a Date.now() para
    // o teste não rotinhar com o tempo (CLAUDE.md II.6: defesa contra obsolescência).
    const { data: dataTeste } = dataFutura();
    (Schedule.findOne as jest.Mock).mockResolvedValue({
      id: 88,
      status: "PENDENTE",
      sendAt: new Date(`${dataTeste}T09:00:00`),
      professionalId: 10,
      service: { name: "Reparo de dentes" }
    });

    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data: dataTeste, hora: "11:00", contactId: 5 },
      companyId
    );

    expect(mockCreate).not.toHaveBeenCalled();
    expect(Schedule.create).not.toHaveBeenCalled();
    expect(result.sucesso).toBe(false);
    // Erro precisa orientar o LLM ao próximo passo correto (reagendar/cancelar)
    expect(result.erro).toMatch(/reagendar_evento|cancelar/i);
    expect(result.erro).toMatch(/#88/); // referencia o agendamento existente
  });

  // Bug #13 (Round 4): em 27/04 19:47 BRT, o LLM (sem conceito de "agora")
  // criava agendamento para 27/04 11:00 — 8h no passado. O sistema aceitava
  // alegremente. Defesa determinística: bloquear sendAt < Date.now().
  // Note que o agente em si pode operar 24/7 — a restrição é só sobre o
  // INSTANTE do agendamento (não pode estar no passado), não sobre o
  // momento em que a criação é solicitada.
  it("recusa quando data/hora já passou (bug #13)", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });

    jest.useFakeTimers().setSystemTime(new Date("2026-04-27T22:47:00Z")); // 19:47 BRT

    try {
      const result = await criarEvento(
        // 27/04 11:00 BRT = 14:00 UTC — já passou (now = 22:47 UTC)
        { servicoId: 1, atendenteId: 10, data: "2026-04-27", hora: "11:00", contactId: 5 },
        companyId
      );

      expect(result.sucesso).toBe(false);
      expect(result.erro).toMatch(/passad|já passou|posterior|futuro/i);
      // Não deve nem chamar Google Calendar nem criar Schedule
      expect(mockCreate).not.toHaveBeenCalled();
      expect(Schedule.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Feature (Round 9, Opção A): após agendamento criado com sucesso, o
  // resultado inclui linkCalendario — URL pré-preenchida do Google Calendar
  // para o cliente adicionar ao calendário pessoal com um clique.
  it("inclui linkCalendario no resultado de sucesso", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João Silva", number: "5511999990001" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "carlos@gmail.com", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "google_evt_cal" });
    (Schedule.create as jest.Mock).mockResolvedValue({ id: 101, status: "PENDENTE" });

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(true);
    expect(result.linkCalendario).toBeDefined();
    expect(result.linkCalendario).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render/);
    expect(result.linkCalendario).toContain("action=TEMPLATE");
    // Data e horário de início devem estar no link
    const dataCompacta = data.replace(/-/g, "");
    expect(result.linkCalendario).toContain(dataCompacta);
  });

  // Cancelamentos antigos NÃO devem bloquear novos agendamentos no mesmo slot
  // — só Schedule PENDENTE conta como conflito.
  it("permite criar quando o agendamento existente está CANCELADO", async () => {
    (Service.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Corte", durationMinutes: 30 });
    (User.findOne as jest.Mock).mockResolvedValue({ id: 10, name: "Carlos" });
    (Contact.findOne as jest.Mock).mockResolvedValue({ id: 5, name: "João" });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue({
      calendarId: "cal", accessToken: "tok", refreshToken: "ref", tokenExpiry: new Date(Date.now() + 3600000)
    });
    // findOne com filtro {status: PENDENTE} não acha → null
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "google_evt_456" });
    (Schedule.create as jest.Mock).mockResolvedValue({ id: 100, status: "PENDENTE" });

    const { data, hora } = dataFutura();
    const result = await criarEvento(
      { servicoId: 1, atendenteId: 10, data, hora, contactId: 5 },
      companyId
    );

    expect(result.sucesso).toBe(true);
    expect(Schedule.create).toHaveBeenCalledTimes(1);
  });
});
