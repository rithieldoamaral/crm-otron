/**
 * Testes TDD para RetentionService.utils — lógica pura.
 *
 * Foco:
 *   - `isDormantStatus`     — quais status são "dormentes" por default e custom
 *   - `buildDormantSummary` — contagens, urgência e edge cases
 *
 * A camada de I/O (listDormant, getSummary, etc.) depende de Sequelize
 * e é coberta por testes de integração em staging.
 */

import {
  isDormantStatus,
  buildDormantSummary,
  DEFAULT_DORMANT_STATUSES
} from "../RetentionService.utils";
import { DormantStatusType } from "../DormantDetectionService";

// ── isDormantStatus ─────────────────────────────────────────────────

describe("isDormantStatus — filtro padrão de dormentes", () => {
  it("retorna true para 'atrasado' (padrão)", () => {
    expect(isDormantStatus("atrasado")).toBe(true);
  });

  it("retorna true para 'adormecido' (padrão)", () => {
    expect(isDormantStatus("adormecido")).toBe(true);
  });

  it("retorna true para 'perdido' (padrão)", () => {
    expect(isDormantStatus("perdido")).toBe(true);
  });

  it("retorna false para 'em_dia' (clientes saudáveis não aparecem na lista)", () => {
    expect(isDormantStatus("em_dia")).toBe(false);
  });

  it("retorna false para 'novo' (clientes novos não estão dormentes)", () => {
    expect(isDormantStatus("novo")).toBe(false);
  });

  it("retorna false para 'quase_na_hora'", () => {
    expect(isDormantStatus("quase_na_hora")).toBe(false);
  });

  it("DEFAULT_DORMANT_STATUSES contém exatamente 3 statuses", () => {
    expect(DEFAULT_DORMANT_STATUSES).toHaveLength(3);
    expect(DEFAULT_DORMANT_STATUSES).toContain("atrasado");
    expect(DEFAULT_DORMANT_STATUSES).toContain("adormecido");
    expect(DEFAULT_DORMANT_STATUSES).toContain("perdido");
  });
});

describe("isDormantStatus — filtro customizado", () => {
  it("aceita lista customizada de statuses", () => {
    expect(isDormantStatus("quase_na_hora", ["quase_na_hora"])).toBe(true);
  });

  it("lista customizada com apenas 'perdido' exclui atrasado e adormecido", () => {
    const filter: DormantStatusType[] = ["perdido"];
    expect(isDormantStatus("perdido", filter)).toBe(true);
    expect(isDormantStatus("atrasado", filter)).toBe(false);
    expect(isDormantStatus("adormecido", filter)).toBe(false);
  });

  it("lista customizada vazia retorna false para qualquer status", () => {
    expect(isDormantStatus("perdido", [])).toBe(false);
    expect(isDormantStatus("atrasado", [])).toBe(false);
  });
});

// ── buildDormantSummary ─────────────────────────────────────────────

describe("buildDormantSummary — contagens corretas", () => {
  it("retorna zeros e urgency=low para lista vazia", () => {
    const result = buildDormantSummary([]);
    expect(result.total).toBe(0);
    expect(result.atrasado).toBe(0);
    expect(result.adormecido).toBe(0);
    expect(result.perdido).toBe(0);
    expect(result.urgency).toBe("low");
  });

  it("conta corretamente os 3 status dormentes", () => {
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "atrasado" as DormantStatusType },
      { status: "adormecido" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    const result = buildDormantSummary(entries);
    expect(result.total).toBe(4);
    expect(result.atrasado).toBe(2);
    expect(result.adormecido).toBe(1);
    expect(result.perdido).toBe(1);
  });

  it("ignora status 'em_dia' e 'novo' no total (lista já filtrada)", () => {
    // buildDormantSummary recebe lista já filtrada — outros status são irrelevantes
    const entries = [
      { status: "em_dia" as DormantStatusType },    // não conta
      { status: "novo" as DormantStatusType },       // não conta
      { status: "adormecido" as DormantStatusType }  // conta
    ];
    const result = buildDormantSummary(entries);
    // total = só os 3 tipos dormentes (atrasado + adormecido + perdido)
    expect(result.adormecido).toBe(1);
    expect(result.atrasado).toBe(0);
    expect(result.perdido).toBe(0);
    expect(result.total).toBe(1); // apenas adormecido entra no total
  });
});

describe("buildDormantSummary — cálculo de urgência", () => {
  it("urgency=low quando não há clientes perdidos", () => {
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "adormecido" as DormantStatusType }
    ];
    expect(buildDormantSummary(entries).urgency).toBe("low");
  });

  it("urgency=medium quando há perdidos mas <= 25%", () => {
    // 3 atrasados + 1 perdido = 25% exato → ainda medium
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "atrasado" as DormantStatusType },
      { status: "atrasado" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    expect(buildDormantSummary(entries).urgency).toBe("medium");
  });

  it("urgency=high quando perdidos > 25%", () => {
    // 1 atrasado + 2 perdidos = 66% perdidos
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "perdido" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    expect(buildDormantSummary(entries).urgency).toBe("high");
  });

  it("urgency=high com 100% perdidos", () => {
    const entries = [
      { status: "perdido" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    expect(buildDormantSummary(entries).urgency).toBe("high");
  });

  it("urgency=low para lista vazia (sem clientes dormentes)", () => {
    expect(buildDormantSummary([]).urgency).toBe("low");
  });

  it("urgency=medium com exatamente 1 perdido entre muitos", () => {
    // 10 atrasados + 1 perdido = 9.09% → medium (> 0, <= 25%)
    const entries: { status: DormantStatusType }[] = [
      ...Array(10).fill({ status: "atrasado" }),
      { status: "perdido" }
    ];
    expect(buildDormantSummary(entries).urgency).toBe("medium");
  });
});

describe("buildDormantSummary — pureza e edge cases", () => {
  it("não muta o array de entrada", () => {
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    const before = [...entries];
    buildDormantSummary(entries);
    expect(entries).toEqual(before);
  });

  it("é determinística: mesmo input, mesmo output", () => {
    const entries = [
      { status: "atrasado" as DormantStatusType },
      { status: "perdido" as DormantStatusType }
    ];
    expect(buildDormantSummary(entries)).toEqual(buildDormantSummary(entries));
  });
});
