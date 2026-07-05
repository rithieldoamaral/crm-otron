/**
 * Testes unitários — PackageService.utils.ts
 *
 * Cobre todas as funções puras do módulo de pacotes de sessões.
 * TDD: testes escritos ANTES da implementação conforme CLAUDE.md §II.1.
 *
 * Funções testadas:
 *   - calculateSessionsRemaining
 *   - derivePackageStatus
 *   - shouldSendLowBalanceAlert
 *   - buildSessionBalanceMessage
 *   - buildCompletionMessage
 *   - buildLowBalanceAlertMessage
 *   - calculatePackageDiscount
 */

import {
  calculateSessionsRemaining,
  derivePackageStatus,
  shouldSendLowBalanceAlert,
  buildSessionBalanceMessage,
  buildCompletionMessage,
  buildLowBalanceAlertMessage,
  calculatePackageDiscount,
  parseOptionalDate,
  hasActivePackage,
} from "../PackageService.utils";

// ── calculateSessionsRemaining ────────────────────────────────────────────────

describe("calculateSessionsRemaining", () => {
  it("retorna diferença normal", () => {
    expect(calculateSessionsRemaining(10, 3)).toBe(7);
  });

  it("retorna zero quando todas as sessões foram usadas", () => {
    expect(calculateSessionsRemaining(10, 10)).toBe(0);
  });

  it("nunca retorna negativo (guard contra over-consumo)", () => {
    expect(calculateSessionsRemaining(10, 12)).toBe(0);
  });

  it("retorna total quando nenhuma sessão foi usada", () => {
    expect(calculateSessionsRemaining(5, 0)).toBe(5);
  });

  it("funciona com pacote de 1 sessão", () => {
    expect(calculateSessionsRemaining(1, 1)).toBe(0);
  });
});

// ── derivePackageStatus ───────────────────────────────────────────────────────

describe("derivePackageStatus", () => {
  const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // +90 dias
  const pastDate = new Date("2020-01-01");
  const now = new Date("2026-05-21T12:00:00Z");

  it("retorna 'active' quando há sessões e não expirou", () => {
    expect(derivePackageStatus(3, 10, null, now)).toBe("active");
  });

  it("retorna 'completed' quando todas as sessões foram usadas", () => {
    expect(derivePackageStatus(10, 10, null, now)).toBe("completed");
  });

  it("retorna 'expired' quando a data de expiração já passou", () => {
    expect(derivePackageStatus(3, 10, pastDate, now)).toBe("expired");
  });

  it("retorna 'active' quando expiresAt é no futuro", () => {
    expect(derivePackageStatus(3, 10, futureDate, now)).toBe("active");
  });

  it("prioriza 'expired' sobre 'completed' se expirou E todas as sessões foram usadas", () => {
    // Expirou e também completou — expiração é verificada primeiro
    expect(derivePackageStatus(10, 10, pastDate, now)).toBe("expired");
  });

  it("retorna 'active' quando expiresAt é null (sem data de validade)", () => {
    expect(derivePackageStatus(3, 10, null, now)).toBe("active");
  });
});

// ── shouldSendLowBalanceAlert ─────────────────────────────────────────────────

describe("shouldSendLowBalanceAlert", () => {
  // Pacote de 10 sessões: limiar = min(2, floor(10 * 0.2)) = min(2, 2) = 2
  describe("pacote de 10 sessões (limiar = 2)", () => {
    it("não alerta quando remaining = 0 (usa mensagem de conclusão)", () => {
      expect(shouldSendLowBalanceAlert(0, 10)).toBe(false);
    });

    it("alerta quando remaining = 1", () => {
      expect(shouldSendLowBalanceAlert(1, 10)).toBe(true);
    });

    it("alerta quando remaining = 2 (limiar exato)", () => {
      expect(shouldSendLowBalanceAlert(2, 10)).toBe(true);
    });

    it("não alerta quando remaining = 3 (acima do limiar)", () => {
      expect(shouldSendLowBalanceAlert(3, 10)).toBe(false);
    });

    it("não alerta quando remaining = 10 (início do pacote)", () => {
      expect(shouldSendLowBalanceAlert(10, 10)).toBe(false);
    });
  });

  // Pacote de 5 sessões: limiar = min(2, floor(5 * 0.2)) = min(2, 1) = 1
  describe("pacote de 5 sessões (limiar = 1)", () => {
    it("alerta quando remaining = 1", () => {
      expect(shouldSendLowBalanceAlert(1, 5)).toBe(true);
    });

    it("não alerta quando remaining = 2", () => {
      expect(shouldSendLowBalanceAlert(2, 5)).toBe(false);
    });
  });

  // Pacote de 3 sessões: floor(3 * 0.2) = 0 → max(1, 0) = 1 → min(2, 1) = 1
  describe("pacote de 3 sessões (limiar mínimo = 1)", () => {
    it("alerta quando remaining = 1 (limiar mínimo garantido)", () => {
      expect(shouldSendLowBalanceAlert(1, 3)).toBe(true);
    });

    it("não alerta quando remaining = 2", () => {
      expect(shouldSendLowBalanceAlert(2, 3)).toBe(false);
    });
  });
});

// ── buildSessionBalanceMessage ────────────────────────────────────────────────

describe("buildSessionBalanceMessage", () => {
  it("inclui nome, serviço, progresso e sessões restantes no plural", () => {
    const msg = buildSessionBalanceMessage("Ana", "Depilação", 3, 10);
    expect(msg).toContain("Ana");
    expect(msg).toContain("Depilação");
    expect(msg).toContain("3/10");
    expect(msg).toContain("7 sessões");
  });

  it("usa singular quando resta 1 sessão", () => {
    const msg = buildSessionBalanceMessage("Ana", "Depilação", 9, 10);
    expect(msg).toContain("1 sessão");
    expect(msg).not.toContain("1 sessões");
  });

  it("delega para buildCompletionMessage quando pacote completo (remaining = 0)", () => {
    const msg = buildSessionBalanceMessage("Ana", "Depilação", 10, 10);
    expect(msg).toContain("Parabéns");
    expect(msg).toContain("concluiu");
  });

  it("inclui confirmação visual de sessão registrada", () => {
    const msg = buildSessionBalanceMessage("Carlos", "Barba", 1, 5);
    expect(msg).toContain("✅");
    expect(msg).toContain("Registramos");
  });
});

// ── buildCompletionMessage ────────────────────────────────────────────────────

describe("buildCompletionMessage", () => {
  it("inclui parabéns, nome do cliente e nome do serviço", () => {
    const msg = buildCompletionMessage("Maria", "Laser");
    expect(msg).toContain("Parabéns");
    expect(msg).toContain("Maria");
    expect(msg).toContain("Laser");
  });

  it("inclui CTA para renovação", () => {
    const msg = buildCompletionMessage("Maria", "Laser");
    expect(msg.toLowerCase()).toMatch(/renov/);
  });
});

// ── buildLowBalanceAlertMessage ───────────────────────────────────────────────

describe("buildLowBalanceAlertMessage", () => {
  it("usa plural quando restam 2 sessões", () => {
    const msg = buildLowBalanceAlertMessage("Ana", "Depilação", 2);
    expect(msg).toContain("2 sessões");
    expect(msg).not.toContain("2 sessão");
  });

  it("usa singular quando resta 1 sessão", () => {
    const msg = buildLowBalanceAlertMessage("Ana", "Depilação", 1);
    expect(msg).toContain("1 sessão");
    expect(msg).not.toContain("1 sessões");
  });

  it("inclui nome, serviço e CTA de renovação", () => {
    const msg = buildLowBalanceAlertMessage("João", "Laser", 2);
    expect(msg).toContain("João");
    expect(msg).toContain("Laser");
    expect(msg.toLowerCase()).toMatch(/renov/);
  });
});

// ── calculatePackageDiscount ──────────────────────────────────────────────────

describe("calculatePackageDiscount", () => {
  it("calcula desconto percentual corretamente", () => {
    // 10 sessões × R$40 = R$400 normal, pacote R$300 → 25% desconto
    expect(calculatePackageDiscount(40, 10, 300)).toBe(25);
  });

  it("retorna 0 quando não há desconto (preço igual ao avulso)", () => {
    expect(calculatePackageDiscount(40, 10, 400)).toBe(0);
  });

  it("retorna 0 quando pacote é mais caro que preço avulso", () => {
    expect(calculatePackageDiscount(40, 10, 500)).toBe(0);
  });

  it("retorna null quando unitPrice é null (sem preço no catálogo)", () => {
    expect(calculatePackageDiscount(null, 10, 300)).toBeNull();
  });

  it("retorna null quando unitPrice é zero (evita divisão por zero)", () => {
    expect(calculatePackageDiscount(0, 10, 300)).toBeNull();
  });

  it("arredonda para inteiro", () => {
    // 10 × R$33 = R$330, pacote R$300 → 9.09...% → 9
    expect(calculatePackageDiscount(33, 10, 300)).toBe(9);
  });
});

// ── parseOptionalDate ─────────────────────────────────────────────────────────

describe("parseOptionalDate", () => {
  it("retorna undefined para undefined", () => {
    expect(parseOptionalDate(undefined, "campo")).toBeUndefined();
  });

  it("retorna undefined para null", () => {
    expect(parseOptionalDate(null, "campo")).toBeUndefined();
  });

  it("retorna undefined para string vazia", () => {
    expect(parseOptionalDate("", "campo")).toBeUndefined();
  });

  it("parseia string ISO válida em formato YYYY-MM-DD", () => {
    const d = parseOptionalDate("2026-05-22", "purchasedAt");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(4);
    expect(d!.getUTCDate()).toBe(22);
  });

  it("parseia ISO completo com timestamp", () => {
    const d = parseOptionalDate("2026-05-22T15:30:00Z", "purchasedAt");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCHours()).toBe(15);
    expect(d!.getUTCMinutes()).toBe(30);
  });

  it("aceita objeto Date diretamente", () => {
    const input = new Date("2026-05-22T00:00:00Z");
    const d = parseOptionalDate(input, "campo");
    expect(d).toBe(input);
  });

  it("lança erro descritivo para string não parseável", () => {
    expect(() => parseOptionalDate("xyz", "purchasedAt")).toThrow(
      /Invalid date for field 'purchasedAt'/
    );
  });

  it("lança erro descritivo para string de data inválida (mês 99)", () => {
    expect(() => parseOptionalDate("2026-99-99", "expiresAt")).toThrow(
      /Invalid date for field 'expiresAt'/
    );
  });

  it("lança erro para tipos não suportados (number)", () => {
    expect(() => parseOptionalDate(12345 as any, "campo")).toThrow(
      /Invalid date type for field 'campo'/
    );
  });

  it("lança erro para tipos não suportados (boolean)", () => {
    expect(() => parseOptionalDate(true as any, "campo")).toThrow(
      /Invalid date type for field 'campo'/
    );
  });

  it("lança erro para objeto que não é Date", () => {
    expect(() => parseOptionalDate({ foo: "bar" } as any, "campo")).toThrow(
      /Invalid date type for field 'campo'/
    );
  });

  it("inclui o nome do campo na mensagem (para debug)", () => {
    expect(() => parseOptionalDate("xyz", "consumedAt")).toThrow(/consumedAt/);
  });
});

// ── hasActivePackage ──────────────────────────────────────────────────────────
//
// Guard de retenção (Tier 2): um cliente com pacote ATIVO (comprou N sessões e
// ainda está consumindo) NÃO deve ser tratado como adormecido/perdido — ele já é
// um cliente engajado. Esta função pura deriva o status real de cada compra
// (via derivePackageStatus, não confia no campo `status` persistido que pode estar
// desatualizado) e responde se ao menos um pacote está ativo na data de referência.

describe("hasActivePackage", () => {
  const now = new Date("2026-07-05T12:00:00Z");
  const future = new Date("2026-12-31T12:00:00Z");
  const past = new Date("2020-01-01T12:00:00Z");

  it("retorna false para lista vazia / undefined / null", () => {
    expect(hasActivePackage([], now)).toBe(false);
    expect(hasActivePackage(undefined as any, now)).toBe(false);
    expect(hasActivePackage(null as any, now)).toBe(false);
  });

  it("retorna true quando há pacote com sessões restantes e sem expiração", () => {
    const purchases = [
      { sessionsUsed: 3, totalSessions: 10, expiresAt: null, status: "active" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(true);
  });

  it("retorna true quando o pacote ainda não expirou (expiresAt futuro)", () => {
    const purchases = [
      { sessionsUsed: 2, totalSessions: 10, expiresAt: future, status: "active" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(true);
  });

  it("retorna false quando todas as sessões foram consumidas (completed)", () => {
    const purchases = [
      { sessionsUsed: 10, totalSessions: 10, expiresAt: null, status: "active" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(false);
  });

  it("retorna false quando o pacote expirou (expiresAt no passado)", () => {
    const purchases = [
      { sessionsUsed: 2, totalSessions: 10, expiresAt: past, status: "active" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(false);
  });

  it("NÃO confia no campo status persistido — deriva do estado real", () => {
    // status persistido diz "active" mas na verdade já expirou → deve ser false
    const staleExpired = [
      { sessionsUsed: 2, totalSessions: 10, expiresAt: past, status: "active" },
    ];
    expect(hasActivePackage(staleExpired, now)).toBe(false);
  });

  it("ignora compras canceladas manualmente pelo admin", () => {
    // 'cancelled' é decisão explícita do admin — derivePackageStatus nunca o retorna,
    // então respeitamos o status persistido apenas para excluir cancelados.
    const cancelled = [
      { sessionsUsed: 2, totalSessions: 10, expiresAt: null, status: "cancelled" },
    ];
    expect(hasActivePackage(cancelled, now)).toBe(false);
  });

  it("retorna true se PELO MENOS UM pacote entre vários estiver ativo", () => {
    const purchases = [
      { sessionsUsed: 10, totalSessions: 10, expiresAt: null, status: "completed" },
      { sessionsUsed: 1, totalSessions: 5, expiresAt: null, status: "active" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(true);
  });

  it("retorna false quando todos os pacotes estão inativos", () => {
    const purchases = [
      { sessionsUsed: 10, totalSessions: 10, expiresAt: null, status: "completed" },
      { sessionsUsed: 2, totalSessions: 10, expiresAt: past, status: "expired" },
      { sessionsUsed: 1, totalSessions: 5, expiresAt: null, status: "cancelled" },
    ];
    expect(hasActivePackage(purchases, now)).toBe(false);
  });
});
