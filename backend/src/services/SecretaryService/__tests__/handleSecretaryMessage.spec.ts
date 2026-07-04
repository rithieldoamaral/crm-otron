/**
 * Testes TDD para handleSecretaryMessage.
 * Cobre: auth, fluxo normal, fallback de erro.
 */

jest.mock("../../../models/Setting");
jest.mock("../secretaryLoop");
jest.mock("../../../libs/wbot", () => ({}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { handleSecretaryMessage, isSecretaryAdmin, SecretaryMessageContext } from "../handleSecretaryMessage";
import { runSecretaryLoop } from "../secretaryLoop";
import Setting from "../../../models/Setting";
import { clearSettingsCache } from "../../AgentService/settingsCache";

const mockRunLoop = runSecretaryLoop as jest.Mock;

function makeCtx(overrides: Partial<SecretaryMessageContext> = {}): SecretaryMessageContext {
  return {
    companyId: 1,
    senderNumber: "5511999990001",
    userMessage: "Quantos atendimentos abertos temos?",
    whatsappId: 2,
    ...overrides
  };
}

describe("handleSecretaryMessage — autenticação", () => {
  beforeEach(() => { jest.clearAllMocks(); clearSettingsCache(); });

  it("retorna handled:false quando remetente não é admin", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511111110000,5511111110001" }
    ]);

    const sendFn = jest.fn();
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "5599999999999" }),
      sendFn
    );

    expect(result.handled).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();
    expect(mockRunLoop).not.toHaveBeenCalled();
  });

  it("retorna handled:false quando secretaryAdminNumbers não está configurado", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([]);

    const sendFn = jest.fn();
    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(result.handled).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it("retorna handled:false quando secretaryAdminNumbers está vazio", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "" }
    ]);

    const sendFn = jest.fn();
    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(result.handled).toBe(false);
  });
});

describe("handleSecretaryMessage — fluxo normal", () => {
  beforeEach(() => { jest.clearAllMocks(); clearSettingsCache(); });

  it("chama runSecretaryLoop e envia resposta ao admin", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001,5511999990002" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Há 3 atendimentos abertos." });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(mockRunLoop).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("Há 3 atendimentos abertos.");
    expect(result.handled).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("autentica admin com número incluindo 55 no início", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "5511999990001" }),
      sendFn
    );

    expect(result.handled).toBe(true);
  });

  it("autentica admin quando o remetente vem no formato JID (@s.whatsapp.net)", async () => {
    // O WhatsApp às vezes entrega o número como JID; o cadastro é só dígitos.
    // A normalização evita trancar o admin por diferença de formato.
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "5511999990001@s.whatsapp.net" }),
      sendFn
    );

    expect(result.handled).toBe(true);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
  });

  it("autentica admin mesmo com máscara no cadastro (+55 (11) 99999-0001)", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "+55 (11) 99999-0001" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "5511999990001" }),
      sendFn
    );

    expect(result.handled).toBe(true);
  });

  it("autentica admin quando cadastro tem o 9º dígito e o WhatsApp entrega SEM o 9 (ticket #22)", async () => {
    // Causa-raiz do ticket #22: admin cadastra 5548988368758 (com 9), mas o
    // WhatsApp entrega o JID 554888368758 (sem o 9). Devem casar.
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5548988368758" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "554888368758@s.whatsapp.net" }),
      sendFn
    );

    expect(result.handled).toBe(true);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
  });

  it("autentica admin quando cadastro vem só com DDD + número (sem código de país)", async () => {
    // Request #1: usuário cadastra 48988368758 (DDD+9+número); WhatsApp entrega 554888368758.
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "48988368758" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "554888368758@s.whatsapp.net" }),
      sendFn
    );

    expect(result.handled).toBe(true);
  });

  it("NÃO autentica não-admin mesmo após normalização (segurança preservada)", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(
      makeCtx({ senderNumber: "5511000000000@s.whatsapp.net" }),
      sendFn
    );

    expect(result.handled).toBe(false);
    expect(mockRunLoop).not.toHaveBeenCalled();
  });

  it("autentica admin mesmo com espaços em torno do número na configuração", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: " 5511999990001 , 5511999990002 " }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(result.handled).toBe(true);
  });
});

describe("handleSecretaryMessage — filtro de canal (secretaryChannelId)", () => {
  beforeEach(() => { jest.clearAllMocks(); clearSettingsCache(); });

  it("responde em qualquer canal quando secretaryChannelId não está configurado", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
      // sem secretaryChannelId → qualquer whatsappId deve funcionar
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });
    const sendFn = jest.fn().mockResolvedValue(undefined);

    const result = await handleSecretaryMessage(makeCtx({ whatsappId: 99 }), sendFn);

    expect(result.handled).toBe(true);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
  });

  it("responde quando secretaryChannelId está vazio string", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      { key: "secretaryChannelId", value: "" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });
    const sendFn = jest.fn().mockResolvedValue(undefined);

    const result = await handleSecretaryMessage(makeCtx({ whatsappId: 99 }), sendFn);

    expect(result.handled).toBe(true);
  });

  it("responde quando whatsappId bate com secretaryChannelId configurado", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      { key: "secretaryChannelId", value: "2" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });
    const sendFn = jest.fn().mockResolvedValue(undefined);

    const result = await handleSecretaryMessage(makeCtx({ whatsappId: 2 }), sendFn);

    expect(result.handled).toBe(true);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
  });

  it("admin em canal diferente do secretaryChannelId deve ser atendido pela secretária (admin tem prioridade)", async () => {
    // Bug: antes o filtro de canal bloqueava admin que enviou msg no canal agente
    // (ex: testou o agendamento como cliente, ficou com ticket aberto).
    // Comportamento correto: check de admin tem prioridade — qualquer canal.
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" },
      { key: "secretaryChannelId", value: "7" }
    ]);
    mockRunLoop.mockResolvedValue({ reply: "Ok!" });
    const sendFn = jest.fn().mockResolvedValue(undefined);

    // Admin envia do canal agente (whatsappId=2), secretária configurada no canal 7
    const result = await handleSecretaryMessage(makeCtx({ whatsappId: 2 }), sendFn);

    expect(result.handled).toBe(true);
    expect(mockRunLoop).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledWith("Ok!");
  });
});

describe("handleSecretaryMessage — fallback de erro", () => {
  beforeEach(() => { jest.clearAllMocks(); clearSettingsCache(); });

  it("envia mensagem de erro ao admin quando loop lança exceção", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
    ]);
    mockRunLoop.mockRejectedValue(new Error("Anthropic timeout"));

    const sendFn = jest.fn().mockResolvedValue(undefined);
    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(sendFn).toHaveBeenCalledWith(expect.stringMatching(/erro|problema/i));
    expect(result.handled).toBe(true);
    expect(result.error).toMatch(/Anthropic timeout/);
  });

  it("retorna handled:true mesmo quando sendFn também falha", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5511999990001" }
    ]);
    mockRunLoop.mockRejectedValue(new Error("API error"));
    const sendFn = jest.fn().mockRejectedValue(new Error("send failed"));

    const result = await handleSecretaryMessage(makeCtx(), sendFn);

    expect(result.handled).toBe(true);
    expect(result.error).toBeDefined();
  });
});

describe("isSecretaryAdmin — fonte de verdade do roteamento (ticket #22)", () => {
  beforeEach(() => { jest.clearAllMocks(); clearSettingsCache(); });

  it("true para número admin, tolerando o 9º dígito (cadastro com 9, JID sem 9)", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5548988368758" }
    ]);
    expect(await isSecretaryAdmin(1, "554888368758@s.whatsapp.net")).toBe(true);
  });

  it("true quando cadastrado só com DDD + número (sem código de país)", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "48988368758" }
    ]);
    expect(await isSecretaryAdmin(1, "554888368758")).toBe(true);
  });

  it("false para número que não é admin", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([
      { key: "secretaryAdminNumbers", value: "5548988368758" }
    ]);
    expect(await isSecretaryAdmin(1, "5511000000000")).toBe(false);
  });

  it("false quando não há admins configurados", async () => {
    (Setting.findAll as jest.Mock).mockResolvedValue([]);
    expect(await isSecretaryAdmin(1, "554888368758")).toBe(false);
  });
});
