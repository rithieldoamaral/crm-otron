/**
 * Testes TDD para creditLedger — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * DECISÃO DE PRODUTO (aprovada em 2026-08-17, ver directives/token_governance.md):
 * o razão é implementado por completo, mas o BLOQUEIO fica atrás de flag
 * desligada por padrão. Se o crédito acabasse e o sistema bloqueasse, quem
 * ficaria sem resposta seria o cliente DO cliente, no meio de uma conversa no
 * WhatsApp. Numa plataforma de atendimento esse é o pior modo de falha.
 *
 * DECISÃO TÉCNICA: saldo é SOMA DE LANÇAMENTOS, nunca coluna mutável. Coluna
 * de saldo sofre lost update sob concorrência (dois débitos simultâneos leem
 * o mesmo valor e um sobrescreve o outro) e apaga o rastro de como se chegou
 * ali. O teste de concorrência abaixo trava essa escolha.
 */

import CreditLedger from "../../../models/CreditLedger";
import {
  getBalance,
  grantCredit,
  recordConsumption,
  evaluateThresholds,
  LEDGER_ENTRY_TYPES
} from "../creditLedger";

jest.mock("../../../models/CreditLedger", () => ({
  __esModule: true,
  default: { create: jest.fn(), sum: jest.fn(), findAll: jest.fn() }
}));

jest.mock("../../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

const mockedCreate = CreditLedger.create as jest.Mock;
const mockedSum = CreditLedger.sum as jest.Mock;

describe("getBalance", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calcula o saldo somando os lançamentos, não lendo coluna de saldo", async () => {
    mockedSum.mockResolvedValue(150.5);

    const balance = await getBalance(7);

    expect(balance).toBeCloseTo(150.5, 6);
    expect(mockedSum).toHaveBeenCalledWith(
      "amountBrl",
      expect.objectContaining({ where: { companyId: 7 } })
    );
  });

  it("devolve 0 quando a empresa não tem nenhum lançamento", async () => {
    // Sequelize.sum devolve null quando não há linhas.
    mockedSum.mockResolvedValue(null);

    expect(await getBalance(7)).toBe(0);
  });

  it("devolve 0 e loga quando a consulta falha, sem propagar", async () => {
    mockedSum.mockRejectedValue(new Error("connection refused"));
    // eslint-disable-next-line global-require
    const { logger } = require("../../../utils/logger");

    expect(await getBalance(7)).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("saldo negativo é permitido — empresa consumiu além do crédito", async () => {
    // Como não bloqueamos, o saldo NEGATIVO é justamente o sinal de que há
    // algo a cobrar. Zerar aqui esconderia a dívida.
    mockedSum.mockResolvedValue(-42.75);

    expect(await getBalance(7)).toBeCloseTo(-42.75, 6);
  });
});

describe("grantCredit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreate.mockResolvedValue({ id: 1 });
  });

  it("registra crédito como lançamento POSITIVO", async () => {
    await grantCredit({
      companyId: 7,
      amountBrl: 500,
      description: "Compra de créditos - PIX",
      createdByUserId: 1
    });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      companyId: 7,
      type: LEDGER_ENTRY_TYPES.GRANT,
      amountBrl: 500
    });
  });

  it("guarda quem concedeu o crédito, para auditoria", async () => {
    await grantCredit({
      companyId: 7,
      amountBrl: 500,
      description: "Cortesia",
      createdByUserId: 99
    });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      createdByUserId: 99
    });
  });

  it("recusa valor zero ou negativo (retirada se faz por ajuste, não por concessão)", async () => {
    await expect(
      grantCredit({
        companyId: 7,
        amountBrl: 0,
        description: "x",
        createdByUserId: 1
      })
    ).rejects.toMatchObject({ message: "ERR_INVALID_CREDIT_AMOUNT" });

    await expect(
      grantCredit({
        companyId: 7,
        amountBrl: -10,
        description: "x",
        createdByUserId: 1
      })
    ).rejects.toMatchObject({ message: "ERR_INVALID_CREDIT_AMOUNT" });

    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("exige descrição — lançamento sem motivo é impossível de auditar depois", async () => {
    await expect(
      grantCredit({
        companyId: 7,
        amountBrl: 100,
        description: "",
        createdByUserId: 1
      })
    ).rejects.toMatchObject({ message: "ERR_MISSING_DESCRIPTION" });
  });
});

describe("recordConsumption", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreate.mockResolvedValue({ id: 1 });
  });

  it("registra consumo como lançamento NEGATIVO", async () => {
    await recordConsumption({
      companyId: 7,
      amountBrl: 12.35,
      description: "Consumo de tokens - agosto",
      referenceId: "usage-2026-08"
    });

    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      type: LEDGER_ENTRY_TYPES.CONSUMPTION,
      amountBrl: -12.35
    });
  });

  it("não lança quando a gravação falha — consumo já aconteceu de fato", async () => {
    mockedCreate.mockRejectedValue(new Error("deadlock"));

    await expect(
      recordConsumption({
        companyId: 7,
        amountBrl: 5,
        description: "x",
        referenceId: "r1"
      })
    ).resolves.toBeNull();
  });

  it("dois débitos concorrentes geram DOIS lançamentos (sem lost update)", async () => {
    // Com coluna de saldo mutável, dois débitos simultâneos leriam o mesmo
    // valor e um sobrescreveria o outro. Com razão, cada um vira uma linha e
    // a soma continua correta.
    await Promise.all([
      recordConsumption({
        companyId: 7,
        amountBrl: 10,
        description: "a",
        referenceId: "r1"
      }),
      recordConsumption({
        companyId: 7,
        amountBrl: 15,
        description: "b",
        referenceId: "r2"
      })
    ]);

    expect(mockedCreate).toHaveBeenCalledTimes(2);
    // sort() sem comparador ordena como string: [-10,-15] em vez de [-15,-10].
    const valores = mockedCreate.mock.calls
      .map(c => c[0].amountBrl)
      .sort((a, b) => a - b);
    expect(valores).toEqual([-15, -10]);
  });
});

describe("evaluateThresholds", () => {
  it("não alerta abaixo de 80% do crédito consumido", () => {
    const r = evaluateThresholds({ granted: 100, consumed: 50 });
    expect(r.level).toBe("ok");
    expect(r.shouldAlert).toBe(false);
  });

  it("alerta ao cruzar 80%", () => {
    const r = evaluateThresholds({ granted: 100, consumed: 80 });
    expect(r.level).toBe("warning");
    expect(r.shouldAlert).toBe(true);
  });

  it("alerta em nível crítico ao atingir 100%", () => {
    const r = evaluateThresholds({ granted: 100, consumed: 100 });
    expect(r.level).toBe("exhausted");
    expect(r.shouldAlert).toBe(true);
  });

  it("permanece em exhausted quando o consumo ultrapassa o crédito", () => {
    const r = evaluateThresholds({ granted: 100, consumed: 130 });
    expect(r.level).toBe("exhausted");
    expect(r.percentUsed).toBeCloseTo(130, 4);
  });

  it("NUNCA manda bloquear — enforcement é decisão comercial, não default", () => {
    // Trava a decisão de produto: o agente não emudece no meio da conversa
    // do cliente final por causa de saldo. Ver directives/token_governance.md.
    const r = evaluateThresholds({ granted: 100, consumed: 500 });
    expect(r.shouldBlock).toBe(false);
  });

  it("só manda bloquear quando enforcement é explicitamente ligado", () => {
    const r = evaluateThresholds({
      granted: 100,
      consumed: 150,
      enforcementEnabled: true
    });
    expect(r.shouldBlock).toBe(true);
  });

  it("empresa sem crédito concedido não é tratada como estourada", () => {
    // Fase atual: o dono absorve o custo e ninguém tem crédito cadastrado.
    // Tratar granted=0 como 100% usado dispararia alerta para todo mundo.
    const r = evaluateThresholds({ granted: 0, consumed: 42 });
    expect(r.level).toBe("no_plan");
    expect(r.shouldAlert).toBe(false);
    expect(r.shouldBlock).toBe(false);
  });
});
