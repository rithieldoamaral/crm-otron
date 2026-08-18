/**
 * Testes TDD para ReportsController — escritos ANTES da correção,
 * conforme CLAUDE.md seção II.1.
 *
 * CONTEXTO (auditoria de segurança 2026-07-27, CLAUDE.md Seção XV):
 *
 * O controller tinha DUAS falhas na mesma linha de código:
 *
 * 1. IDOR / quebra de isolamento multi-tenant (XV.3)
 *    `companyId` era lido de `req.query`, não de `req.user`. As rotas usam
 *    apenas `isAuth`, então qualquer usuário autenticado de qualquer empresa
 *    lia os relatórios de outra empresa trocando `?companyId=`.
 *
 * 2. SQL injection (XV.4)
 *    `companyId`, `initialDate` e `finalDate` eram interpolados direto na
 *    string SQL via template literal. `?companyId=1 OR 1=1--` já vazava a
 *    base inteira, sem precisar escapar aspas.
 *
 * Estes testes travam os dois comportamentos.
 */

import { Request, Response } from "express";

import sequelize from "../../database";
import {
  appointmentsAtendent,
  rushHour,
  departamentRatings
} from "../ReportsController";

jest.mock("../../database", () => ({
  __esModule: true,
  default: { query: jest.fn() }
}));

jest.mock("../../services/SecretaryService/tools/relatorioAgente", () => ({
  relatorioAgente: jest.fn()
}));

jest.mock("../../utils/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const mockedQuery = sequelize.query as jest.Mock;

/** Monta um req fake com a empresa da SESSÃO separada da query string. */
const buildReq = (
  sessionCompanyId: number,
  query: Record<string, string>
): Request =>
  ({
    user: { id: 1, companyId: sessionCompanyId, profile: "admin" },
    query
  } as unknown as Request);

const buildRes = (): Response => {
  const res = {} as Response;
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
};

/** Concatena todas as strings SQL passadas ao sequelize nesta chamada. */
const allSqlText = (): string =>
  mockedQuery.mock.calls.map(call => String(call[0])).join("\n");

/** Junta os `replacements` de todas as queries executadas. */
const allReplacements = (): Record<string, unknown> =>
  mockedQuery.mock.calls.reduce(
    (acc, call) => ({ ...acc, ...((call[1] || {}).replacements || {}) }),
    {}
  );

describe("ReportsController — isolamento multi-tenant e SQL injection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuery.mockResolvedValue([]);
  });

  describe.each([
    ["appointmentsAtendent", appointmentsAtendent],
    ["rushHour", rushHour],
    ["departamentRatings", departamentRatings]
  ])("%s", (_nome, handler) => {
    it("usa o companyId da SESSÃO e ignora o da query string (IDOR — XV.3)", async () => {
      // Sessão pertence à empresa 7; atacante pede dados da empresa 99.
      const req = buildReq(7, {
        companyId: "99",
        initialDate: "2026-01-01",
        finalDate: "2026-01-31"
      });

      await handler(req, buildRes());

      expect(mockedQuery).toHaveBeenCalled();
      const replacements = allReplacements();

      // A empresa consultada tem que ser a da sessão, nunca a da query.
      expect(replacements.companyId).toBe(7);
      expect(replacements.companyId).not.toBe(99);
      expect(replacements.companyId).not.toBe("99");

      // E o 99 não pode ter entrado no SQL por nenhum outro caminho.
      expect(allSqlText()).not.toContain("99");
    });

    // Defesa em profundidade: duas camadas independentes protegem contra
    // SQLi nas datas. A validação barra o payload na porta; a
    // parametrização garante que, mesmo que a validação um dia afrouxe,
    // o valor nunca vira código SQL. Cada camada tem seu teste.

    it("CAMADA 1 — barra payload de SQLi na validação de data (XV.4)", async () => {
      const payload = "2026-01-01' OR '1'='1";
      const req = buildReq(7, {
        initialDate: payload,
        finalDate: "2026-01-31"
      });

      await expect(handler(req, buildRes())).rejects.toMatchObject({
        message: "ERR_INVALID_REPORT_DATE",
        statusCode: 400
      });

      // Rejeitado antes de tocar o banco.
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it("CAMADA 2 — datas válidas viajam como replacements, nunca no texto do SQL (XV.4)", async () => {
      const req = buildReq(7, {
        initialDate: "2026-01-01",
        finalDate: "2026-01-31"
      });

      await handler(req, buildRes());

      const replacements = allReplacements();
      expect(replacements.initialDate).toBe("2026-01-01");
      expect(replacements.finalDate).toBe("2026-01-31");

      // As datas NÃO podem estar concatenadas no texto da query: o SQL
      // precisa conter os placeholders nomeados do Sequelize.
      expect(allSqlText()).not.toContain("2026-01-01");
      expect(allSqlText()).not.toContain("2026-01-31");
      expect(allSqlText()).toContain(":initialDate");
      expect(allSqlText()).toContain(":finalDate");
      expect(allSqlText()).toContain(":companyId");
    });

    it("recusa o clássico `1 OR 1=1` no companyId da query (XV.3)", async () => {
      const req = buildReq(7, {
        companyId: "1 OR 1=1--",
        initialDate: "2026-01-01",
        finalDate: "2026-01-31"
      });

      await handler(req, buildRes());

      // Como o companyId agora vem da sessão, o payload é simplesmente
      // descartado — nunca chega ao banco.
      expect(allSqlText()).not.toContain("OR 1=1");
      expect(allReplacements().companyId).toBe(7);
    });

    it("rejeita data em formato inválido com 400 (XV.4 — validação de entrada)", async () => {
      const req = buildReq(7, {
        initialDate: "não-é-data",
        finalDate: "2026-01-31"
      });

      await expect(handler(req, buildRes())).rejects.toMatchObject({
        message: "ERR_INVALID_REPORT_DATE",
        statusCode: 400
      });

      // Falhou na validação: nada pode ter ido ao banco.
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it("rejeita quando faltam as datas obrigatórias", async () => {
      const req = buildReq(7, {});

      await expect(handler(req, buildRes())).rejects.toMatchObject({
        message: "ERR_MISSING_REPORT_PARAMS",
        statusCode: 400
      });

      expect(mockedQuery).not.toHaveBeenCalled();
    });
  });
});
