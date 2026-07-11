/**
 * Testes TDD para instrumentação de auditoria (dbLog) na atualização de Settings.
 * Ver contexto completo em SessionController.spec.ts.
 */

jest.mock("../../services/SettingServices/UpdateSettingService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/SettingServices/ListSettingsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/SettingServices/ShowSettingsService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../services/AgentService/settingsCache", () => ({ invalidateCompanyCache: jest.fn() }));
jest.mock("../../models/User");
jest.mock("../../models/Company");
jest.mock("../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));
jest.mock("../../services/SystemLogService/dbLogger", () => {
  const actual = jest.requireActual("../../services/SystemLogService/dbLogger");
  return { ...actual, dbLog: jest.fn() };
});

import { update } from "../SettingController";
import UpdateSettingService from "../../services/SettingServices/UpdateSettingService";
import { dbLog, LOG_ACTIONS } from "../../services/SystemLogService/dbLogger";

const mockUpdateSetting = UpdateSettingService as jest.Mock;
const mockDbLog = dbLog as jest.Mock;

const buildRes = () => {
  const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe("SettingController.update — auditoria", () => {
  it("registra setting.updated com a key alterada em details", async () => {
    mockUpdateSetting.mockResolvedValue({ key: "agentHours", value: "8h-22h" });
    const req: any = {
      params: { settingKey: "agentHours" },
      body: { value: "8h-22h" },
      user: { id: 1, companyId: 2, profile: "admin" },
      ip: "1.1.1.1", headers: {}
    };

    await update(req, buildRes());

    expect(mockDbLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: LOG_ACTIONS.SETTING_UPDATED,
        companyId: 2,
        userId: 1,
        entity: "Setting",
        details: expect.objectContaining({ key: "agentHours" })
      })
    );
  });
});
