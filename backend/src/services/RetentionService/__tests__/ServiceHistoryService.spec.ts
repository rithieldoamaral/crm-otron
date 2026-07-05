/**
 * Testes TDD para ServiceHistoryService.utils — lógica pura.
 *
 * Foco: `hasCompletionTag` que decide se a lista de tags de um ticket
 * contém a tag de conclusão do funil Kanban.
 *
 * A camada de I/O (`recordKanbanCompletion`, `listForContact`, etc.) depende
 * de Sequelize + Socket (UpdateTicketService) e é coberta por testes de
 * integração em staging — mesmo padrão do AutoCloseScheduledService.
 *
 * Regra da função:
 *   - Retorna true SE ao menos uma tag tem `isCompletionTag === true`
 *   - Retorna false para array vazio, undefined, false ou ausente
 */

import { hasCompletionTag, groupHistoryByContact } from "../ServiceHistoryService.utils";

// ── Helpers ────────────────────────────────────────────────────────

const makeTag = (isCompletionTag?: boolean) => ({ isCompletionTag });

// ── casos de RETORNAR TRUE ──────────────────────────────────────────

describe("hasCompletionTag — casos de TRUE (tem tag de conclusão)", () => {
  it("retorna true quando única tag tem isCompletionTag = true", () => {
    expect(hasCompletionTag([makeTag(true)])).toBe(true);
  });

  it("retorna true quando uma tag entre várias tem isCompletionTag = true", () => {
    const tags = [
      makeTag(false),
      makeTag(true),
      makeTag(false)
    ];
    expect(hasCompletionTag(tags)).toBe(true);
  });

  it("retorna true quando a ÚLTIMA tag da lista é de conclusão", () => {
    const tags = [makeTag(false), makeTag(false), makeTag(true)];
    expect(hasCompletionTag(tags)).toBe(true);
  });

  it("retorna true quando a PRIMEIRA tag da lista é de conclusão", () => {
    const tags = [makeTag(true), makeTag(false), makeTag(false)];
    expect(hasCompletionTag(tags)).toBe(true);
  });

  it("retorna true mesmo com muitas tags normais e uma de conclusão", () => {
    const normal = Array.from({ length: 10 }, () => makeTag(false));
    const tags = [...normal, makeTag(true)];
    expect(hasCompletionTag(tags)).toBe(true);
  });
});

// ── casos de RETORNAR FALSE ─────────────────────────────────────────

describe("hasCompletionTag — casos de FALSE (sem tag de conclusão)", () => {
  it("retorna false para array vazio", () => {
    expect(hasCompletionTag([])).toBe(false);
  });

  it("retorna false quando todas as tags têm isCompletionTag = false", () => {
    const tags = [makeTag(false), makeTag(false), makeTag(false)];
    expect(hasCompletionTag(tags)).toBe(false);
  });

  it("retorna false quando isCompletionTag é undefined (campo ausente)", () => {
    const tags = [makeTag(undefined), makeTag(undefined)];
    expect(hasCompletionTag(tags)).toBe(false);
  });

  it("retorna false quando isCompletionTag está ausente do objeto", () => {
    // Stubs vindos do frontend podem não ter o campo
    const tags = [{ name: "etiqueta" } as any, { name: "outro" } as any];
    expect(hasCompletionTag(tags)).toBe(false);
  });

  it("retorna false para tag com isCompletionTag como string 'true' (type coercion guard)", () => {
    // Deve ser === true (strict), não truthy
    const tags = [{ isCompletionTag: "true" as any }];
    expect(hasCompletionTag(tags)).toBe(false);
  });

  it("retorna false para tag com isCompletionTag = 1 (number truthy)", () => {
    // Deve ser === true (strict), não truthy
    const tags = [{ isCompletionTag: 1 as any }];
    expect(hasCompletionTag(tags)).toBe(false);
  });
});

// ── groupHistoryByContact (ITEM C — elimina N+1 sem mudar números) ──────
describe("groupHistoryByContact", () => {
  const d = (iso: string) => ({ occurredAt: new Date(iso) });
  const row = (contactId: number, iso: string) => ({ contactId, ...d(iso) });

  it("agrupa registros por contactId", () => {
    const grouped = groupHistoryByContact([
      row(1, "2026-05-10"),
      row(2, "2026-05-05"),
      row(1, "2026-04-01")
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get(1)!.length).toBe(2);
    expect(grouped.get(2)!.length).toBe(1);
  });

  it("mantém cada grupo ordenado DESC por occurredAt (paridade com listForContact)", () => {
    const grouped = groupHistoryByContact([
      row(1, "2026-01-01"),
      row(1, "2026-05-10"),
      row(1, "2026-03-03")
    ]);
    const dates = grouped.get(1)!.map(r => r.occurredAt.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-05-10", "2026-03-03", "2026-01-01"]);
  });

  it("aplica o cap de `limit` mantendo os MAIS RECENTES (igual a ORDER BY DESC LIMIT n)", () => {
    const rows = [
      row(1, "2026-01-01"),
      row(1, "2026-02-01"),
      row(1, "2026-03-01"),
      row(1, "2026-04-01")
    ];
    const grouped = groupHistoryByContact(rows, 2);
    const dates = grouped.get(1)!.map(r => r.occurredAt.toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-04-01", "2026-03-01"]);
  });

  it("preserva EXATAMENTE os mesmos registros que N queries listForContact dariam", () => {
    // Simula o resultado de uma query global ORDER BY occurredAt DESC.
    const flat = [
      row(1, "2026-05-01"),
      row(2, "2026-04-20"),
      row(1, "2026-03-15"),
      row(3, "2026-03-10"),
      row(2, "2026-02-01")
    ];
    const grouped = groupHistoryByContact(flat, 50);
    expect(grouped.get(1)!.map(r => r.occurredAt.getTime())).toEqual([
      new Date("2026-05-01").getTime(),
      new Date("2026-03-15").getTime()
    ]);
    expect(grouped.get(2)!.map(r => r.occurredAt.getTime())).toEqual([
      new Date("2026-04-20").getTime(),
      new Date("2026-02-01").getTime()
    ]);
    expect(grouped.get(3)!.length).toBe(1);
  });

  it("ignora registros sem contactId", () => {
    const grouped = groupHistoryByContact([
      { contactId: null as any, occurredAt: new Date("2026-05-01") },
      row(1, "2026-05-02")
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.has(1)).toBe(true);
  });

  it("limit <= 0 retorna grupos vazios (sem lançar)", () => {
    const grouped = groupHistoryByContact([row(1, "2026-05-01")], 0);
    expect(grouped.get(1)).toEqual([]);
  });

  it("array vazio retorna mapa vazio", () => {
    expect(groupHistoryByContact([]).size).toBe(0);
  });
});

// ── edge cases ──────────────────────────────────────────────────────

describe("hasCompletionTag — edge cases", () => {
  it("retorna false quando array contém null/undefined como elementos", () => {
    // Tags com campo null também não são conclusivas
    const tags = [{ isCompletionTag: null as any }, { isCompletionTag: undefined }];
    expect(hasCompletionTag(tags)).toBe(false);
  });

  it("é determinística — mesmo input, mesmo output (sem side-effects)", () => {
    const tags = [makeTag(false), makeTag(true)];
    const result1 = hasCompletionTag(tags);
    const result2 = hasCompletionTag(tags);
    expect(result1).toBe(result2);
    expect(result1).toBe(true);
  });

  it("não muta o array original", () => {
    const tags = [makeTag(false), makeTag(true)];
    const original = [...tags];
    hasCompletionTag(tags);
    expect(tags).toEqual(original);
  });
});
