/**
 * Testes TDD para buscarAgendamentoCliente.
 */

jest.mock("../../../../models/Schedule");
jest.mock("../../../../models/Service");
jest.mock("../../../../models/User");

import { buscarAgendamentoCliente } from "../../tools/buscarAgendamentoCliente";
import Schedule from "../../../../models/Schedule";

describe("buscarAgendamentoCliente", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna próximo agendamento ativo do cliente", async () => {
    (Schedule.findOne as jest.Mock).mockResolvedValue({
      id: 55,
      sendAt: new Date("2026-05-06T10:00:00"),
      status: "PENDENTE",
      service: { name: "Corte" },
      user: { name: "Carlos" },
      contact: { name: "João" },
      reminderStatus: null
    });

    const result = await buscarAgendamentoCliente({ contactId: 5 }, companyId);

    expect(result.encontrado).toBe(true);
    expect(result.agendamento.id).toBe(55);
    expect(result.agendamento.servico).toBe("Corte");
    expect(result.agendamento.profissional).toBe("Carlos");
  });

  // BUG (2026-06-20): data/hora eram formatadas sem timeZone → em servidor UTC
  // mostravam 3h a mais. Aqui usamos um instante UTC explícito e exigimos que a
  // saída esteja em BRT, independente do fuso do runner de testes.
  it("formata data/hora em BRT (não no fuso do processo) + dataFormatada e dataISO", async () => {
    (Schedule.findOne as jest.Mock).mockResolvedValue({
      id: 7,
      // 17:00Z = 14:00 BRT de segunda-feira 22/06/2026
      sendAt: new Date("2026-06-22T17:00:00Z"),
      status: "PENDENTE",
      service: { name: "Corte" },
      user: { name: "Amanda" },
      contact: { name: "João" },
      reminderStatus: null
    });

    const result = await buscarAgendamentoCliente({ contactId: 5 }, companyId);

    expect(result.agendamento!.hora).toBe("14:00");        // 14h BRT, não 17h UTC
    expect(result.agendamento!.data).toBe("22/06/2026");
    expect(result.agendamento!.dataISO).toBe("2026-06-22"); // para round-trip de tools
    expect(result.agendamento!.dataFormatada).toBe("segunda-feira, 22/06/2026");
  });

  it("retorna encontrado:false quando cliente não tem agendamento ativo", async () => {
    (Schedule.findOne as jest.Mock).mockResolvedValue(null);

    const result = await buscarAgendamentoCliente({ contactId: 5 }, companyId);

    expect(result.encontrado).toBe(false);
    expect(result.mensagem).toMatch(/nenhum agendamento/i);
  });

  // Bug #14 (Round 4): em 27/04 19:48 BRT, o cliente tinha agendamento
  // criado para 27/04 11:00 (tarde, mas mesmo dia). O LLM tentou
  // `buscar_agendamento_cliente` para cancelar — recebeu "nenhum
  // encontrado" porque o filtro era `sendAt >= now` e 11:00 < 19:48.
  // Bot então MENTIU ao cliente ("não havia agendamento"). Fix: filtro
  // pelo INÍCIO DO DIA atual (BRT), não pelo instante. Agendamentos
  // do mesmo dia mesmo já decorridos continuam visíveis para o LLM
  // poder cancelá-los/remarcá-los honestamente.
  it("filtra a partir do início do dia atual em BRT, não do instante (bug #14)", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-27T22:48:00Z")); // 19:48 BRT

    try {
      (Schedule.findOne as jest.Mock).mockResolvedValue(null);
      await buscarAgendamentoCliente({ contactId: 5 }, companyId);

      const callArgs = (Schedule.findOne as jest.Mock).mock.calls[0][0];
      const sendAtFilter = callArgs.where.sendAt;
      // Pega o valor do operador Op.gte (Sequelize armazena como Symbol)
      const gteValue = Object.getOwnPropertySymbols(sendAtFilter)
        .map(s => sendAtFilter[s])[0] as Date;

      // O filtro precisa ser anterior a 27/04 19:48 BRT — para que um
      // agendamento criado às 11:00 do mesmo dia ainda apareça.
      expect(gteValue.getTime()).toBeLessThan(new Date("2026-04-27T22:48:00Z").getTime());
      // E precisa ser depois do dia anterior (26/04 23:59 BRT = 27/04 02:59 UTC)
      expect(gteValue.getTime()).toBeGreaterThanOrEqual(
        new Date("2026-04-27T03:00:00Z").getTime() - 1000 // tolerância de 1s
      );
    } finally {
      jest.useRealTimers();
    }
  });

  // Quando o filtro é por início-do-dia BRT, um agendamento de 11:00 hoje
  // (já passado às 19:48) ainda deve ser retornado se for o próximo "ativo"
  // do cliente. Garante que o nome do contato não causa problema.
  it("retorna agendamento criado para hoje mesmo já passado da hora atual (bug #14)", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-27T22:48:00Z")); // 19:48 BRT

    try {
      (Schedule.findOne as jest.Mock).mockResolvedValue({
        id: 6,
        sendAt: new Date("2026-04-27T14:00:00Z"), // 11:00 BRT — passado mas mesmo dia
        status: "PENDENTE",
        service: { name: "Reparo" },
        user: { name: "Sofia" },
        reminderStatus: null
      });

      const result = await buscarAgendamentoCliente({ contactId: 8 }, companyId);

      expect(result.encontrado).toBe(true);
      expect(result.agendamento!.id).toBe(6);
    } finally {
      jest.useRealTimers();
    }
  });
});
