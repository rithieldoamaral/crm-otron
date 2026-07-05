/**
 * Testes TDD para o wrapper de auto-invalidação de UserCalendar (ITEM B — Tier 3).
 *
 * Objetivo: centralizar (DRY) a detecção de token morto (invalid_grant /
 * insufficient authentication scopes) e a invalidação de UserCalendar.isActive
 * para TODAS as tools de calendário — não só criarEvento.
 */

jest.mock("../../../models/UserCalendar");
jest.mock("../../../utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import {
  isCalendarConnectionInvalid,
  executeWithCalendarErrorHandling
} from "../calendarApi";
import UserCalendar from "../../../models/UserCalendar";
import { logger } from "../../../utils/logger";

const mockUpdate = UserCalendar.update as jest.Mock;

describe("isCalendarConnectionInvalid", () => {
  it("retorna true para invalid_grant (case-insensitive)", () => {
    expect(isCalendarConnectionInvalid(new Error("invalid_grant: bad"))).toBe(true);
    expect(isCalendarConnectionInvalid(new Error("INVALID_GRANT"))).toBe(true);
  });

  it("retorna true para insufficient authentication scopes", () => {
    expect(
      isCalendarConnectionInvalid(new Error("Insufficient Authentication Scopes"))
    ).toBe(true);
  });

  it("retorna false para erros transitórios/genéricos", () => {
    expect(isCalendarConnectionInvalid(new Error("quota exceeded"))).toBe(false);
    expect(isCalendarConnectionInvalid(new Error("ECONNRESET"))).toBe(false);
    expect(isCalendarConnectionInvalid(new Error("invalid_client"))).toBe(false);
  });

  it("não lança com err nulo/sem message", () => {
    expect(isCalendarConnectionInvalid(null)).toBe(false);
    expect(isCalendarConnectionInvalid({})).toBe(false);
  });
});

describe("executeWithCalendarErrorHandling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue([1]);
  });

  it("retorna o resultado quando fn resolve (sem efeito colateral)", async () => {
    const result = await executeWithCalendarErrorHandling(
      async () => "ok",
      42,
      "teste"
    );
    expect(result).toBe("ok");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("invalida UserCalendar e repropaga em invalid_grant", async () => {
    const err = new Error("invalid_grant");
    await expect(
      executeWithCalendarErrorHandling(async () => { throw err; }, 7, "verificar_disponibilidade")
    ).rejects.toThrow("invalid_grant");

    expect(mockUpdate).toHaveBeenCalledWith(
      { isActive: false },
      { where: { id: 7 } }
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it("NÃO invalida e repropaga em erro transitório", async () => {
    const err = new Error("network timeout");
    await expect(
      executeWithCalendarErrorHandling(async () => { throw err; }, 7, "teste")
    ).rejects.toThrow("network timeout");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("token inválido sem userCalendarId: loga warn, não chama update, repropaga", async () => {
    const err = new Error("insufficient authentication scopes");
    await expect(
      executeWithCalendarErrorHandling(async () => { throw err; }, undefined, "teste")
    ).rejects.toThrow(err);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falha ao persistir invalidação é logada e NÃO mascara o erro original", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("db down"));
    const err = new Error("invalid_grant");
    await expect(
      executeWithCalendarErrorHandling(async () => { throw err; }, 9, "teste")
    ).rejects.toThrow("invalid_grant"); // erro original, não "db down"
    expect(logger.error).toHaveBeenCalled();
  });
});
