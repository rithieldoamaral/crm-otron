/**
 * Testes TDD para o helper de fuso horário (Bug #36).
 *
 * Objetivo: provar que a conversão de horário de parede BRT → instante UTC é
 * CORRETA e INDEPENDENTE do fuso do processo. Os testes não dependem de TZ do
 * runner porque comparam diretamente o instante absoluto (toISOString / getTime).
 */

import { brtWallClockToInstant, BRT_OFFSET } from "../timezone";

describe("timezone — brtWallClockToInstant (Bug #36)", () => {
  it("14:00 BRT corresponde a 17:00 UTC", () => {
    const d = brtWallClockToInstant("2026-05-29", "14:00");
    expect(d.toISOString()).toBe("2026-05-29T17:00:00.000Z");
  });

  it("00:00 BRT corresponde a 03:00 UTC do mesmo dia", () => {
    const d = brtWallClockToInstant("2026-01-01", "00:00");
    expect(d.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  it("23:00 BRT corresponde a 02:00 UTC do DIA SEGUINTE", () => {
    // 23:00 -03:00 = 02:00Z do próximo dia — cobre a virada de data em UTC.
    const d = brtWallClockToInstant("2026-05-29", "23:00");
    expect(d.toISOString()).toBe("2026-05-30T02:00:00.000Z");
  });

  it("usa offset fixo -03:00 (sem DST desde 2019)", () => {
    // Janeiro (verão no hemisfério sul) e julho (inverno) devem ter o MESMO offset.
    const verao = brtWallClockToInstant("2026-01-15", "12:00");
    const inverno = brtWallClockToInstant("2026-07-15", "12:00");
    expect(verao.toISOString()).toBe("2026-01-15T15:00:00.000Z");
    expect(inverno.toISOString()).toBe("2026-07-15T15:00:00.000Z");
    expect(BRT_OFFSET).toBe("-03:00");
  });

  it("o instante é estável: o getTime() bate com Date construído explicitamente em UTC", () => {
    const d = brtWallClockToInstant("2026-05-29", "09:30");
    const expected = new Date("2026-05-29T12:30:00.000Z"); // 09:30 BRT = 12:30 UTC
    expect(d.getTime()).toBe(expected.getTime());
  });
});
