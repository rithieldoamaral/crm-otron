/**
 * Testes TDD para resolveCompanyId — escritos ANTES da implementação,
 * conforme CLAUDE.md seção II.1.
 *
 * CONTEXTO (auditoria de segurança 2026-07-27 — CLAUDE.md XV.3):
 *
 * Três controllers liam `companyId` da query string e o usavam sem
 * verificar quem estava pedindo:
 *
 *   - DashbardController.reportsUsers / reportsDay — usava direto o valor
 *     da query, sem sequer olhar para a sessão.
 *   - QueueController.index — `if (!isNil(queryCompanyId)) companyId = +queryCompanyId`
 *   - UserController.list — `companyId ? +companyId : userCompanyId`
 *
 * Nos três, o valor do cliente vencia o da sessão: qualquer usuário
 * autenticado lia dados de outra empresa trocando `?companyId=`.
 *
 * O acesso entre empresas NÃO pode simplesmente sumir: o painel de super
 * admin (CompaniesManager) chama `/users/list?companyId=X` de propósito.
 * Este helper preserva essa capacidade e a restringe a quem é super.
 */

import { Request } from "express";
import User from "../../models/User";
import resolveCompanyId from "../ResolveCompanyId";

jest.mock("../../models/User", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));

const mockedFindByPk = User.findByPk as jest.Mock;

const buildReq = (userId: string, companyId: number): Request =>
  ({ user: { id: userId, companyId, profile: "admin" } } as unknown as Request);

describe("resolveCompanyId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna a empresa da sessão quando nada é pedido", async () => {
    const result = await resolveCompanyId(buildReq("1", 7), undefined);

    expect(result).toBe(7);
    // Caminho comum: não pode custar uma consulta ao banco.
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });

  it("retorna a empresa da sessão quando o pedido é string vazia", async () => {
    const result = await resolveCompanyId(buildReq("1", 7), "");

    expect(result).toBe(7);
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });

  it("aceita quando o pedido é a própria empresa, sem consultar o banco", async () => {
    const result = await resolveCompanyId(buildReq("1", 7), "7");

    expect(result).toBe(7);
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });

  it("permite empresa diferente quando o usuário é super admin", async () => {
    mockedFindByPk.mockResolvedValue({ super: true });

    const result = await resolveCompanyId(buildReq("1", 7), "99");

    expect(result).toBe(99);
    expect(mockedFindByPk).toHaveBeenCalledWith("1");
  });

  it("BLOQUEIA empresa diferente quando o usuário NÃO é super admin (IDOR)", async () => {
    mockedFindByPk.mockResolvedValue({ super: false });

    await expect(
      resolveCompanyId(buildReq("1", 7), "99")
    ).rejects.toMatchObject({
      message: "ERR_NO_PERMISSION",
      statusCode: 403
    });
  });

  it("BLOQUEIA quando o usuário da sessão não existe mais no banco", async () => {
    // Conta apagada ou desativada com token ainda válido: negar é o
    // comportamento seguro (falha fechada, não aberta).
    mockedFindByPk.mockResolvedValue(null);

    await expect(
      resolveCompanyId(buildReq("1", 7), "99")
    ).rejects.toMatchObject({
      message: "ERR_NO_PERMISSION",
      statusCode: 403
    });
  });

  it("BLOQUEIA valor não-numérico em vez de virar NaN", async () => {
    // `+"1 OR 1=1"` é NaN. Sem esta checagem, NaN chegaria ao service e
    // ao banco como parâmetro inválido.
    await expect(
      resolveCompanyId(buildReq("1", 7), "1 OR 1=1--")
    ).rejects.toMatchObject({
      message: "ERR_INVALID_COMPANY_ID",
      statusCode: 400
    });

    expect(mockedFindByPk).not.toHaveBeenCalled();
  });

  it("aceita companyId numérico (não só string) vindo do controller", async () => {
    mockedFindByPk.mockResolvedValue({ super: true });

    const result = await resolveCompanyId(buildReq("1", 7), 42);

    expect(result).toBe(42);
  });
});
