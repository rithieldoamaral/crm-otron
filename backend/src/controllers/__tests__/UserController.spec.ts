/**
 * Testes TDD para instrumentação de auditoria (dbLog) no CRUD de usuários.
 * Ver contexto completo em SessionController.spec.ts.
 */

jest.mock("../../helpers/CheckSettings", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/CreateUserService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/ListUsersService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/UpdateUserService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/ShowUserService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/DeleteUserService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/UserServices/SimpleListService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../models/User");
jest.mock("../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../services/SystemLogService/dbLogger", () => {
  const actual = jest.requireActual("../../services/SystemLogService/dbLogger");
  return { ...actual, dbLog: jest.fn() };
});

import { store, update, remove } from "../UserController";
import CreateUserService from "../../services/UserServices/CreateUserService";
import UpdateUserService from "../../services/UserServices/UpdateUserService";
import DeleteUserService from "../../services/UserServices/DeleteUserService";
import User from "../../models/User";
import { dbLog, LOG_ACTIONS } from "../../services/SystemLogService/dbLogger";

const mockCreate = CreateUserService as jest.Mock;
const mockUpdate = UpdateUserService as jest.Mock;
const mockDelete = DeleteUserService as jest.Mock;
const mockUserFindByPk = User.findByPk as jest.Mock;
const mockDbLog = dbLog as jest.Mock;

const buildRes = () => {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe("UserController — auditoria de CRUD de usuários", () => {
  it("store(): registra user.created", async () => {
    mockUserFindByPk.mockResolvedValue({ super: true });
    mockCreate.mockResolvedValue({ id: 10, email: "novo@x.com" });
    const req: any = {
      body: { email: "novo@x.com", password: "x", name: "Novo", profile: "user" },
      user: { id: 1, companyId: 2, profile: "admin" },
      url: "/users",
      ip: "1.1.1.1", headers: {}
    };

    await store(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.USER_CREATED,
        companyId: 2,
        userId: 1,
        entity: "User",
        entityId: 10
      })
    );
  });

  it("update(): registra user.updated", async () => {
    mockUpdate.mockResolvedValue({ id: 10, email: "editado@x.com" });
    const req: any = {
      body: { name: "Editado" },
      params: { userId: "10" },
      user: { id: 1, companyId: 2 },
      ip: "1.1.1.1", headers: {}
    };

    await update(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.USER_UPDATED,
        companyId: 2,
        userId: 1,
        entity: "User",
        entityId: 10
      })
    );
  });

  it("remove(): registra user.deleted", async () => {
    mockDelete.mockResolvedValue(undefined);
    const req: any = {
      params: { userId: "10" },
      user: { id: 1, companyId: 2, profile: "admin" },
      ip: "1.1.1.1", headers: {}
    };

    await remove(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.USER_DELETED,
        companyId: 2,
        userId: 1,
        entity: "User",
        entityId: 10
      })
    );
  });
});
