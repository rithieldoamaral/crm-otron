/**
 * Testes TDD para DormantDetectionService.
 *
 * Cobre o algoritmo de classificação de status de retenção baseado em
 * ServiceHistory. A lógica é pura (não toca DB nem rede), então os testes
 * trabalham diretamente sobre o output do `classify()`.
 *
 * Faixas esperadas (ratio = daysSinceLastService / averageInterval):
 *   - novo:            < 3 serviços no histórico
 *   - em_dia:          ratio < 0.8
 *   - quase_na_hora:   0.8 ≤ ratio < 1.2
 *   - atrasado:        1.2 ≤ ratio < 2.0
 *   - adormecido:      2.0 ≤ ratio < 4.0
 *   - perdido:         ratio ≥ 4.0
 */

import {
  classify,
  calculateAverageInterval,
  daysBetween,
  DormantStatus
} from "../DormantDetectionService";

// Helper: cria data X dias atrás (relativa a "agora")
const daysAgo = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0); // Meio-dia para evitar problemas de fuso
  return d;
};

// Helper: cria array de serviços com datas (em dias atrás)
const buildServices = (daysAgoList: number[]) =>
  daysAgoList.map((d, i) => ({ occurredAt: daysAgo(d), id: i + 1 }));

describe("daysBetween", () => {
  it("retorna 0 para a mesma data", () => {
    const d = new Date();
    expect(daysBetween(d, d)).toBe(0);
  });

  it("retorna diferença positiva quando a primeira data é mais recente", () => {
    const recente = daysAgo(0);
    const antiga = daysAgo(10);
    expect(daysBetween(recente, antiga)).toBe(10);
  });

  it("é simétrico (retorna valor absoluto)", () => {
    const a = daysAgo(0);
    const b = daysAgo(7);
    expect(daysBetween(a, b)).toBe(daysBetween(b, a));
  });
});

describe("calculateAverageInterval", () => {
  it("calcula corretamente para barbearia (visitas a cada 30 dias)", () => {
    // Cliente vem dia 0, -30, -60, -90 → intervalos: [30, 30, 30]
    const services = buildServices([0, 30, 60, 90]);
    expect(calculateAverageInterval(services)).toBe(30);
  });

  it("calcula média com intervalos variados", () => {
    // Intervalos: [20, 30, 40] → média = 30
    const services = buildServices([0, 20, 50, 90]);
    expect(calculateAverageInterval(services)).toBe(30);
  });

  it("usa apenas os 5 intervalos mais recentes mesmo com histórico maior", () => {
    // 10 visitas: as 5 mais recentes têm intervalo 30, as outras intervalo 60
    // Média deve refletir só as 5 recentes = 30
    const services = buildServices([0, 30, 60, 90, 120, 150, 210, 270, 330, 390]);
    expect(calculateAverageInterval(services)).toBe(30);
  });

  it("retorna 0 se há menos de 2 serviços (sem intervalo possível)", () => {
    expect(calculateAverageInterval(buildServices([0]))).toBe(0);
    expect(calculateAverageInterval([])).toBe(0);
  });
});

describe("classify — status 'novo'", () => {
  it("retorna 'novo' quando cliente tem 0 serviços", () => {
    const result = classify([]);
    expect(result.status).toBe("novo");
    expect(result.totalServices).toBe(0);
  });

  it("retorna 'novo' quando cliente tem 1 serviço", () => {
    const result = classify(buildServices([5]));
    expect(result.status).toBe("novo");
    expect(result.totalServices).toBe(1);
  });

  it("retorna 'novo' quando cliente tem 2 serviços (precisa 3 para classificar)", () => {
    const result = classify(buildServices([5, 35]));
    expect(result.status).toBe("novo");
    expect(result.totalServices).toBe(2);
  });
});

describe("classify — status 'em_dia'", () => {
  it("retorna 'em_dia' quando dias_desde < 0.8x do intervalo médio", () => {
    // Intervalo médio 30 dias, última visita há 10 dias → ratio = 0.33
    const services = buildServices([10, 40, 70, 100]);
    const result = classify(services);
    expect(result.status).toBe("em_dia");
    expect(result.ratio).toBeLessThan(0.8);
  });

  it("retorna 'em_dia' no caso limite (ratio = 0.79)", () => {
    // Intervalo médio 30, última visita há 23 dias → ratio = 0.766
    const services = buildServices([23, 53, 83, 113]);
    const result = classify(services);
    expect(result.status).toBe("em_dia");
  });
});

describe("classify — status 'quase_na_hora'", () => {
  it("retorna 'quase_na_hora' quando ratio está entre 0.8 e 1.2", () => {
    // Intervalo médio 30, última visita há 30 dias → ratio = 1.0
    const services = buildServices([30, 60, 90, 120]);
    const result = classify(services);
    expect(result.status).toBe("quase_na_hora");
    expect(result.ratio).toBeGreaterThanOrEqual(0.8);
    expect(result.ratio).toBeLessThan(1.2);
  });
});

describe("classify — status 'atrasado'", () => {
  it("retorna 'atrasado' quando ratio está entre 1.2 e 2.0", () => {
    // Intervalo médio 30, última visita há 45 dias → ratio = 1.5
    const services = buildServices([45, 75, 105, 135]);
    const result = classify(services);
    expect(result.status).toBe("atrasado");
  });

  it("retorna 'atrasado' no limite inferior (ratio = 1.2)", () => {
    // Intervalo médio 30, última visita há 36 dias → ratio = 1.2
    const services = buildServices([36, 66, 96, 126]);
    const result = classify(services);
    expect(result.status).toBe("atrasado");
  });
});

describe("classify — status 'adormecido'", () => {
  it("retorna 'adormecido' quando ratio está entre 2.0 e 4.0", () => {
    // Intervalo médio 30, última visita há 90 dias → ratio = 3.0
    const services = buildServices([90, 120, 150, 180]);
    const result = classify(services);
    expect(result.status).toBe("adormecido");
  });

  it("é o caso do exemplo Maria (faltou 67 dias com intervalo médio 30)", () => {
    // Cenário do mockup: Maria Silva, 67 dias sem aparecer
    // Intervalo médio 30 → ratio = 2.23 → adormecido
    const services = buildServices([67, 97, 127, 157, 187]);
    const result = classify(services);
    expect(result.status).toBe("adormecido");
    expect(result.daysSinceLastService).toBe(67);
  });
});

describe("classify — status 'perdido'", () => {
  it("retorna 'perdido' quando ratio >= 4.0", () => {
    // Intervalo médio 30, última visita há 180 dias → ratio = 6.0
    const services = buildServices([180, 210, 240, 270]);
    const result = classify(services);
    expect(result.status).toBe("perdido");
  });

  it("considera perdido alguém que não aparece há 1 ano com ciclo mensal", () => {
    // Intervalo médio 30, última visita há 365 dias → ratio = 12.16
    const services = buildServices([365, 395, 425, 455, 485]);
    const result = classify(services);
    expect(result.status).toBe("perdido");
    expect(result.ratio).toBeGreaterThan(4);
  });
});

describe("classify — output completo", () => {
  it("retorna todos os campos esperados do DormantStatus", () => {
    const services = buildServices([30, 60, 90, 120]);
    const result: DormantStatus = classify(services);

    expect(result).toMatchObject({
      status: expect.any(String),
      daysSinceLastService: expect.any(Number),
      averageInterval: expect.any(Number),
      ratio: expect.any(Number),
      totalServices: expect.any(Number)
    });
  });

  it("daysSinceLastService reflete a última visita (mais recente)", () => {
    const services = buildServices([5, 35, 65, 95]);
    const result = classify(services);
    expect(result.daysSinceLastService).toBe(5);
  });

  it("ratio = daysSinceLastService / averageInterval", () => {
    // 10 dias desde última, intervalo médio 30 → ratio = 0.333
    const services = buildServices([10, 40, 70, 100]);
    const result = classify(services);
    expect(result.ratio).toBeCloseTo(10 / 30, 2);
  });
});

describe("classify — edge cases", () => {
  it("lida com serviços em ordem aleatória (deve ordenar internamente)", () => {
    // Mesmo conjunto, ordem embaralhada
    const ordenado = buildServices([30, 60, 90, 120]);
    const embaralhado = [ordenado[2], ordenado[0], ordenado[3], ordenado[1]];

    expect(classify(ordenado).status).toBe(classify(embaralhado).status);
    expect(classify(ordenado).daysSinceLastService).toBe(
      classify(embaralhado).daysSinceLastService
    );
  });

  it("classifica corretamente cliente que vinha sempre e sumiu", () => {
    // Cliente vinha religiosamente a cada 14 dias, agora sumiu há 120 dias
    // Histórico: hoje-120, hoje-134, hoje-148, hoje-162, hoje-176
    // Intervalo médio = 14, ratio = 120/14 = 8.57 → perdido
    const services = buildServices([120, 134, 148, 162, 176]);
    const result = classify(services);
    expect(result.status).toBe("perdido");
    expect(result.averageInterval).toBe(14);
  });

  it("considera datas no mesmo dia como intervalo 0 (não NaN/Infinity)", () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const services = [
      { occurredAt: today, id: 1 },
      { occurredAt: today, id: 2 },
      { occurredAt: today, id: 3 }
    ];
    const result = classify(services);
    expect(Number.isFinite(result.ratio)).toBe(true);
  });
});
