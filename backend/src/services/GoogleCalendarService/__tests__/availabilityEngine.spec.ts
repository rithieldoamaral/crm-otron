/**
 * Testes TDD para availabilityEngine.
 * Lógica pura: horários de trabalho + eventos existentes + duração do serviço → slots livres.
 * Sem dependências externas — totalmente determinístico.
 */

import {
  calculateAvailableSlots,
  normalizeWorkingHours,
  isWithinWorkingHours,
  subtractBusyPeriods,
  filterSlotsByPeriod,
  normalizePeriod,
  slotsToRanges,
  formatDateWithWeekdayBRT,
  SlotInput,
  BusyPeriod,
  WorkingDay
} from "../availabilityEngine";

// ─── formatDateWithWeekdayBRT (Problema dia da semana, 2026-06-20) ─────────────

describe("formatDateWithWeekdayBRT", () => {
  it("formata data ISO com dia da semana por extenso", () => {
    // 2026-06-22 é uma SEGUNDA-feira no calendário (sem ambiguidade de TZ)
    expect(formatDateWithWeekdayBRT("2026-06-22")).toBe("segunda-feira, 22/06/2026");
  });

  it("calcula o weekday correto para diferentes dias", () => {
    expect(formatDateWithWeekdayBRT("2026-06-20")).toBe("sábado, 20/06/2026");
    expect(formatDateWithWeekdayBRT("2026-06-21")).toBe("domingo, 21/06/2026");
    expect(formatDateWithWeekdayBRT("2026-05-29")).toBe("sexta-feira, 29/05/2026");
  });

  it("é TZ-independente (não desloca o dia em fusos negativos — anti Bug #10)", () => {
    // new Date("2026-06-22") seria UTC-midnight = 21h de domingo em BRT.
    // A função usa new Date(y,m-1,d) local, então o weekday é estável.
    expect(formatDateWithWeekdayBRT("2026-06-22")).toMatch(/^segunda-feira/);
  });

  it("retorna a string original quando o formato é inválido", () => {
    expect(formatDateWithWeekdayBRT("22/06/2026")).toBe("22/06/2026");
    expect(formatDateWithWeekdayBRT("")).toBe("");
  });
});

describe("normalizeWorkingHours", () => {
  it("retorna true para dia com isWorking true e horários válidos", () => {
    const day: WorkingDay = { dayOfWeek: 1, startTime: "08:00", endTime: "18:00", isWorking: true };
    expect(normalizeWorkingHours(day)).toEqual({ start: "08:00", end: "18:00", works: true });
  });

  it("retorna works:false para dia com isWorking false", () => {
    const day: WorkingDay = { dayOfWeek: 0, startTime: "08:00", endTime: "18:00", isWorking: false };
    expect(normalizeWorkingHours(day)).toEqual({ start: "08:00", end: "18:00", works: false });
  });
});

describe("isWithinWorkingHours", () => {
  it("retorna true para slot dentro do horário de trabalho", () => {
    expect(isWithinWorkingHours("09:00", 60, "08:00", "18:00")).toBe(true);
  });

  it("retorna false para slot que começa antes do início", () => {
    expect(isWithinWorkingHours("07:30", 60, "08:00", "18:00")).toBe(false);
  });

  it("retorna false para slot que termina após o fim do expediente", () => {
    // 17:30 + 60min = 18:30 > 18:00
    expect(isWithinWorkingHours("17:30", 60, "08:00", "18:00")).toBe(false);
  });

  it("retorna true para slot que termina exatamente no fim do expediente", () => {
    // 17:00 + 60min = 18:00 = 18:00 ✅
    expect(isWithinWorkingHours("17:00", 60, "08:00", "18:00")).toBe(true);
  });
});

describe("subtractBusyPeriods", () => {
  it("remove slots que conflitam com período ocupado", () => {
    const slots = ["09:00", "10:00", "11:00", "14:00"];
    const busy: BusyPeriod[] = [{ start: "10:00", end: "12:00" }];
    // 10:00 conflita (está dentro do período 10:00-12:00)
    // 11:00 conflita (está dentro do período 10:00-12:00)
    const result = subtractBusyPeriods(slots, busy, 60);
    expect(result).toEqual(["09:00", "14:00"]);
  });

  it("mantém slots que não conflitam", () => {
    const slots = ["09:00", "14:00", "16:00"];
    const busy: BusyPeriod[] = [{ start: "11:00", end: "13:00" }];
    const result = subtractBusyPeriods(slots, busy, 60);
    expect(result).toEqual(["09:00", "14:00", "16:00"]);
  });

  it("retorna lista vazia quando todos os slots estão ocupados", () => {
    const slots = ["09:00", "10:00"];
    const busy: BusyPeriod[] = [{ start: "09:00", end: "12:00" }];
    const result = subtractBusyPeriods(slots, busy, 60);
    expect(result).toEqual([]);
  });

  it("lida com múltiplos períodos ocupados", () => {
    const slots = ["08:00", "09:00", "10:00", "13:00", "14:00", "15:00"];
    const busy: BusyPeriod[] = [
      { start: "09:00", end: "10:00" },
      { start: "14:00", end: "16:00" }
    ];
    const result = subtractBusyPeriods(slots, busy, 60);
    // "10:00" is available — busy ends at 10:00 (exclusive), slot starts at 10:00
    expect(result).toEqual(["08:00", "10:00", "13:00"]);
  });
});

describe("calculateAvailableSlots", () => {
  const baseInput: SlotInput = {
    date: "2026-05-05", // Segunda-feira
    durationMinutes: 60,
    workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true },
    busyPeriods: []
  };

  it("gera slots corretos com agenda vazia", () => {
    const slots = calculateAvailableSlots(baseInput);
    expect(slots).toContain("09:00");
    expect(slots).toContain("10:00");
    expect(slots).toContain("16:00");
    expect(slots).not.toContain("17:00"); // não cabe 60min a partir das 17h
    expect(slots).not.toContain("08:00"); // fora do horário
  });

  it("retorna lista vazia quando profissional não trabalha naquele dia", () => {
    const input = { ...baseInput, workingHours: { ...baseInput.workingHours, isWorking: false } };
    const slots = calculateAvailableSlots(input);
    expect(slots).toEqual([]);
  });

  it("exclui slots ocupados por eventos do calendário", () => {
    const input = {
      ...baseInput,
      busyPeriods: [{ start: "10:00", end: "12:00" }]
    };
    const slots = calculateAvailableSlots(input);
    expect(slots).toContain("09:00");
    expect(slots).not.toContain("10:00");
    expect(slots).not.toContain("11:00");
    expect(slots).toContain("12:00");
  });

  it("respeita duração de 30 minutos gerando mais slots", () => {
    const input = { ...baseInput, durationMinutes: 30 };
    const slots = calculateAvailableSlots(input);
    expect(slots).toContain("09:00");
    expect(slots).toContain("09:30");
    expect(slots).toContain("10:00");
    // Deve ter mais slots que com 60min
    const slotsFor60 = calculateAvailableSlots(baseInput);
    expect(slots.length).toBeGreaterThan(slotsFor60.length);
  });

  it("respeita duração de 120 minutos gerando menos slots", () => {
    const input = { ...baseInput, durationMinutes: 120 };
    const slots = calculateAvailableSlots(input);
    expect(slots).toContain("09:00");
    expect(slots).toContain("10:00");
    expect(slots).not.toContain("16:00"); // 16:00 + 120min > 17:00
    expect(slots).not.toContain("15:30");
    expect(slots).toContain("15:00"); // 15:00 + 120min = 17:00 ✅
  });

  it("retorna slots corretos quando há múltiplos eventos no dia", () => {
    const input = {
      ...baseInput,
      busyPeriods: [
        { start: "09:00", end: "10:00" },
        { start: "12:00", end: "14:00" }
      ]
    };
    const slots = calculateAvailableSlots(input);
    expect(slots).not.toContain("09:00");
    expect(slots).toContain("10:00");
    expect(slots).not.toContain("12:00");
    expect(slots).not.toContain("13:00");
    expect(slots).toContain("14:00");
  });

  // Bug #12 (Round 4): em 27/04/2026 às 19:46 BRT, a tool oferecia slots
  // 09:00–17:00 ao cliente — todos no PASSADO. O LLM então confirmou um
  // agendamento para 27/04 11:00 (8h atrás). Determinístico: slots
  // anteriores à hora atual no dia de hoje devem ser filtrados.
  describe("filtro de slots passados (bug #12)", () => {
    it("remove slots que já passaram quando date == hoje", () => {
      // 27/04/2026 19:46 BRT (= 22:46 UTC)
      const now = new Date("2026-04-27T22:46:00Z");
      const slots = calculateAvailableSlots({
        date: "2026-04-27",
        durationMinutes: 60,
        workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "23:00", isWorking: true },
        busyPeriods: [],
        now
      });
      // Tudo antes de 19:46 BRT deve sumir
      expect(slots).not.toContain("09:00");
      expect(slots).not.toContain("11:00");
      expect(slots).not.toContain("17:00");
      expect(slots).not.toContain("19:00");
      // Slot >= 20:00 deve permanecer (assumindo expediente até 23:00)
      expect(slots).toContain("20:00");
      expect(slots).toContain("22:00");
    });

    it("mantém todos os slots quando date é amanhã", () => {
      const now = new Date("2026-04-27T22:46:00Z");
      const slots = calculateAvailableSlots({
        date: "2026-04-28", // amanhã
        durationMinutes: 60,
        workingHours: { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isWorking: true },
        busyPeriods: [],
        now
      });
      // Amanhã, mesmo "09:00" sendo "antes" da hora atual de hoje, está liberado
      expect(slots).toContain("09:00");
      expect(slots).toContain("16:00");
    });

    it("retorna lista vazia quando date é uma data passada", () => {
      const now = new Date("2026-04-27T22:46:00Z");
      const slots = calculateAvailableSlots({
        date: "2026-04-26", // ontem
        durationMinutes: 60,
        workingHours: { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isWorking: true },
        busyPeriods: [],
        now
      });
      expect(slots).toEqual([]);
    });

    it("não filtra nada quando now não é informado (compat retroativa)", () => {
      // Sem `now`, o comportamento é idêntico ao original — usado por testes
      // antigos e por cenários onde a chamada não conhece o "agora".
      const slots = calculateAvailableSlots({
        date: "2026-05-05",
        durationMinutes: 60,
        workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true },
        busyPeriods: []
      });
      expect(slots).toContain("09:00");
      expect(slots.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #35 (2026-05-28): filtragem por período do dia (manhã/tarde/noite).
// Causa raiz do erro reportado: o filtro de período era delegado ao LLM
// (gpt-4o-mini), que falhava ao extrair os slots da tarde de uma lista do dia
// inteiro e respondia "não consegui verificar a disponibilidade". Agora a
// filtragem é DETERMINÍSTICA — feita aqui, não pelo modelo probabilístico.
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizePeriod", () => {
  it("normaliza variações de 'manhã' para 'manha'", () => {
    expect(normalizePeriod("manhã")).toBe("manha");
    expect(normalizePeriod("manha")).toBe("manha");
    expect(normalizePeriod("Manhã")).toBe("manha");
    expect(normalizePeriod("morning")).toBe("manha");
    expect(normalizePeriod(" MANHA ")).toBe("manha");
  });

  it("normaliza variações de 'tarde'", () => {
    expect(normalizePeriod("tarde")).toBe("tarde");
    expect(normalizePeriod("Tarde")).toBe("tarde");
    expect(normalizePeriod("afternoon")).toBe("tarde");
    expect(normalizePeriod("à tarde")).toBe("tarde");
  });

  it("normaliza variações de 'noite'", () => {
    expect(normalizePeriod("noite")).toBe("noite");
    expect(normalizePeriod("evening")).toBe("noite");
    expect(normalizePeriod("night")).toBe("noite");
  });

  it("retorna null para entrada vazia, nula ou não reconhecida", () => {
    expect(normalizePeriod(undefined)).toBeNull();
    expect(normalizePeriod(null)).toBeNull();
    expect(normalizePeriod("")).toBeNull();
    expect(normalizePeriod("qualquer coisa")).toBeNull();
  });
});

describe("filterSlotsByPeriod", () => {
  const dayFull = ["08:00", "09:00", "11:00", "12:00", "14:00", "15:00", "18:00", "19:00", "20:00"];

  it("sem período definido, retorna todos os slots (compat retroativa)", () => {
    expect(filterSlotsByPeriod(dayFull, undefined)).toEqual(dayFull);
    expect(filterSlotsByPeriod(dayFull, null)).toEqual(dayFull);
  });

  it("manhã = slots antes de 12:00", () => {
    expect(filterSlotsByPeriod(dayFull, "manha")).toEqual(["08:00", "09:00", "11:00"]);
  });

  it("tarde = slots de 12:00 (inclusive) até antes de 18:00 — corrige o bug reportado", () => {
    expect(filterSlotsByPeriod(dayFull, "tarde")).toEqual(["12:00", "14:00", "15:00"]);
  });

  it("noite = slots a partir de 18:00 (inclusive)", () => {
    expect(filterSlotsByPeriod(dayFull, "noite")).toEqual(["18:00", "19:00", "20:00"]);
  });

  it("12:00 conta como tarde, não manhã (fronteira)", () => {
    expect(filterSlotsByPeriod(["11:59", "12:00"], "manha")).toEqual(["11:59"]);
    expect(filterSlotsByPeriod(["11:59", "12:00"], "tarde")).toEqual(["12:00"]);
  });

  it("18:00 conta como noite, não tarde (fronteira)", () => {
    expect(filterSlotsByPeriod(["17:59", "18:00"], "tarde")).toEqual(["17:59"]);
    expect(filterSlotsByPeriod(["17:59", "18:00"], "noite")).toEqual(["18:00"]);
  });

  it("período sem slots correspondentes retorna lista vazia (não erro)", () => {
    expect(filterSlotsByPeriod(["08:00", "09:00"], "noite")).toEqual([]);
  });

  it("aceita variações de string diretamente (manhã com acento, afternoon)", () => {
    expect(filterSlotsByPeriod(dayFull, "manhã")).toEqual(["08:00", "09:00", "11:00"]);
    expect(filterSlotsByPeriod(dayFull, "afternoon")).toEqual(["12:00", "14:00", "15:00"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #38 (2026-05-31): slots não-alinhados a horas cheias.
//
// Causa raiz: slotInterval = Math.min(durationMinutes, 60) usava a duração
// do serviço como passo. Para "Corte Feminino" com 58 min, o grid partia de
// 09:00 e avançava 58 min a cada slot → 09:00, 09:58, 10:56, 11:54, 12:52, …
// O filtro de "tarde" (≥12:00) devolvia 12:52, 13:50, 14:48, 15:46, 16:44 —
// horários estranhos que confundiam o cliente.
//
// Fix: slotInterval = durationMinutes ≤ 30 ? 30 : 60.
// Serviços ≤ 30 min → grid de meia-hora. Demais → grid de hora cheia.
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateAvailableSlots — Bug #38: alinhamento a horas cheias", () => {
  it("serviço de 58 min gera slots em horas cheias (09:00, 10:00, …), não em 09:58, 10:56…", () => {
    const slots = calculateAvailableSlots({
      date: "2026-06-01",
      durationMinutes: 58,
      workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true },
      busyPeriods: []
    });
    // Com o fix, passo = 60 min → slots em hora cheia
    expect(slots).toContain("09:00");
    expect(slots).toContain("10:00");
    expect(slots).toContain("11:00");
    expect(slots).toContain("12:00");
    expect(slots).toContain("17:00"); // 17:00+58=17:58 ≤ 18:00 ✅
    // Horários quebrados não devem existir
    expect(slots).not.toContain("09:58");
    expect(slots).not.toContain("10:56");
    expect(slots).not.toContain("12:52");
  });

  it("serviço de 45 min gera slots em horas cheias", () => {
    const slots = calculateAvailableSlots({
      date: "2026-06-01",
      durationMinutes: 45,
      workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isWorking: true },
      busyPeriods: []
    });
    expect(slots).toContain("09:00");
    expect(slots).toContain("10:00");
    expect(slots).not.toContain("09:45"); // sem grade de 45 min
    expect(slots).toContain("16:00"); // 16:00+45=16:45 ≤ 17:00 ✅
    expect(slots).not.toContain("17:00"); // 17:00+45=17:45 > 17:00 ✗... aguarda: 17:00+45=17:45 ≤ 17:00? Não
    // wait: 17:00+45=17:45 mas workEnd=17:00, então não deve aparecer
    // Corrigindo: 16:00+45=16:45 ≤ 17:00 ✅; 17:00+45=17:45 > 17:00 ✗
    expect(slots).not.toContain("17:00");
  });

  it("serviço de 30 min mantém grade de meia-hora (sem quebra)", () => {
    const slots = calculateAvailableSlots({
      date: "2026-06-01",
      durationMinutes: 30,
      workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "11:00", isWorking: true },
      busyPeriods: []
    });
    expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("filtro de tarde com serviço de 58 min retorna horas cheias (regressão do bug reportado)", () => {
    const allSlots = calculateAvailableSlots({
      date: "2026-06-01",
      durationMinutes: 58,
      workingHours: { dayOfWeek: 1, startTime: "09:00", endTime: "18:00", isWorking: true },
      busyPeriods: []
    });
    const tarde = filterSlotsByPeriod(allSlots, "tarde");
    // Deve conter horas cheias de 12h a 17h (todos cabem: +58 ≤ 18h)
    expect(tarde).toContain("12:00");
    expect(tarde).toContain("13:00");
    expect(tarde).toContain("14:00");
    expect(tarde).toContain("15:00");
    expect(tarde).toContain("16:00");
    expect(tarde).toContain("17:00");
    // Sem horários quebrados
    expect(tarde).not.toContain("12:52");
    expect(tarde).not.toContain("13:50");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature UX-1 (2026-05-31): slotsToRanges — exibição como faixa de horário.
//
// Em vez de listar "12:00, 13:00, 14:00, 15:00, 16:00, 17:00", o agente
// apresenta "temos horários das 12:00 às 18:00" ou, com lacunas:
// "das 13:00 às 15:00 e das 17:00 às 18:00".
// ─────────────────────────────────────────────────────────────────────────────
describe("slotsToRanges", () => {
  it("lista vazia retorna string vazia", () => {
    expect(slotsToRanges([], 60)).toBe("");
  });

  it("slot único (60 min) → 'das HH:MM às HH+1:MM'", () => {
    expect(slotsToRanges(["14:00"], 60)).toBe("das 14:00 às 15:00");
  });

  it("slot único (25 min) → range com passo de 30 min", () => {
    expect(slotsToRanges(["14:30"], 25)).toBe("das 14:30 às 15:00");
  });

  it("tarde inteira livre (agenda vazia) → faixa única", () => {
    // 6 slots contíguos de 12h a 17h, duration=58 → "das 12:00 às 18:00"
    const slots = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
    expect(slotsToRanges(slots, 58)).toBe("das 12:00 às 18:00");
  });

  it("lacuna no meio → duas faixas separadas", () => {
    // ["13:00", "14:00", "16:00", "17:00"]: lacuna em 15:00
    const slots = ["13:00", "14:00", "16:00", "17:00"];
    expect(slotsToRanges(slots, 60)).toBe("das 13:00 às 15:00 e das 16:00 às 18:00");
  });

  it("três faixas separadas → todas unidas com ' e '", () => {
    const slots = ["09:00", "11:00", "14:00", "15:00"];
    // 09:00 isolado; lacuna 09→11; 11 isolado; lacuna 11→14; 14→15 contíguos
    expect(slotsToRanges(slots, 60)).toBe("das 09:00 às 10:00 e das 11:00 às 12:00 e das 14:00 às 16:00");
  });

  it("serviço de 90 min com agenda vazia (09:00 a 17:00) → last slot = 15:00", () => {
    // slots: 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00 (15+90=17:00 ✅; 16:00+90=18:00 > 17:00 ✗)
    const slots = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
    expect(slotsToRanges(slots, 90)).toBe("das 09:00 às 16:00");
  });
});
