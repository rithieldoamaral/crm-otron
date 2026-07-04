/**
 * Testes TDD para ScheduleServices/ListService.
 *
 * Bug #26 (Round 10): ListService não filtrava status=CANCELADO.
 * Resultado: agendamentos cancelados apareciam no calendário da aplicação
 * mesmo após o bot confirmar o cancelamento. O usuário precisava contornar
 * isso deletando manualmente pelo CRM.
 *
 * Fix: adicionar status: { [Op.notIn]: ["CANCELADO"] } ao whereCondition.
 */

jest.mock("../../../models/Schedule");
jest.mock("../../../models/Contact");
jest.mock("../../../models/User");
jest.mock("../../../models/Service");

import { Op } from "sequelize";
import Schedule from "../../../models/Schedule";
import ListService from "../ListService";

const mockFindAndCountAll = Schedule.findAndCountAll as jest.Mock;

const COMPANY_ID = 2;

function makeSchedule(id: number, status: string) {
  return {
    id,
    status,
    companyId: COMPANY_ID,
    body: `Agendamento #${id}`,
    sendAt: new Date("2099-06-15T13:00:00Z"),
    contact: { id: 1, name: "Cliente Teste" },
    user: { id: 2, name: "Profissional" },
    service: { id: 1, name: "Serviço", durationMinutes: 60 },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Bug #26: status CANCELADO não deve aparecer no calendário ────────────────

test("[Bug #26] a query inclui filtro Op.notIn para CANCELADO", async () => {
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

  await ListService({ companyId: COMPANY_ID });

  const callArgs = mockFindAndCountAll.mock.calls[0][0];
  const where = callArgs.where;

  // Op.notIn é um Symbol — não aparece no JSON.stringify.
  // Verificamos o objeto diretamente usando o operador importado do sequelize.
  // where.status deve ser { [Op.notIn]: ["CANCELADO"] }
  expect(where.status).toBeDefined();
  const exclusionList: string[] = where.status[Op.notIn];
  expect(exclusionList).toContain("CANCELADO");
});

test("[Bug #26] não retorna schedules com status CANCELADO", async () => {
  // Simula: DB retorna mistura de ativos e cancelados
  const pendente = makeSchedule(1, "PENDENTE");
  const cancelado = makeSchedule(2, "CANCELADO");
  const enviada = makeSchedule(3, "ENVIADA");

  // ListService passa o whereCondition ao Sequelize — o Sequelize filtra.
  // Como mockamos findAndCountAll, verificamos o filtro via Symbol (Op.notIn)
  // e simulamos o comportamento do banco retornando só os ativos quando
  // o filtro está correto.
  mockFindAndCountAll.mockImplementation(({ where }) => {
    // Op.notIn é Symbol — acessamos via chave direta
    const statusFilter = where.status;
    const hasCANCELADOFilter =
      statusFilter &&
      Array.isArray(statusFilter[Op.notIn]) &&
      statusFilter[Op.notIn].includes("CANCELADO");

    if (!hasCANCELADOFilter) {
      // Sem filtro: retorna tudo (comportamento errado — testa a regressão)
      return Promise.resolve({ count: 3, rows: [pendente, cancelado, enviada] });
    }
    // Com filtro correto: BD filtra e retorna só ativos
    return Promise.resolve({ count: 2, rows: [pendente, enviada] });
  });

  const { schedules } = await ListService({ companyId: COMPANY_ID });

  const ids = schedules.map((s: any) => s.id);
  expect(ids).not.toContain(2); // cancelado não deve aparecer
  expect(ids).toContain(1); // pendente deve aparecer
  expect(ids).toContain(3); // enviada deve aparecer
});

test("[Bug #26] retorna schedules PENDENTE normalmente", async () => {
  const pendente = makeSchedule(10, "PENDENTE");
  mockFindAndCountAll.mockResolvedValue({ count: 1, rows: [pendente] });

  const { schedules } = await ListService({ companyId: COMPANY_ID });

  expect(schedules).toHaveLength(1);
  expect((schedules[0] as any).status).toBe("PENDENTE");
});

test("[Bug #26] retorna schedules ENVIADA normalmente", async () => {
  const enviada = makeSchedule(11, "ENVIADA");
  mockFindAndCountAll.mockResolvedValue({ count: 1, rows: [enviada] });

  const { schedules } = await ListService({ companyId: COMPANY_ID });

  expect(schedules).toHaveLength(1);
  expect((schedules[0] as any).status).toBe("ENVIADA");
});

// ─── Filtros existentes continuam funcionando ─────────────────────────────────

test("filtro por professionalId continua funcionando", async () => {
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

  await ListService({ companyId: COMPANY_ID, professionalId: 5 });

  const callArgs = mockFindAndCountAll.mock.calls[0][0];
  expect(JSON.stringify(callArgs.where)).toContain("professionalId");
});

test("filtro por serviceId continua funcionando", async () => {
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

  await ListService({ companyId: COMPANY_ID, serviceId: 3 });

  const callArgs = mockFindAndCountAll.mock.calls[0][0];
  expect(JSON.stringify(callArgs.where)).toContain("serviceId");
});

test("paginação respeita pageNumber", async () => {
  mockFindAndCountAll.mockResolvedValue({ count: 0, rows: [] });

  await ListService({ companyId: COMPANY_ID, pageNumber: 3 });

  const callArgs = mockFindAndCountAll.mock.calls[0][0];
  // page 3 → offset = 20 * (3-1) = 40
  expect(callArgs.offset).toBe(40);
});

test("retorna hasMore=true quando há mais itens que o limite", async () => {
  const rows = Array.from({ length: 20 }, (_, i) => makeSchedule(i + 1, "PENDENTE"));
  mockFindAndCountAll.mockResolvedValue({ count: 25, rows });

  const { hasMore } = await ListService({ companyId: COMPANY_ID });

  expect(hasMore).toBe(true);
});

test("retorna hasMore=false quando não há mais itens", async () => {
  const rows = [makeSchedule(1, "PENDENTE")];
  mockFindAndCountAll.mockResolvedValue({ count: 1, rows });

  const { hasMore } = await ListService({ companyId: COMPANY_ID });

  expect(hasMore).toBe(false);
});
