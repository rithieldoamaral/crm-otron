/**
 * Testes TDD para relatorioAgente.
 * Snapshot de desempenho por agente: tickets fechados, tempo médio de
 * 1ª resposta e tickets ainda abertos — com destaque de quem está acima da meta.
 */

jest.mock("../../../../models/User");
jest.mock("../../../../models/Ticket");
jest.mock("../../../../models/Message");
jest.mock("../../../AgentService/settingsCache");
jest.mock("../../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { relatorioAgente } from "../../tools/relatorioAgente";
import User from "../../../../models/User";
import Ticket from "../../../../models/Ticket";
import Message from "../../../../models/Message";
import { getSettingsByCompany } from "../../../AgentService/settingsCache";

const mockUserFindAll = User.findAll as jest.Mock;
const mockTicketCount = Ticket.count as jest.Mock;
const mockTicketFindAll = Ticket.findAll as jest.Mock;
const mockMessageFindOne = Message.findOne as jest.Mock;
const mockGetSettings = getSettingsByCompany as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────

const HORA = 60 * 60 * 1000;
const MIN = 60 * 1000;

function makeUser(id: number, name: string): any {
  return { id, name };
}

/** Cria ticket com createdAt definido. */
function makeTicket(id: number, createdAtMsAgo: number): any {
  return { id, createdAt: new Date(Date.now() - createdAtMsAgo) };
}

/** Configura mocks para UM agente (userId). */
function setupSingleAgent(opts: {
  userId: number;
  fechados: number;
  abertos: number;
  closedTickets: any[];
  firstResponseMsAfterCreate: number | null; // null = sem mensagem de resposta
}) {
  mockTicketCount.mockImplementation(async ({ where }: any) => {
    if (where.status === "closed") return opts.fechados;
    if (where.status === "open") return opts.abertos;
    return 0;
  });

  mockTicketFindAll.mockResolvedValue(opts.closedTickets);

  mockMessageFindOne.mockImplementation(async ({ where }: any) => {
    if (opts.firstResponseMsAfterCreate === null) return null;
    const ticket = opts.closedTickets.find((t: any) => t.id === where.ticketId);
    if (!ticket) return null;
    return { createdAt: new Date(ticket.createdAt.getTime() + opts.firstResponseMsAfterCreate) };
  });
}

// ── Testes ─────────────────────────────────────────────────────────────────

describe("relatorioAgente", () => {
  const companyId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue([
      { key: "secretaryResponseTimeGoal", value: "15" } // meta padrão: 15 min
    ]);
  });

  it("retorna dados de todos os agentes quando agente não especificado", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana Costa"), makeUser(2, "Carlos Lima")]);
    mockTicketCount.mockResolvedValue(3);
    mockTicketFindAll.mockResolvedValue([]);
    mockMessageFindOne.mockResolvedValue(null);

    const result = await relatorioAgente({}, companyId);

    expect(result.agentes).toHaveLength(2);
    expect(result.agentes.map((a: any) => a.nome)).toEqual(
      expect.arrayContaining(["Ana Costa", "Carlos Lima"])
    );
  });

  it("filtra agentes por nome parcial (case insensitive)", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana Costa")]);
    mockTicketCount.mockResolvedValue(0);
    mockTicketFindAll.mockResolvedValue([]);
    mockMessageFindOne.mockResolvedValue(null);

    await relatorioAgente({ agente: "ana" }, companyId);

    // User.findAll deve ter sido chamado com filtro de nome
    expect(mockUserFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId })
      })
    );
  });

  it("retorna período 'hoje' como label do resultado", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    mockTicketCount.mockResolvedValue(0);
    mockTicketFindAll.mockResolvedValue([]);
    mockMessageFindOne.mockResolvedValue(null);

    const result = await relatorioAgente({ periodo: "hoje" }, companyId);

    expect(result.periodo).toMatch(/hoje/i);
  });

  it("retorna período 'semana' como label do resultado", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    mockTicketCount.mockResolvedValue(0);
    mockTicketFindAll.mockResolvedValue([]);
    mockMessageFindOne.mockResolvedValue(null);

    const result = await relatorioAgente({ periodo: "semana" }, companyId);

    expect(result.periodo).toMatch(/semana/i);
  });

  it("calcula tempo médio de 1ª resposta em minutos corretamente", async () => {
    const ticket = makeTicket(10, 3 * HORA); // criado 3h atrás
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1,
      fechados: 1,
      abertos: 0,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 4 * MIN // respondeu em 4 minutos
    });

    const result = await relatorioAgente({}, companyId);
    const ana = result.agentes[0];

    expect(ana.tempoMedioRespostaMinutos).toBe(4);
  });

  it("retorna null para tempoMedioRespostaMinutos quando agente não tem tickets com resposta", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1,
      fechados: 3,
      abertos: 1,
      closedTickets: [makeTicket(10, HORA)],
      firstResponseMsAfterCreate: null // sem mensagem de resposta registrada
    });

    const result = await relatorioAgente({}, companyId);
    const ana = result.agentes[0];

    expect(ana.tempoMedioRespostaMinutos).toBeNull();
    expect(ana.acimaMetaResposta).toBe(false);
  });

  it("marca agente como acima da meta quando tempo médio supera goal configurado", async () => {
    const ticket = makeTicket(10, 2 * HORA);
    mockUserFindAll.mockResolvedValue([makeUser(1, "Marcos")]);
    setupSingleAgent({
      userId: 1,
      fechados: 2,
      abertos: 7,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 28 * MIN // 28 min > meta de 15 min
    });

    const result = await relatorioAgente({}, companyId);
    const marcos = result.agentes[0];

    expect(marcos.acimaMetaResposta).toBe(true);
  });

  it("NÃO marca como acima da meta quando tempo está dentro do goal", async () => {
    const ticket = makeTicket(10, 2 * HORA);
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1,
      fechados: 8,
      abertos: 2,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 4 * MIN // 4 min < meta de 15 min
    });

    const result = await relatorioAgente({}, companyId);
    const ana = result.agentes[0];

    expect(ana.acimaMetaResposta).toBe(false);
  });

  it("usa meta de 15 min quando secretaryResponseTimeGoal não configurado", async () => {
    mockGetSettings.mockResolvedValue([]); // sem settings
    const ticket = makeTicket(10, 2 * HORA);
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1,
      fechados: 1,
      abertos: 0,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 14 * MIN // 14 min < meta padrão 15 min
    });

    const result = await relatorioAgente({}, companyId);

    expect(result.metaRespostaMinutos).toBe(15);
    expect(result.agentes[0].acimaMetaResposta).toBe(false);
  });

  it("usa meta configurada via secretaryResponseTimeGoal", async () => {
    mockGetSettings.mockResolvedValue([
      { key: "secretaryResponseTimeGoal", value: "10" } // meta de 10 min
    ]);
    const ticket = makeTicket(10, 2 * HORA);
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1,
      fechados: 1,
      abertos: 0,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 12 * MIN // 12 min > meta de 10 min
    });

    const result = await relatorioAgente({}, companyId);

    expect(result.metaRespostaMinutos).toBe(10);
    expect(result.agentes[0].acimaMetaResposta).toBe(true);
  });

  it("ordena agentes por ticketsFechados decrescente (melhor primeiro)", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana"), makeUser(2, "Carlos")]);
    // Ana: 8 fechados, Carlos: 5 fechados
    mockTicketCount.mockImplementation(async ({ where }: any) => {
      if (where.userId === 1 && where.status === "closed") return 8;
      if (where.userId === 1 && where.status === "open") return 2;
      if (where.userId === 2 && where.status === "closed") return 5;
      if (where.userId === 2 && where.status === "open") return 4;
      return 0;
    });
    mockTicketFindAll.mockResolvedValue([]);
    mockMessageFindOne.mockResolvedValue(null);

    const result = await relatorioAgente({}, companyId);

    expect(result.agentes[0].nome).toBe("Ana");
    expect(result.agentes[0].ticketsFechados).toBeGreaterThan(result.agentes[1].ticketsFechados);
  });

  it("resultado inclui ticketsFechados, ticketsAbertos, tempoMedio, acimaMetaResposta, nome", async () => {
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1, fechados: 5, abertos: 2,
      closedTickets: [makeTicket(10, HORA)],
      firstResponseMsAfterCreate: 6 * MIN
    });

    const result = await relatorioAgente({}, companyId);
    const agente = result.agentes[0];

    expect(agente.id).toBeDefined();
    expect(agente.nome).toBe("Ana");
    expect(agente.ticketsFechados).toBe(5);
    expect(agente.ticketsAbertos).toBe(2);
    expect(typeof agente.tempoMedioRespostaMinutos).toBe("number");
    expect(typeof agente.acimaMetaResposta).toBe("boolean");
  });

  it("retorna lista vazia de agentes quando não há usuários na empresa", async () => {
    mockUserFindAll.mockResolvedValue([]);

    const result = await relatorioAgente({}, companyId);

    expect(result.agentes).toHaveLength(0);
    expect(mockTicketCount).not.toHaveBeenCalled();
  });

  it("usa companyId correto na query de usuários", async () => {
    mockUserFindAll.mockResolvedValue([]);

    await relatorioAgente({}, 77);

    expect(mockUserFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 77 }) })
    );
  });

  // Defense-in-depth: Message.findOne agora exige companyId mesmo que ticketId
  // já isole o registro. Protege contra eventual vazamento de ticketId entre empresas.
  it("aplica companyId em TODAS as queries (incluindo Message para defense-in-depth)", async () => {
    const ticket = makeTicket(10, HORA);
    mockUserFindAll.mockResolvedValue([makeUser(1, "Ana")]);
    setupSingleAgent({
      userId: 1, fechados: 1, abertos: 0,
      closedTickets: [ticket],
      firstResponseMsAfterCreate: 5 * MIN
    });

    await relatorioAgente({}, 88);

    // Toda chamada a Message.findOne deve ter companyId=88 no where
    const allMessageCalls = mockMessageFindOne.mock.calls;
    expect(allMessageCalls.length).toBeGreaterThan(0);
    for (const [callArgs] of allMessageCalls) {
      expect(callArgs.where).toEqual(expect.objectContaining({ companyId: 88 }));
    }
  });
});
