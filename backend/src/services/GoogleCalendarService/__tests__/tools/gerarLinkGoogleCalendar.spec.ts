/**
 * Testes TDD para gerarLinkGoogleCalendar.
 *
 * Gera um link pré-preenchido do Google Calendar para o cliente adicionar
 * o agendamento ao seu calendário pessoal com um clique, sem necessidade
 * de email ou OAuth.
 */

import { gerarLinkGoogleCalendar } from "../../tools/gerarLinkGoogleCalendar";

const BASE = {
  title: "Reparo de dentes",
  data: "2026-05-11",
  hora: "14:00",
  durationMinutes: 60,
};

describe("gerarLinkGoogleCalendar — estrutura da URL", () => {
  it("retorna URL que começa com https://calendar.google.com/calendar/render", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render/);
  });

  it("inclui action=TEMPLATE obrigatório", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toContain("action=TEMPLATE");
  });

  it("inclui parâmetro text com o título", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toContain("text=");
    // "Reparo" deve estar presente (parte inicial do título)
    expect(link).toMatch(/text=.*Reparo/);
  });

  it("inclui parâmetro dates", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toContain("dates=");
  });
});

describe("gerarLinkGoogleCalendar — data/hora", () => {
  it("formata data de início como YYYYMMDDTHHmmss", () => {
    const link = gerarLinkGoogleCalendar(BASE); // 2026-05-11 14:00
    expect(link).toContain("20260511T140000");
  });

  it("calcula data de fim: 14:00 + 60min = 15:00", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toContain("20260511T150000");
  });

  it("calcula fim corretamente quando cruza meia-hora (14:45 + 30min = 15:15)", () => {
    const link = gerarLinkGoogleCalendar({ ...BASE, hora: "14:45", durationMinutes: 30 });
    expect(link).toContain("20260511T151500");
  });

  it("calcula fim corretamente quando ultrapassa a hora cheia (14:50 + 45min = 15:35)", () => {
    const link = gerarLinkGoogleCalendar({ ...BASE, hora: "14:50", durationMinutes: 45 });
    expect(link).toContain("20260511T153500");
  });

  it("avança o dia quando fim ultrapassa meia-noite (23:30 + 60min = 00:30 do dia seguinte)", () => {
    const link = gerarLinkGoogleCalendar({ ...BASE, hora: "23:30", durationMinutes: 60 });
    // Deve ser dia 12, às 00:30
    expect(link).toContain("20260512T003000");
  });

  it("duração de 90min: 09:00 → 10:30", () => {
    const link = gerarLinkGoogleCalendar({ ...BASE, hora: "09:00", durationMinutes: 90 });
    expect(link).toContain("20260511T090000");
    expect(link).toContain("20260511T103000");
  });
});

describe("gerarLinkGoogleCalendar — parâmetro details", () => {
  it("inclui details na URL quando fornecido", () => {
    const link = gerarLinkGoogleCalendar({ ...BASE, details: "Profissional: Dr. Carlos" });
    expect(link).toContain("details=");
  });

  it("NÃO inclui details quando não fornecido", () => {
    const link = gerarLinkGoogleCalendar(BASE); // sem details
    expect(link).not.toContain("details=");
  });
});

describe("gerarLinkGoogleCalendar — encoding", () => {
  it("codifica caracteres especiais no título (acentos/espaços)", () => {
    const link = gerarLinkGoogleCalendar({
      ...BASE,
      title: "Corte & Barba — Salão São Paulo",
    });
    // URL deve ser válida (sem espaços literais)
    expect(link).not.toContain(" — ");
    expect(link).not.toContain(" ");
    // Mas o conteúdo codificado deve estar presente
    expect(link).toContain("Corte");
  });

  it("retorna string sem quebras de linha ou espaços iniciais/finais", () => {
    const link = gerarLinkGoogleCalendar(BASE);
    expect(link).toBe(link.trim());
    expect(link).not.toContain("\n");
  });
});
