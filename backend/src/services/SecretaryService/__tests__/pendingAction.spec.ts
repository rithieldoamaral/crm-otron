/**
 * Testes TDD para pendingAction.
 * Cobre helpers de Redis e classificadores de intenção (confirm/cancel).
 */

jest.mock("../../../libs/cache", () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import {
  savePendingAction,
  loadPendingAction,
  clearPendingAction,
  isConfirmation,
  isCancellation,
  pendingActionKey,
  PENDING_ACTION_TTL,
  PendingAction,
} from "../pendingAction";
import * as cache from "../../../libs/cache";

const mockSet = cache.set as jest.Mock;
const mockGet = cache.get as jest.Mock;
const mockDel = cache.del as jest.Mock;

const COMPANY_ID    = 1;
const SENDER_NUMBER = "5511999990001";

const ACTION: PendingAction = {
  type: "enviar_mensagem",
  ticketId: 42,
  body: "Seu pedido chegou! Pode vir buscar.",
  contactName: "Carlos Silva",
};

// ── pendingActionKey ─────────────────────────────────────────────────────────

describe("pendingActionKey", () => {
  it("inclui companyId e senderNumber na chave", () => {
    const key = pendingActionKey(5, "5511999990001");
    expect(key).toContain("5");
    expect(key).toContain("5511999990001");
    expect(key).toMatch(/secretary:pending/);
  });

  it("chaves diferentes para companies diferentes", () => {
    expect(pendingActionKey(1, "5511999990001")).not.toBe(pendingActionKey(2, "5511999990001"));
  });

  it("chaves diferentes para senders diferentes", () => {
    expect(pendingActionKey(1, "5511111110001")).not.toBe(pendingActionKey(1, "5511111110002"));
  });
});

// ── savePendingAction ────────────────────────────────────────────────────────

describe("savePendingAction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("grava a ação no Redis com TTL correto", async () => {
    await savePendingAction(COMPANY_ID, SENDER_NUMBER, ACTION);

    expect(mockSet).toHaveBeenCalledWith(
      pendingActionKey(COMPANY_ID, SENDER_NUMBER),
      JSON.stringify(ACTION),
      "EX",
      PENDING_ACTION_TTL
    );
  });

  it("TTL é de 600 segundos (10 minutos)", () => {
    expect(PENDING_ACTION_TTL).toBe(600);
  });

  it("usa a chave correta com companyId e senderNumber", async () => {
    await savePendingAction(77, "5511000000001", ACTION);

    expect(mockSet).toHaveBeenCalledWith(
      pendingActionKey(77, "5511000000001"),
      expect.any(String),
      "EX",
      PENDING_ACTION_TTL
    );
  });
});

// ── loadPendingAction ────────────────────────────────────────────────────────

describe("loadPendingAction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("retorna a ação quando existe no Redis", async () => {
    mockGet.mockResolvedValue(JSON.stringify(ACTION));

    const result = await loadPendingAction(COMPANY_ID, SENDER_NUMBER);

    expect(result).toEqual(ACTION);
  });

  it("retorna null quando Redis não tem a chave", async () => {
    mockGet.mockResolvedValue(null);

    const result = await loadPendingAction(COMPANY_ID, SENDER_NUMBER);

    expect(result).toBeNull();
  });

  it("retorna null quando JSON inválido (não lança exceção)", async () => {
    mockGet.mockResolvedValue("invalid-json{{{");

    const result = await loadPendingAction(COMPANY_ID, SENDER_NUMBER);

    expect(result).toBeNull();
  });

  it("retorna null quando Redis lança exceção (não propaga)", async () => {
    mockGet.mockRejectedValue(new Error("Redis offline"));

    const result = await loadPendingAction(COMPANY_ID, SENDER_NUMBER);

    expect(result).toBeNull();
  });
});

// ── clearPendingAction ───────────────────────────────────────────────────────

describe("clearPendingAction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deleta a chave correta do Redis", async () => {
    await clearPendingAction(COMPANY_ID, SENDER_NUMBER);

    expect(mockDel).toHaveBeenCalledWith(pendingActionKey(COMPANY_ID, SENDER_NUMBER));
  });

  it("não lança exceção quando del falha (key expirou)", async () => {
    mockDel.mockRejectedValue(new Error("Redis error"));

    await expect(clearPendingAction(COMPANY_ID, SENDER_NUMBER)).resolves.not.toThrow();
  });
});

// ── isConfirmation ───────────────────────────────────────────────────────────

describe("isConfirmation", () => {
  it.each([
    ["sim"],
    ["Sim"],
    ["SIM"],
    ["pode"],
    ["ok"],
    ["confirma"],
    ["manda"],
    ["envia"],
    ["isso"],
    ["vai"],
    ["certo"],
  ])('retorna true para "%s"', (msg) => {
    expect(isConfirmation(msg)).toBe(true);
  });

  it.each([
    ["não"],
    ["nao"],
    ["cancela"],
    ["na verdade não"],
    ["preciso de ajuda"],
    ["quero ver outra coisa"],
    [""],
  ])('retorna false para "%s"', (msg) => {
    expect(isConfirmation(msg)).toBe(false);
  });

  it("ignora espaços em branco no início/fim", () => {
    expect(isConfirmation("  sim  ")).toBe(true);
  });
});

// ── isCancellation ───────────────────────────────────────────────────────────

describe("isCancellation", () => {
  it.each([
    ["não"],
    ["nao"],
    ["Não"],
    ["NAO"],
    ["cancela"],
    ["para"],
    ["pare"],
    ["desiste"],
    ["esquece"],
    ["esqueça"],
    ["abort"],
  ])('retorna true para "%s"', (msg) => {
    expect(isCancellation(msg)).toBe(true);
  });

  it.each([
    ["sim"],
    ["ok"],
    ["manda"],
    ["preciso de outra coisa"],
    [""],
  ])('retorna false para "%s"', (msg) => {
    expect(isCancellation(msg)).toBe(false);
  });

  it("ignora espaços em branco no início/fim", () => {
    expect(isCancellation("  não  ")).toBe(true);
  });
});
