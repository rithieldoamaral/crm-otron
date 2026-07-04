/**
 * Testes TDD para AutoCloseScheduledService.
 *
 * Foco: lógica pura `shouldCloseSchedule` que decide SE um ticket de agendamento
 * deve ser fechado automaticamente. A camada de I/O (`runAutoCloseScheduled`)
 * é testada por integração em staging.
 *
 * Regras (decisões 4-5 da diretiva retencao_modulo.md):
 *   - Fecha SE: agendamento passou (sendAt + autoCloseMinutes < agora)
 *               E ticket ainda está aberto/pendente
 *               E não houve mensagem nos últimos `inactivityWindow` minutos
 *   - Pula (não fecha) SE: ticket já fechado, ou houve interação recente
 */

import { shouldCloseSchedule } from "../AutoCloseScheduledService.utils";

// Helper: cria data X minutos atrás
const minutesAgo = (mins: number): Date => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - mins);
  return d;
};

const defaultConfig = { autoCloseMinutes: 60, inactivityWindow: 15 };

describe("shouldCloseSchedule — casos de FECHAR", () => {
  it("fecha quando passou 60min do horário e sem mensagens", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },     // agendado 70 min atrás
      { status: "open" },
      null,                                          // sem mensagens
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toMatch(/timeout|expirou|inactive/i);
  });

  it("fecha quando passou MUITO do horário (várias horas)", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(300), ticketId: 1 },   // 5h atrás
      { status: "open" },
      minutesAgo(120),                              // última msg há 2h
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
  });

  it("fecha ticket em status 'pending' também (não só 'open')", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "pending" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
  });

  it("fecha quando última mensagem é antiga (fora da janela)", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "open" },
      minutesAgo(30),                              // msg de 30 min atrás, fora dos 15 min
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
  });
});

describe("shouldCloseSchedule — casos de NÃO FECHAR", () => {
  it("NÃO fecha quando ainda não passou o tempo de auto-close", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(30), ticketId: 1 },   // só 30 min, longe dos 60
      { status: "open" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toMatch(/n[aã]o passou|antes do prazo|too early/i);
  });

  it("NÃO fecha ticket já fechado (status='closed')", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "closed" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toMatch(/j[aá] fechado|already closed/i);
  });

  it("NÃO fecha quando houve mensagem recente (dentro da janela de 15min)", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "open" },
      minutesAgo(5),                              // msg de 5 min atrás → conversa ativa
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toMatch(/intera[çc][aã]o recente|active|recent/i);
  });

  it("NÃO fecha quando schedule não tem ticketId associado", () => {
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: null },
      { status: "open" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toMatch(/sem ticket|no ticket/i);
  });

  it("respeita config customizada (autoCloseMinutes = 120 para salão)", () => {
    // Com config de salão (2h), 90 min ainda é cedo
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(90), ticketId: 1 },
      { status: "open" },
      null,
      { autoCloseMinutes: 120, inactivityWindow: 15 }
    );
    expect(result.shouldClose).toBe(false);
  });

  it("respeita janela de inatividade customizada (30min em vez de 15)", () => {
    // Com janela de 30 min, mensagem de 20 min atrás ainda é "recente"
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "open" },
      minutesAgo(20),
      { autoCloseMinutes: 60, inactivityWindow: 30 }
    );
    expect(result.shouldClose).toBe(false);
  });
});

describe("shouldCloseSchedule — limites e edge cases", () => {
  it("fecha no limite exato do tempo (sendAt + 60min = agora)", () => {
    // Agendado exatamente 60 min atrás
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(60), ticketId: 1 },
      { status: "open" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
  });

  it("NÃO fecha 1 segundo antes do prazo", () => {
    // 59 min atrás — falta 1 min
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(59), ticketId: 1 },
      { status: "open" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
  });

  it("fecha mensagem exatamente no limite da janela (15 min cravados)", () => {
    // No limite: mensagem exatamente há 15 min → fora da janela
    const result = shouldCloseSchedule(
      { sendAt: minutesAgo(70), ticketId: 1 },
      { status: "open" },
      minutesAgo(15),
      defaultConfig
    );
    expect(result.shouldClose).toBe(true);
  });

  it("trata schedule com sendAt no futuro como 'não passou ainda'", () => {
    // Edge case raro: schedule futuro com ticket aberto
    const future = new Date();
    future.setMinutes(future.getMinutes() + 30);
    const result = shouldCloseSchedule(
      { sendAt: future, ticketId: 1 },
      { status: "open" },
      null,
      defaultConfig
    );
    expect(result.shouldClose).toBe(false);
  });
});
