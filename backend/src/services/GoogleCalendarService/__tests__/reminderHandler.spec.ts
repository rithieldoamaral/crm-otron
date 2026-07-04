/**
 * Testes TDD para reminderHandler.
 * Cobre: detecção SIM/NÃO por regex normalizado, interceptação de mensagem,
 * fluxo de confirmação e cancelamento.
 */

jest.mock("../../../models/Schedule");
jest.mock("../../../libs/cache");
jest.mock("../calendarApi");
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { detectConfirmationIntent, handleReminderResponse, ReminderResponseContext } from "../reminderHandler";
import Schedule from "../../../models/Schedule";
import { cacheLayer } from "../../../libs/cache";

describe("detectConfirmationIntent — regex normalizado", () => {
  it("detecta SIM exato", () => expect(detectConfirmationIntent("SIM")).toBe("confirmed"));
  it("detecta sim minúsculo", () => expect(detectConfirmationIntent("sim")).toBe("confirmed"));
  it("detecta 'sim pode ser'", () => expect(detectConfirmationIntent("sim pode ser")).toBe("confirmed"));
  it("detecta 'confirmo'", () => expect(detectConfirmationIntent("confirmo")).toBe("confirmed"));
  it("detecta 'pode'", () => expect(detectConfirmationIntent("pode")).toBe("confirmed"));
  it("detecta 'ok'", () => expect(detectConfirmationIntent("ok")).toBe("confirmed"));
  it("detecta 'tá bom'", () => expect(detectConfirmationIntent("tá bom")).toBe("confirmed"));
  it("detecta 'ta bom' sem acento", () => expect(detectConfirmationIntent("ta bom")).toBe("confirmed"));
  it("detecta 'claro'", () => expect(detectConfirmationIntent("claro")).toBe("confirmed"));

  it("detecta NÃO exato", () => expect(detectConfirmationIntent("NÃO")).toBe("cancelled"));
  it("detecta 'nao' sem acento", () => expect(detectConfirmationIntent("nao")).toBe("cancelled"));
  it("detecta 'cancela'", () => expect(detectConfirmationIntent("cancela")).toBe("cancelled"));
  it("detecta 'cancelar'", () => expect(detectConfirmationIntent("cancelar")).toBe("cancelled"));
  it("detecta 'nao posso'", () => expect(detectConfirmationIntent("nao posso")).toBe("cancelled"));
  it("detecta 'não posso ir'", () => expect(detectConfirmationIntent("não posso ir")).toBe("cancelled"));

  it("retorna null para mensagem ambígua 'talvez'", () => expect(detectConfirmationIntent("talvez")).toBeNull());
  it("retorna null para 'pode ser que sim'", () => expect(detectConfirmationIntent("pode ser que sim")).toBe("confirmed")); // "pode" é match
  it("retorna null para mensagem aleatória", () => expect(detectConfirmationIntent("olá tudo bem")).toBeNull());
  it("retorna null para string vazia", () => expect(detectConfirmationIntent("")).toBeNull());
});

describe("handleReminderResponse", () => {
  const companyId = 1;
  const contactNumber = "5511999990001";

  const baseCtx: ReminderResponseContext = {
    companyId,
    contactNumber,
    message: "sim",
    whatsappId: 2
  };

  beforeEach(() => jest.clearAllMocks());

  it("retorna handled:false quando não há lembrete pendente no Redis", async () => {
    (cacheLayer.get as jest.Mock).mockResolvedValue(null);

    const result = await handleReminderResponse(baseCtx);
    expect(result.handled).toBe(false);
  });

  it("confirma agendamento quando cliente responde SIM e há lembrete pendente", async () => {
    (cacheLayer.get as jest.Mock).mockResolvedValue(JSON.stringify({ scheduleId: 42 }));
    const mockSchedule = {
      id: 42,
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findByPk as jest.Mock).mockResolvedValue(mockSchedule);
    (cacheLayer.del as jest.Mock).mockResolvedValue(undefined);

    const result = await handleReminderResponse({ ...baseCtx, message: "sim" });

    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      reminderStatus: "confirmed"
    }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe("confirmed");
  });

  it("cancela agendamento quando cliente responde NÃO e há lembrete pendente", async () => {
    (cacheLayer.get as jest.Mock).mockResolvedValue(JSON.stringify({ scheduleId: 42, googleEventId: "evt123" }));
    const mockSchedule = {
      id: 42,
      googleEventId: "evt123",
      update: jest.fn().mockResolvedValue(undefined)
    };
    (Schedule.findByPk as jest.Mock).mockResolvedValue(mockSchedule);
    (cacheLayer.del as jest.Mock).mockResolvedValue(undefined);

    const result = await handleReminderResponse({ ...baseCtx, message: "não posso" });

    expect(mockSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      reminderStatus: "cancelled"
    }));
    expect(result.handled).toBe(true);
    expect(result.action).toBe("cancelled");
  });

  it("retorna handled:false quando mensagem é ambígua (não SIM nem NÃO)", async () => {
    (cacheLayer.get as jest.Mock).mockResolvedValue(JSON.stringify({ scheduleId: 42 }));

    const result = await handleReminderResponse({ ...baseCtx, message: "talvez" });

    expect(result.handled).toBe(false);
    expect(Schedule.findByPk).not.toHaveBeenCalled();
  });
});
