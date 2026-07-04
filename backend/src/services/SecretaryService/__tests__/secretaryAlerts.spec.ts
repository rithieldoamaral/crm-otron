/**
 * Testes TDD para secretaryAlerts — alertas proativos do canal secretária.
 *
 * Foco desta suíte: garantir que o JID de destino dos alertas é montado na
 * forma CANÔNICA do número (sem o 9º dígito brasileiro, com código de país),
 * espelhando a tolerância já aplicada no reconhecimento INBOUND do admin
 * (ver phoneMatch.ts / ticket #22, 2026-06-28). Caso contrário, o admin
 * cadastrado com o 9 (5548988368758) não recebe o alerta, pois o JID real
 * do WhatsApp trafega sem o 9 (554888368758).
 */

jest.mock("../../../models/Company");
jest.mock("../../../models/Whatsapp");
jest.mock("../../../models/Ticket");
jest.mock("../../../models/Contact");
jest.mock("../../../models/Queue");
jest.mock("../../AgentService/settingsCache");
jest.mock("../../../libs/wbot", () => ({
  getWbot: jest.fn(),
}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { runSecretaryAlerts } from "../secretaryAlerts";
import Company from "../../../models/Company";
import Whatsapp from "../../../models/Whatsapp";
import Ticket from "../../../models/Ticket";
import { getSettingsByCompany } from "../../AgentService/settingsCache";
import { getWbot } from "../../../libs/wbot";

const mockCompanyFindAll  = Company.findAll  as jest.Mock;
const mockWhatsappFindOne = Whatsapp.findOne as jest.Mock;
const mockTicketFindAll   = Ticket.findAll   as jest.Mock;
const mockGetSettings     = getSettingsByCompany as jest.Mock;
const mockGetWbot         = getWbot as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeWbot() {
  return { sendMessage: jest.fn().mockResolvedValue(undefined) };
}

function makeWhatsapp(id = 1, companyId = 1): any {
  return { id, companyId, isSecretaryChannel: true };
}

/** Ticket "em espera longa": updatedAt bem no passado para cair no alerta. */
function makeWaitingTicket(id: number, name: string): any {
  return {
    id,
    updatedAt: new Date(Date.now() - 60 * 60 * 1000), // 1h atrás
    contact: { name, number: "x" },
    queue: { name: "Geral" },
  };
}

/**
 * Configura o cenário padrão: 1 empresa com canal secretária, wait-alert
 * habilitado (10 min) e 1 ticket em espera longa, para o caminho de envio
 * de alerta ser exercido. `adminNumbers` define o(s) número(s) cadastrado(s).
 */
function setupWaitAlertScenario(adminNumbers: string, wbot: any) {
  mockCompanyFindAll.mockResolvedValue([{ id: 1, status: true }]);
  mockWhatsappFindOne.mockResolvedValue(makeWhatsapp());
  mockGetSettings.mockResolvedValue([
    { key: "secretaryAdminNumbers", value: adminNumbers },
    { key: "secretaryAlertWaitMinutes", value: "10" },
    { key: "secretaryAlertAgentError", value: "disabled" },
  ]);
  mockTicketFindAll.mockResolvedValue([makeWaitingTicket(1, "Cliente A")]);
  mockGetWbot.mockReturnValue(wbot);
}

describe("runSecretaryAlerts — JID canônico no envio", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("monta o JID na forma canônica: cadastro com 9º dígito → envio sem o 9", async () => {
    const wbot = makeFakeWbot();
    setupWaitAlertScenario("5548988368758", wbot); // cadastro COM o 9 (13 díg)

    await runSecretaryAlerts();

    expect(wbot.sendMessage).toHaveBeenCalledWith(
      "554888368758@s.whatsapp.net", // entregue SEM o 9 (12 díg)
      expect.objectContaining({ text: expect.any(String) })
    );
    // O número cru (com o 9) NÃO pode ser usado como destino.
    expect(wbot.sendMessage).not.toHaveBeenCalledWith(
      "5548988368758@s.whatsapp.net",
      expect.anything()
    );
  });

  it("prepend 55 ao montar o JID quando cadastro vem só com DDD + número", async () => {
    const wbot = makeFakeWbot();
    setupWaitAlertScenario("48988368758", wbot); // só DDD + 9 + número (11 díg)

    await runSecretaryAlerts();

    expect(wbot.sendMessage).toHaveBeenCalledWith(
      "554888368758@s.whatsapp.net",
      expect.objectContaining({ text: expect.any(String) })
    );
  });

  it("mantém inalterado o número já canônico (12 díg sem o 9)", async () => {
    const wbot = makeFakeWbot();
    setupWaitAlertScenario("554888368758", wbot);

    await runSecretaryAlerts();

    expect(wbot.sendMessage).toHaveBeenCalledWith(
      "554888368758@s.whatsapp.net",
      expect.objectContaining({ text: expect.any(String) })
    );
  });
});
