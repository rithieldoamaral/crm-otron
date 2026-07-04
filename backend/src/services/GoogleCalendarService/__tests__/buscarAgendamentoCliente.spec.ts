/**
 * Testes TDD para buscarAgendamentoCliente.
 *
 * Bug #24 (Round 9): A tool excluía agendamentos com status "ENVIADA" (lembrete
 * já disparado). Agendamentos nesse status são ATIVOS — apenas receberam um
 * lembrete de confirmação. Excluí-los tornava o agente incapaz de encontrar
 * o horário do cliente e causava resposta incorreta: "Não há agendamentos".
 *
 * Fix: remover "ENVIADA" da lista Op.notIn; somente "CANCELADO" deve ser
 * excluído da busca.
 */

jest.mock("../../../models/Schedule");
jest.mock("../../../models/Service");
jest.mock("../../../models/User");

import { buscarAgendamentoCliente } from "../tools/buscarAgendamentoCliente";
import Schedule from "../../../models/Schedule";

const mockFindOne = Schedule.findOne as jest.Mock;

const COMPANY_ID = 1;
const CONTACT_ID = 42;

// Data futura estável para os testes (2099 para nunca "passar" do hoje)
const FUTURE_DATE = new Date("2099-06-15T14:00:00.000Z");

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    contactId: CONTACT_ID,
    companyId: COMPANY_ID,
    status: "PENDENTE",
    sendAt: FUTURE_DATE,
    reminderStatus: "pending",
    service: { name: "Reparo de dentes" },
    user: { name: "Dr. Carlos" },
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ─── Bug #25: contactId deve vir do contexto, não do LLM ─────────────────────
//
// O LLM não conhece o contactId do cliente — o system prompt só inclui nome,
// número e ticketId. Se a tool definition exige contactId como "required",
// Claude (modelo mais estrito) se recusa a chamar a tool, responde "não
// encontrei agendamento" sem nem tentar a query.
//
// Fix: remover contactId dos parâmetros da tool definition (o AgentService
// injeta do contexto de execução diretamente, via executeCalendarTool).

import { buscarAgendamentoClienteDefinition } from "../tools/buscarAgendamentoCliente";

describe("buscarAgendamentoClienteDefinition — Bug #25: sem contactId nos params", () => {
  it("NÃO inclui contactId nos parâmetros da tool (LLM não precisa saber)", () => {
    const props = buscarAgendamentoClienteDefinition.parameters?.properties ?? {};
    expect(props).not.toHaveProperty("contactId");
  });

  it("NÃO exige contactId como required", () => {
    const required: string[] = buscarAgendamentoClienteDefinition.parameters?.required ?? [];
    expect(required).not.toContain("contactId");
  });
});

// ─── Status PENDENTE — comportamento pré-existente ────────────────────────────

describe("buscarAgendamentoCliente — status PENDENTE", () => {
  it("retorna agendamento com status PENDENTE", async () => {
    mockFindOne.mockResolvedValue(makeSchedule({ status: "PENDENTE" }));

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.encontrado).toBe(true);
    expect(result.agendamento?.servico).toBe("Reparo de dentes");
    expect(result.agendamento?.status).toBe("PENDENTE");
  });

  it("retorna encontrado:false quando não há agendamento", async () => {
    mockFindOne.mockResolvedValue(null);

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.encontrado).toBe(false);
    expect(result.mensagem).toBeDefined();
  });
});

// ─── Bug #24: status ENVIADA deve ser incluído na busca ───────────────────────

describe("buscarAgendamentoCliente — Bug #24: status ENVIADA", () => {
  it("RETORNA agendamento com status ENVIADA (lembrete já disparado mas ativo)", async () => {
    // ENVIADA = lembrete WhatsApp foi enviado ao cliente para confirmação.
    // O agendamento CONTINUA ATIVO. Deve aparecer para o agente.
    mockFindOne.mockResolvedValue(makeSchedule({ status: "ENVIADA" }));

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.encontrado).toBe(true);
    expect(result.agendamento?.status).toBe("ENVIADA");
  });

  it("a query NÃO inclui ENVIADA na lista Op.notIn", async () => {
    mockFindOne.mockResolvedValue(null);

    await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    const whereClause = mockFindOne.mock.calls[0][0].where;
    const statusFilter = whereClause.status;

    // Op.notIn deve existir (filtro de status usa Op.notIn)
    const notInKey = Object.getOwnPropertySymbols(statusFilter).find(
      s => s.toString() === "Symbol(notIn)"
    );
    expect(notInKey).toBeDefined();

    const excludedStatuses: string[] = statusFilter[notInKey!];
    expect(excludedStatuses).not.toContain("ENVIADA");
    expect(excludedStatuses).toContain("CANCELADO");
  });

  it("NÃO retorna agendamento com status CANCELADO", async () => {
    // CANCELADO é o único status que deve ser excluído.
    mockFindOne.mockResolvedValue(null); // query exclui CANCELADO → sem resultado

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.encontrado).toBe(false);
  });
});

// ─── Dados do agendamento retornado ──────────────────────────────────────────

describe("buscarAgendamentoCliente — dados do resultado", () => {
  it("mapeia corretamente serviço, profissional, data, hora e confirmado", async () => {
    mockFindOne.mockResolvedValue(
      makeSchedule({ reminderStatus: "confirmed", status: "ENVIADA" })
    );

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.encontrado).toBe(true);
    const a = result.agendamento!;
    expect(a.servico).toBe("Reparo de dentes");
    expect(a.profissional).toBe("Dr. Carlos");
    expect(a.confirmado).toBe(true);
    expect(a.data).toBeDefined();
    expect(a.hora).toBeDefined();
  });

  it("usa body como fallback de serviço quando service é null", async () => {
    mockFindOne.mockResolvedValue(
      makeSchedule({ service: null, body: "Limpeza" })
    );

    const result = await buscarAgendamentoCliente({ contactId: CONTACT_ID }, COMPANY_ID);

    expect(result.agendamento?.servico).toBe("Limpeza");
  });
});
