/**
 * Testes TDD para secretaryBriefing.
 * Briefing matinal automático: resumo do dia enviado UMA VEZ por empresa/dia
 * via Redis idempotency key (TTL 12h = 43200s).
 *
 * generateMorningBriefing — função principal, testada extensivamente.
 * runMorningBriefings    — orquestrador, testado para concerns estruturais.
 */

jest.mock("../../../models/Company");
jest.mock("../../../models/Whatsapp");
jest.mock("../../../models/Ticket");
jest.mock("../../../models/Schedule");
jest.mock("../../../models/Contact");
jest.mock("../../../models/User");
jest.mock("../../AgentService/settingsCache");
jest.mock("../../../libs/cache", () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue("OK"),
}));
jest.mock("../../../libs/wbot", () => ({
  getWbot: jest.fn(),
}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { generateMorningBriefing, runMorningBriefings } from "../secretaryBriefing";
import { canonicalizePhone } from "../phoneMatch";
import Ticket from "../../../models/Ticket";
import Schedule from "../../../models/Schedule";
import Company from "../../../models/Company";
import Whatsapp from "../../../models/Whatsapp";
import { getSettingsByCompany } from "../../AgentService/settingsCache";
import * as cache from "../../../libs/cache";
import { getWbot } from "../../../libs/wbot";

const mockTicketCount    = Ticket.count     as jest.Mock;
const mockScheduleFindAll = Schedule.findAll as jest.Mock;
const mockCompanyFindAll  = Company.findAll  as jest.Mock;
const mockWhatsappFindOne = Whatsapp.findOne as jest.Mock;
const mockGetSettings     = getSettingsByCompany as jest.Mock;
const mockCacheGet        = cache.get as jest.Mock;
const mockCacheSet        = cache.set as jest.Mock;
const mockGetWbot         = getWbot   as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeWbot() {
  return { sendMessage: jest.fn().mockResolvedValue(undefined) };
}

function makeWhatsapp(id = 1, companyId = 1): any {
  return { id, companyId, isSecretaryChannel: true };
}

function makeSchedule(id: number, clientName: string, profName: string): any {
  return {
    id,
    sendAt: new Date(),
    contact: { name: clientName },
    user:    { name: profName },
  };
}

// Default args used in most generateMorningBriefing tests
const COMPANY_ID    = 1;
const ADMIN_NUMBERS = ["5511999990001", "5511999990002"];
const WHATSAPP      = makeWhatsapp();

// ── generateMorningBriefing ────────────────────────────────────────────────

describe("generateMorningBriefing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null); // not yet sent today
    mockCacheSet.mockResolvedValue("OK");
    mockTicketCount.mockResolvedValue(0);
    mockScheduleFindAll.mockResolvedValue([]);
    mockGetWbot.mockReturnValue(makeFakeWbot());
  });

  // ── Idempotência ──────────────────────────────────────────────────────────

  it("retorna false e NÃO envia quando Redis indica já enviado hoje", async () => {
    mockCacheGet.mockResolvedValue("1"); // já enviado
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    const result = await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    expect(result).toBe(false);
    expect(wbot.sendMessage).not.toHaveBeenCalled();
  });

  it("grava chave Redis com TTL 43200s após envio", async () => {
    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    expect(mockCacheSet).toHaveBeenCalledWith(
      expect.stringContaining(`secretary:briefing_sent:${COMPANY_ID}:`),
      "1",
      "EX",
      43200
    );
  });

  it("chave Redis inclui a data de hoje no formato YYYY-MM-DD", async () => {
    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    const today = new Date().toISOString().slice(0, 10);
    expect(mockCacheGet).toHaveBeenCalledWith(
      `secretary:briefing_sent:${COMPANY_ID}:${today}`
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      `secretary:briefing_sent:${COMPANY_ID}:${today}`,
      "1",
      "EX",
      43200
    );
  });

  it("retorna true após envio bem-sucedido", async () => {
    const result = await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);
    expect(result).toBe(true);
  });

  // ── Envio ─────────────────────────────────────────────────────────────────

  it("envia mensagem para TODOS os números admin", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    expect(wbot.sendMessage).toHaveBeenCalledTimes(ADMIN_NUMBERS.length);
    ADMIN_NUMBERS.forEach(num => {
      // O JID de destino usa a forma canônica do número (sem o 9º dígito BR).
      expect(wbot.sendMessage).toHaveBeenCalledWith(
        `${canonicalizePhone(num)}@s.whatsapp.net`,
        expect.objectContaining({ text: expect.any(String) })
      );
    });
  });

  it("monta o JID na forma canônica: cadastro com 9º dígito → envio sem o 9", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    // Cadastro com o 9º dígito brasileiro (13 díg). O WhatsApp entrega o JID
    // sem o 9, então o envio precisa sair na forma de 12 díg para entregar.
    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ["5548988368758"]);

    expect(wbot.sendMessage).toHaveBeenCalledWith(
      "554888368758@s.whatsapp.net",
      expect.objectContaining({ text: expect.any(String) })
    );
    // Garante que o número cru (com o 9) NÃO foi usado como destino.
    expect(wbot.sendMessage).not.toHaveBeenCalledWith(
      "5548988368758@s.whatsapp.net",
      expect.anything()
    );
  });

  it("prepend 55 ao montar o JID quando cadastro vem só com DDD + número", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    // Cadastro no novo formato (só DDD + número, sem código de país).
    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ["48988368758"]);

    expect(wbot.sendMessage).toHaveBeenCalledWith(
      "554888368758@s.whatsapp.net",
      expect.objectContaining({ text: expect.any(String) })
    );
  });

  it("não lança erro quando wbot.sendMessage falha (best-effort, segue adiante)", async () => {
    mockGetWbot.mockReturnValue({
      sendMessage: jest.fn().mockRejectedValue(new Error("WA down"))
    });

    await expect(
      generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS)
    ).resolves.not.toThrow();
  });

  it("não lança erro quando getWbot lança exceção", async () => {
    mockGetWbot.mockImplementation(() => { throw new Error("wbot not ready"); });

    await expect(
      generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS)
    ).resolves.not.toThrow();
  });

  // ── Conteúdo da mensagem ──────────────────────────────────────────────────

  it("mensagem contém contagem de tickets abertos", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);
    mockTicketCount.mockImplementation(async ({ where }: any) => {
      if (where.status === "open" && !where.updatedAt) return 5;
      return 0;
    });

    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    const [, { text }] = wbot.sendMessage.mock.calls[0];
    expect(text).toMatch(/5/);
  });

  it("mensagem lista nomes de clientes nos agendamentos (até 5)", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);
    mockScheduleFindAll.mockResolvedValue([
      makeSchedule(1, "Ana Lima",    "Prof A"),
      makeSchedule(2, "João Silva",  "Prof B"),
    ]);

    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    const [, { text }] = wbot.sendMessage.mock.calls[0];
    expect(text).toMatch(/Ana Lima/);
    expect(text).toMatch(/João Silva/);
  });

  it("mensagem exibe '+ N outros' quando há mais de 5 agendamentos", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);
    mockScheduleFindAll.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => makeSchedule(i + 1, `Cliente ${i + 1}`, "Prof"))
    );

    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    const [, { text }] = wbot.sendMessage.mock.calls[0];
    // 8 agendamentos, exibe 5, mostra "+ 3 outros"
    expect(text).toMatch(/\+\s*3\s*outros/i);
  });

  it("mensagem funciona corretamente com zero agendamentos", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);
    mockScheduleFindAll.mockResolvedValue([]);

    await generateMorningBriefing(COMPANY_ID, WHATSAPP, ADMIN_NUMBERS);

    const [, { text }] = wbot.sendMessage.mock.calls[0];
    // Deve conter alguma menção a agendamentos mesmo que seja 0
    expect(text).toMatch(/agendamento/i);
  });

  it("usa companyId correto na contagem de tickets (multi-tenant)", async () => {
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await generateMorningBriefing(99, makeWhatsapp(1, 99), ADMIN_NUMBERS);

    expect(mockTicketCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 99 }) })
    );
  });
});

// ── runMorningBriefings ───────────────────────────────────────────────────

describe("runMorningBriefings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue("OK");
    mockTicketCount.mockResolvedValue(0);
    mockScheduleFindAll.mockResolvedValue([]);
    mockGetWbot.mockReturnValue(makeFakeWbot());
  });

  it("não envia quando empresa não tem canal secretária", async () => {
    mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
    mockWhatsappFindOne.mockResolvedValue(null);
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await runMorningBriefings();

    expect(wbot.sendMessage).not.toHaveBeenCalled();
  });

  it("não envia quando secretaryAdminNumbers está vazio", async () => {
    mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
    mockWhatsappFindOne.mockResolvedValue(makeWhatsapp());
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "" },
      { key: "secretaryBriefingTime", value: "08:00" },
    ]);
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await runMorningBriefings();

    expect(wbot.sendMessage).not.toHaveBeenCalled();
  });

  it("não lança erro quando uma empresa falha individualmente", async () => {
    mockCompanyFindAll.mockResolvedValue([
      { id: 1, status: true },
      { id: 2, status: true },
    ]);
    // Primeira empresa lança exceção
    mockWhatsappFindOne
      .mockRejectedValueOnce(new Error("DB timeout"))
      .mockResolvedValueOnce(null);

    await expect(runMorningBriefings()).resolves.not.toThrow();
  });

  it("não lança erro quando Company.findAll falha", async () => {
    mockCompanyFindAll.mockRejectedValue(new Error("DB offline"));

    await expect(runMorningBriefings()).resolves.not.toThrow();
  });

  it("envia apenas no horário configurado (hora:minuto exato)", async () => {
    // Usa hora local 10:15 para evitar colisão com o default "08:00"
    jest.useFakeTimers();
    const d = new Date();
    jest.setSystemTime(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 15, 0, 0));

    mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
    mockWhatsappFindOne.mockResolvedValue(makeWhatsapp());
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      { key: "secretaryBriefingTime", value: "10:15" }, // bate com a hora fake
    ]);
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await runMorningBriefings();

    // Redis deve ter sido consultado — briefing foi disparado
    expect(mockCacheGet).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("NÃO envia quando horário atual não corresponde ao configurado", async () => {
    jest.useFakeTimers();
    // Define tempo atual como 09:30 (hora local)
    const d = new Date();
    jest.setSystemTime(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 30, 0, 0));

    mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
    mockWhatsappFindOne.mockResolvedValue(makeWhatsapp());
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      { key: "secretaryBriefingTime", value: "08:00" }, // horário diferente do atual
    ]);
    const wbot = makeFakeWbot();
    mockGetWbot.mockReturnValue(wbot);

    await runMorningBriefings();

    // Redis não deve ter sido consultado (briefing não foi disparado)
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(wbot.sendMessage).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("usa horário padrão '08:00' quando secretaryBriefingTime não configurado", async () => {
    // Constrói a data fake em hora LOCAL (não UTC) para evitar offset de fuso horário.
    // new Date(y, m, d, h, min) usa fuso do sistema — `getHours()` retorna 8 corretamente.
    jest.useFakeTimers();
    const d = new Date();
    jest.setSystemTime(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 0, 0));

    mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
    mockWhatsappFindOne.mockResolvedValue(makeWhatsapp());
    mockGetSettings.mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      // secretaryBriefingTime ausente → default "08:00"
    ]);
    mockGetWbot.mockReturnValue(makeFakeWbot());

    await runMorningBriefings();

    // Se o default "08:00" foi corretamente aplicado, o horário bate e Redis é consultado
    expect(mockCacheGet).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
