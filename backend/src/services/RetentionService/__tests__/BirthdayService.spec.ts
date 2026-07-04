/**
 * Testes unitários para BirthdayService.utils.ts
 *
 * Isolados de I/O: sem Sequelize, sem WhatsApp, sem cron.
 * Apenas lógica pura de datas e mensagens.
 */

import {
  extractMonthDay,
  getDayOffsetFromBirthday,
  whichTouchToFire,
  buildTouchMessage,
  TOUCH_OFFSETS
} from "../BirthdayService.utils";

// ── TOUCH_OFFSETS ──────────────────────────────────────────────────

describe("TOUCH_OFFSETS", () => {
  it("dm3 é -3 (3 dias no futuro)", () => {
    expect(TOUCH_OFFSETS.dm3).toBe(-3);
  });

  it("d0 é 0 (no dia)", () => {
    expect(TOUCH_OFFSETS.d0).toBe(0);
  });

  it("dp7 é 7 (7 dias no passado)", () => {
    expect(TOUCH_OFFSETS.dp7).toBe(7);
  });
});

// ── extractMonthDay ────────────────────────────────────────────────

describe("extractMonthDay", () => {
  // Casos nulos / inválidos
  it("retorna null para null", () => {
    expect(extractMonthDay(null)).toBeNull();
  });

  it("retorna null para undefined", () => {
    expect(extractMonthDay(undefined)).toBeNull();
  });

  it("retorna null para string vazia", () => {
    expect(extractMonthDay("")).toBeNull();
  });

  it("retorna null para string inválida (sem formato de data)", () => {
    expect(extractMonthDay("not-a-date")).toBeNull();
  });

  it("retorna null para objeto Date inválido", () => {
    expect(extractMonthDay(new Date("invalid"))).toBeNull();
  });

  // Formato de string YYYY-MM-DD
  it("extrai MM-DD de string YYYY-MM-DD — aniversário em maio", () => {
    expect(extractMonthDay("1990-05-19")).toBe("05-19");
  });

  it("extrai MM-DD de string YYYY-MM-DD — aniversário em janeiro (com zero)", () => {
    expect(extractMonthDay("2000-01-07")).toBe("01-07");
  });

  it("extrai MM-DD de string YYYY-MM-DD — aniversário em dezembro", () => {
    expect(extractMonthDay("1985-12-31")).toBe("12-31");
  });

  // Formato de string com parte de hora (vindo do Sequelize)
  it("extrai MM-DD de string YYYY-MM-DD HH:mm:ss", () => {
    expect(extractMonthDay("1990-05-19 00:00:00")).toBe("05-19");
  });

  it("extrai MM-DD de string ISO com T (YYYY-MM-DDTHH:mm:ss)", () => {
    expect(extractMonthDay("1990-05-19T03:00:00.000Z")).toBe("05-19");
  });

  // Objeto Date nativo — usa UTC para evitar offset de timezone
  it("extrai MM-DD de objeto Date criado com Date.UTC (maio)", () => {
    const d = new Date(Date.UTC(1990, 4, 19)); // mês 4 = maio
    expect(extractMonthDay(d)).toBe("05-19");
  });

  it("extrai MM-DD de objeto Date criado com Date.UTC (janeiro)", () => {
    const d = new Date(Date.UTC(2000, 0, 7)); // mês 0 = janeiro
    expect(extractMonthDay(d)).toBe("01-07");
  });

  it("extrai MM-DD de objeto Date criado com Date.UTC (dezembro)", () => {
    const d = new Date(Date.UTC(1985, 11, 31)); // mês 11 = dezembro
    expect(extractMonthDay(d)).toBe("12-31");
  });

  // Idempotência
  it("é determinístico: mesma entrada sempre retorna mesmo resultado", () => {
    const input = "1990-05-19";
    const r1 = extractMonthDay(input);
    const r2 = extractMonthDay(input);
    expect(r1).toBe(r2);
  });
});

// ── getDayOffsetFromBirthday ───────────────────────────────────────

describe("getDayOffsetFromBirthday", () => {
  // offset negativo = aniversário ainda está no futuro

  it("retorna -3 quando aniversário é daqui 3 dias (dispara dm3)", () => {
    // Aniversário 19/05, hoje 16/05 → faltam 3 dias → -3
    const offset = getDayOffsetFromBirthday("05-19", new Date("2026-05-16T12:00:00Z"));
    expect(offset).toBe(-3);
  });

  it("retorna -1 quando aniversário é amanhã", () => {
    const offset = getDayOffsetFromBirthday("05-20", new Date("2026-05-19T12:00:00Z"));
    expect(offset).toBe(-1);
  });

  // offset zero = aniversário é hoje

  it("retorna 0 no dia do aniversário (dispara d0)", () => {
    const offset = getDayOffsetFromBirthday("05-19", new Date("2026-05-19T12:00:00Z"));
    expect(offset).toBe(0);
  });

  it("retorna 0 mesmo que now seja à meia-noite do dia do aniversário", () => {
    const offset = getDayOffsetFromBirthday("05-19", new Date("2026-05-19T00:00:00Z"));
    expect(offset).toBe(0);
  });

  // offset positivo = aniversário já passou

  it("retorna 7 quando aniversário foi há 7 dias (dispara dp7)", () => {
    // Aniversário 19/05, hoje 26/05 → passou 7 dias → +7
    const offset = getDayOffsetFromBirthday("05-19", new Date("2026-05-26T12:00:00Z"));
    expect(offset).toBe(7);
  });

  it("retorna 1 quando aniversário foi ontem", () => {
    const offset = getDayOffsetFromBirthday("05-18", new Date("2026-05-19T12:00:00Z"));
    expect(offset).toBe(1);
  });

  it("retorna 30 quando aniversário foi há 30 dias", () => {
    const offset = getDayOffsetFromBirthday("04-19", new Date("2026-05-19T12:00:00Z"));
    expect(offset).toBe(30);
  });

  // Casos de fronteira: início e fim de mês

  it("calcula corretamente entre meses diferentes (fim de fevereiro → março)", () => {
    // Aniversário 28/02, hoje 03/03 → passou 3 dias → +3
    const offset = getDayOffsetFromBirthday("02-28", new Date("2026-03-03T12:00:00Z"));
    expect(offset).toBe(3);
  });

  it("calcula corretamente travessia de mês (31 jan → 03 fev = -3)", () => {
    // Aniversário 03/02, hoje 31/01 → faltam 3 dias → -3
    const offset = getDayOffsetFromBirthday("02-03", new Date("2026-01-31T12:00:00Z"));
    expect(offset).toBe(-3);
  });

  // Idempotência
  it("é determinístico para mesmos argumentos", () => {
    const now = new Date("2026-05-16T12:00:00Z");
    const r1 = getDayOffsetFromBirthday("05-19", now);
    const r2 = getDayOffsetFromBirthday("05-19", now);
    expect(r1).toBe(r2);
  });
});

// ── whichTouchToFire ───────────────────────────────────────────────

describe("whichTouchToFire", () => {
  it("offset -3 → 'dm3'", () => {
    expect(whichTouchToFire(-3)).toBe("dm3");
  });

  it("offset 0 → 'd0'", () => {
    expect(whichTouchToFire(0)).toBe("d0");
  });

  it("offset 7 → 'dp7'", () => {
    expect(whichTouchToFire(7)).toBe("dp7");
  });

  it("offset fora do esperado → null", () => {
    expect(whichTouchToFire(1)).toBeNull();
    expect(whichTouchToFire(-1)).toBeNull();
    expect(whichTouchToFire(3)).toBeNull();
    expect(whichTouchToFire(-7)).toBeNull();
    expect(whichTouchToFire(30)).toBeNull();
  });

  it("é determinístico", () => {
    expect(whichTouchToFire(-3)).toBe(whichTouchToFire(-3));
  });
});

// ── buildTouchMessage ──────────────────────────────────────────────

describe("buildTouchMessage", () => {
  const BASE = {
    birthdayMessageTemplate: "Parabéns {{name}}! Aqui está seu cupom: {{coupon}} 🎁",
    contactName: "Maria"
  };

  // ── dm3 (antecipação) ──────────────────────────────────────────

  describe("touchType = dm3", () => {
    it("contém o nome do contato", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dm3" });
      expect(msg).toContain("Maria");
    });

    it("menciona '3 dias'", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dm3" });
      expect(msg).toContain("3 dias");
    });

    it("não contém informação de cupom (cupom ainda não foi gerado)", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dm3", couponCode: "NAODEVESAIR" });
      expect(msg).not.toContain("NAODEVESAIR");
    });

    it("usa 'Cliente' como fallback quando contactName é vazio", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dm3", contactName: "" });
      expect(msg).toContain("Cliente");
    });
  });

  // ── d0 (dia do aniversário) ────────────────────────────────────

  describe("touchType = d0", () => {
    it("substitui {{name}} pelo nome do contato", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "d0", couponCode: "ANIVER-AB12" });
      expect(msg).toContain("Maria");
      expect(msg).not.toContain("{{name}}");
    });

    it("substitui {{coupon}} pelo código do cupom", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "d0", couponCode: "ANIVER-AB12" });
      expect(msg).toContain("ANIVER-AB12");
      expect(msg).not.toContain("{{coupon}}");
    });

    it("substitui variantes em português {{nome}} e {{cupom}}", () => {
      const templatePt = "Feliz aniversário {{nome}}! Use: {{cupom}}";
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "d0",
        birthdayMessageTemplate: templatePt,
        couponCode: "ANIVER-XY34"
      });
      expect(msg).toContain("Maria");
      expect(msg).toContain("ANIVER-XY34");
      expect(msg).not.toContain("{{nome}}");
      expect(msg).not.toContain("{{cupom}}");
    });

    it("adiciona cupom ao final quando template NÃO tem placeholder de cupom", () => {
      const templateSemCupom = "Parabéns {{name}}! Temos um presente para você!";
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "d0",
        birthdayMessageTemplate: templateSemCupom,
        couponCode: "ANIVER-ZZ99"
      });
      expect(msg).toContain("ANIVER-ZZ99");
    });

    it("não duplica o cupom quando template já tem placeholder", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "d0", couponCode: "ANIVER-AB12" });
      // O código deve aparecer exatamente 1 vez no resultado
      const occurrences = (msg.match(/ANIVER-AB12/g) || []).length;
      expect(occurrences).toBe(1);
    });

    it("funciona sem couponCode (sem geração de cupom)", () => {
      const templateSemCupom = "Parabéns {{name}}! Feliz aniversário!";
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "d0",
        birthdayMessageTemplate: templateSemCupom
      });
      expect(msg).toContain("Maria");
      expect(msg).toContain("Feliz aniversário");
    });

    it("usa 'Cliente' como fallback quando contactName é vazio", () => {
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "d0",
        contactName: "",
        couponCode: "ANIVER-AB12"
      });
      expect(msg).toContain("Cliente");
    });
  });

  // ── dp7 (follow-up 7 dias depois) ─────────────────────────────

  describe("touchType = dp7", () => {
    it("contém o nome do contato", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dp7" });
      expect(msg).toContain("Maria");
    });

    it("menciona o cupom quando couponCode é fornecido", () => {
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "dp7",
        couponCode: "ANIVER-AB12"
      });
      expect(msg).toContain("ANIVER-AB12");
    });

    it("menciona os dias restantes quando couponDaysLeft é fornecido", () => {
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "dp7",
        couponCode: "ANIVER-AB12",
        couponDaysLeft: 23
      });
      expect(msg).toContain("23");
    });

    it("usa fallback 'ainda disponível' quando couponDaysLeft não é fornecido", () => {
      const msg = buildTouchMessage({
        ...BASE,
        touchType: "dp7",
        couponCode: "ANIVER-AB12"
      });
      expect(msg).toMatch(/disponível/i);
    });

    it("não menciona cupom quando couponCode não é fornecido", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dp7" });
      expect(msg).not.toContain("Código:");
    });

    it("usa 'Cliente' como fallback quando contactName é vazio", () => {
      const msg = buildTouchMessage({ ...BASE, touchType: "dp7", contactName: "" });
      expect(msg).toContain("Cliente");
    });
  });

  // ── Determinismo geral ─────────────────────────────────────────

  it("é determinístico: mesmos params → mesma mensagem", () => {
    const params = { ...BASE, touchType: "d0" as const, couponCode: "ANIVER-AB12" };
    expect(buildTouchMessage(params)).toBe(buildTouchMessage(params));
  });
});
