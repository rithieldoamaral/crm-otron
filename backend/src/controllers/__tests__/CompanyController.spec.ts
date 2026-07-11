/**
 * Testes TDD para instrumentação de auditoria (dbLog) no CRUD de empresas
 * (super admin). Ver contexto completo em SessionController.spec.ts.
 */

jest.mock("../../services/CompanyService/CreateCompanyService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/DeleteCompanyService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/FindAllCompaniesService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/ListCompaniesPlanService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/ListCompaniesService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/ShowCompanyService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/ShowPlanCompanyService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/UpdateCompanyService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/CompanyService/UpdateSchedulesService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../models/User");
jest.mock("../../models/Company");
jest.mock("fs");
// CompanyController.ts importa config/auth.ts diretamente; sem mock, o valor
// real lança em runtime se JWT_SECRET não estiver no ambiente do test runner.
jest.mock("../../config/auth", () => ({
  __esModule: true,
  default: { secret: "test-secret", expiresIn: "15m", refreshSecret: "test-refresh", refreshExpiresIn: "7d" }
}));
jest.mock("../../services/SystemLogService/dbLogger", () => {
  const actual = jest.requireActual("../../services/SystemLogService/dbLogger");
  return { ...actual, dbLog: jest.fn() };
});

import { store, update, remove } from "../CompanyController";
import CreateCompanyService from "../../services/CompanyService/CreateCompanyService";
import UpdateCompanyService from "../../services/CompanyService/UpdateCompanyService";
import DeleteCompanyService from "../../services/CompanyService/DeleteCompanyService";
import User from "../../models/User";
import fs from "fs";
import { dbLog, LOG_ACTIONS } from "../../services/SystemLogService/dbLogger";

const mockCreate = CreateCompanyService as jest.Mock;
const mockUpdate = UpdateCompanyService as jest.Mock;
const mockDelete = DeleteCompanyService as jest.Mock;
const mockUserFindByPk = User.findByPk as jest.Mock;
const mockDbLog = dbLog as jest.Mock;

const buildRes = () => {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  (fs.existsSync as jest.Mock).mockReturnValue(false);
});

describe("CompanyController — auditoria de CRUD de empresas (super admin)", () => {
  it("store(): registra company.created", async () => {
    mockCreate.mockResolvedValue({ id: 5, name: "Nova Empresa" });
    const req: any = { body: { name: "Nova Empresa" }, user: { id: 1 }, ip: "1.1.1.1", headers: {} };

    await store(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.COMPANY_CREATED,
        userId: 1,
        entity: "Company",
        entityId: 5
      })
    );
  });

  it("update(): registra company.updated", async () => {
    mockUpdate.mockResolvedValue({ id: 5, name: "Empresa Editada" });
    const req: any = { body: { name: "Empresa Editada" }, params: { id: "5" }, user: { id: 1 }, ip: "1.1.1.1", headers: {} };

    await update(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.COMPANY_UPDATED,
        userId: 1,
        entity: "Company",
        entityId: 5
      })
    );
  });

  it("remove(): registra company.deleted (só super)", async () => {
    mockUserFindByPk.mockResolvedValue({ super: true });
    mockDelete.mockResolvedValue({ id: 5 });
    const req: any = { params: { id: "5" }, user: { id: 1 }, ip: "1.1.1.1", headers: {} };

    await remove(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.COMPANY_DELETED,
        userId: 1,
        entity: "Company",
        entityId: 5
      })
    );
  });
});
