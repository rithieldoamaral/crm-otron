/**
 * Testes unitários — ServiceCatalogService I/O (createService, updateService, listServices)
 *
 * Cobre a lógica de professional assignment adicionada na unificação UX (2026-05-24):
 *   - createService com professionalIds → cria ServiceProfessional em transação
 *   - createService sem professionalIds → não cria ServiceProfessional
 *   - updateService com professionalIds → substitui associações em transação
 *   - updateService sem professionalIds → não toca ServiceProfessional
 *   - listServices → inclui serviceProfessionals na query
 *   - cross-company guard → lança 403 se userId não pertence à empresa
 *
 * TDD: testes escritos ANTES da implementação — conforme CLAUDE.md §II.1.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("../../../models/Service");
jest.mock("../../../models/ServiceProfessional");
jest.mock("../../../models/User");
jest.mock("../../../database", () => ({
  /**
   * __esModule: true é obrigatório para que o TypeScript não aplique double-wrap via
   * __importDefault. Sem essa flag, `import sequelize from "../../database"` resulta em
   * `database_1.default = { default: { transaction: fn } }` e a chamada falha com
   * "transaction is not a function".
   */
  __esModule: true,
  default: {
    /**
     * Pass-through mock: executa o callback com um objeto de transação vazio.
     * Permite que `await sequelize.transaction(async (t) => { ... })` funcione
     * em testes sem DB real.
     */
    transaction: jest.fn((cb: (t: object) => Promise<unknown>) => cb({})),
  },
}));

import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import User from "../../../models/User";
import {
  createService,
  updateService,
  listServices,
} from "../index";

const mockService = Service as jest.Mocked<typeof Service>;
const mockServiceProfessional = ServiceProfessional as jest.Mocked<typeof ServiceProfessional>;
const mockUser = User as jest.Mocked<typeof User>;

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeService = (overrides = {}) => ({
  id: 1,
  name: "Corte Feminino",
  durationMinutes: 60,
  price: "40.00",
  category: "Corte",
  companyId: 5,
  isActive: true,
  description: "",
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// ── createService ────────────────────────────────────────────────────────────

describe("createService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("cria serviço sem profissionais quando professionalIds não é passado", async () => {
    const created = makeService();
    (mockService.create as jest.Mock).mockResolvedValue(created);

    const result = await createService({
      companyId: 5,
      name: "Corte Feminino",
      durationMinutes: 60,
    });

    expect(mockService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Corte Feminino", companyId: 5 }),
      expect.any(Object)
    );
    expect(mockServiceProfessional.bulkCreate).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });

  it("cria serviço com professionalIds → chama bulkCreate em transação", async () => {
    const created = makeService({ id: 7 });
    (mockService.create as jest.Mock).mockResolvedValue(created);
    (mockUser.count as jest.Mock).mockResolvedValue(2); // 2 users pertencem à empresa
    (mockServiceProfessional.bulkCreate as jest.Mock).mockResolvedValue([]);

    await createService({
      companyId: 5,
      name: "Corte Feminino",
      professionalIds: [10, 20],
    });

    expect(mockServiceProfessional.bulkCreate).toHaveBeenCalledWith(
      [
        { serviceId: 7, userId: 10, companyId: 5 },
        { serviceId: 7, userId: 20, companyId: 5 },
      ],
      expect.any(Object)
    );
  });

  it("lança 403 quando professionalId não pertence à empresa", async () => {
    (mockUser.count as jest.Mock).mockResolvedValue(1); // 1 de 2 → cross-company

    await expect(
      createService({
        companyId: 5,
        name: "Corte",
        professionalIds: [10, 99], // 99 é de outra empresa
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockService.create).not.toHaveBeenCalled();
  });

  it("lança erro se name estiver vazio", async () => {
    await expect(
      createService({ companyId: 5, name: "  " })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── updateService ────────────────────────────────────────────────────────────

describe("updateService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("atualiza serviço sem tocar profissionais quando professionalIds é undefined", async () => {
    const service = makeService();
    // findServiceById chama Service.findOne (2x: antes e depois do update para recarregar)
    (mockService.findOne as jest.Mock).mockResolvedValue(service);

    await updateService(1, { name: "Novo Nome" }, 5);

    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Novo Nome" }),
      expect.any(Object)
    );
    expect(mockServiceProfessional.destroy).not.toHaveBeenCalled();
    expect(mockServiceProfessional.bulkCreate).not.toHaveBeenCalled();
  });

  it("substitui profissionais quando professionalIds é array vazio (remove todos)", async () => {
    const service = makeService();
    (mockService.findOne as jest.Mock).mockResolvedValue(service);
    (mockServiceProfessional.destroy as jest.Mock).mockResolvedValue(1);

    await updateService(1, { professionalIds: [] }, 5);

    expect(mockServiceProfessional.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serviceId: 1, companyId: 5 } })
    );
    expect(mockServiceProfessional.bulkCreate).not.toHaveBeenCalled();
  });

  it("substitui profissionais quando professionalIds tem valores", async () => {
    const service = makeService();
    (mockService.findOne as jest.Mock).mockResolvedValue(service);
    (mockUser.count as jest.Mock).mockResolvedValue(2);
    (mockServiceProfessional.destroy as jest.Mock).mockResolvedValue(1);
    (mockServiceProfessional.bulkCreate as jest.Mock).mockResolvedValue([]);

    await updateService(1, { professionalIds: [10, 20] }, 5);

    expect(mockServiceProfessional.destroy).toHaveBeenCalled();
    expect(mockServiceProfessional.bulkCreate).toHaveBeenCalledWith(
      [
        { serviceId: 1, userId: 10, companyId: 5 },
        { serviceId: 1, userId: 20, companyId: 5 },
      ],
      expect.any(Object)
    );
  });

  it("lança 404 quando serviço não existe", async () => {
    (mockService.findOne as jest.Mock).mockResolvedValue(null);

    await expect(updateService(999, { name: "X" }, 5)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("lança 403 quando professionalId cross-company", async () => {
    const service = makeService();
    (mockService.findOne as jest.Mock).mockResolvedValue(service);
    (mockUser.count as jest.Mock).mockResolvedValue(0); // nenhum pertence

    await expect(
      updateService(1, { professionalIds: [99] }, 5)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── listServices ─────────────────────────────────────────────────────────────

describe("listServices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("inclui serviceProfessionals (com user) na query", async () => {
    (mockService.findAll as jest.Mock).mockResolvedValue([]);

    await listServices({ companyId: 5 });

    expect(mockService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.arrayContaining([
          expect.objectContaining({ as: "serviceProfessionals" }),
        ]),
      })
    );
  });

  it("filtra somente ativos por default", async () => {
    (mockService.findAll as jest.Mock).mockResolvedValue([]);

    await listServices({ companyId: 5 });

    expect(mockService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });

  it("inclui inativos quando includeInactive=true", async () => {
    (mockService.findAll as jest.Mock).mockResolvedValue([]);

    await listServices({ companyId: 5, includeInactive: true });

    const call = (mockService.findAll as jest.Mock).mock.calls[0][0];
    // isActive não deve estar no where quando includeInactive=true
    expect(call.where).not.toHaveProperty("isActive");
  });
});
