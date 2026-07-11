/**
 * Testes TDD para instrumentação de auditoria (dbLog) no login/logout.
 *
 * Causa-raiz (2026-07-11): `dbLog()` existia com uma interface completa e
 * constantes `LOG_ACTIONS` prontas, mas NUNCA era chamado em nenhum ponto real
 * do app (confirmado via grep — zero call sites fora da própria definição).
 * Por isso a tela "Logs de Auditoria" sempre mostrava vazio, para QUALQUER
 * empresa, não só a que o usuário testava. Este spec fixa o contrato: login e
 * logout devem gerar um evento de auditoria.
 */

// Mocks com FACTORY (não bare `jest.mock(path)`): um mock automático ainda
// exige o módulo real para introspectar seu shape, e AuthUserService importa
// (via helpers/CreateTokens) config/auth.ts, que LANÇA em runtime se
// JWT_SECRET não estiver no ambiente do test runner. Factory evita o require.
jest.mock("../../services/UserServices/AuthUserService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../helpers/SendRefreshToken", () => ({ SendRefreshToken: jest.fn() }));
jest.mock("../../services/AuthServices/RefreshTokenService", () => ({ RefreshTokenService: jest.fn() }));
jest.mock("../../services/AuthServices/FindUserFromToken", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../models/User", () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock("../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../services/SystemLogService/dbLogger", () => {
  const actual = jest.requireActual("../../services/SystemLogService/dbLogger");
  return { ...actual, dbLog: jest.fn() };
});

import { store, remove } from "../SessionController";
import AuthUserService from "../../services/UserServices/AuthUserService";
import User from "../../models/User";
import { dbLog, LOG_ACTIONS } from "../../services/SystemLogService/dbLogger";

const mockAuth = AuthUserService as jest.Mock;
const mockDbLog = dbLog as jest.Mock;
const mockUserFindByPk = User.findByPk as jest.Mock;

const buildRes = () => {
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    clearCookie: jest.fn(),
    send: jest.fn()
  };
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe("SessionController.store — auditoria de login", () => {
  it("registra user.login com companyId e userId após autenticar", async () => {
    mockAuth.mockResolvedValue({
      token: "tok",
      refreshToken: "reftok",
      serializedUser: { id: 7, email: "a@a.com", companyId: 2 }
    });
    const req: any = { body: { email: "a@a.com", password: "x" }, ip: "1.2.3.4", headers: {} };
    const res = buildRes();

    await store(req, res);

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.USER_LOGIN,
        companyId: 2,
        userId: 7,
        entity: "User",
        entityId: 7
      })
    );
  });
});

describe("SessionController.remove — auditoria de logout", () => {
  it("registra user.logout com companyId e userId", async () => {
    mockUserFindByPk.mockResolvedValue({ update: jest.fn().mockResolvedValue(undefined) });
    const req: any = { user: { id: 7, companyId: 2 }, ip: "1.2.3.4", headers: {} };
    const res = buildRes();

    await remove(req, res);

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.USER_LOGOUT,
        companyId: 2,
        userId: 7,
        entity: "User",
        entityId: 7
      })
    );
  });
});
