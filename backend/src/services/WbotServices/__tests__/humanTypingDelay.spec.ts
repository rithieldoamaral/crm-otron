/**
 * Testes TDD para humanTypingDelay — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * Contexto (2026-07-26): a fórmula anterior era
 *   min(1500 + len*15, 5000)
 * = 15ms por caractere ≈ 4.000 palavras/minuto, com teto de 5s. Velocidade
 * sobre-humana + intervalo determinístico são dois dos sinais de maior peso
 * nos modelos de detecção de automação da Meta. Estes testes fixam o novo
 * comportamento: velocidade humana + jitter aleatório.
 */

import {
  calculateTypingDelayMs,
  waitWithTypingIndicator,
  TYPING_MIN_MS,
  TYPING_MAX_MS,
} from "../humanTypingDelay";

describe("calculateTypingDelayMs", () => {
  // random fixo em 0.5 → jitter neutro (fator 1.0), tornando o cálculo determinístico
  const noJitter = () => 0.5;

  it("respeita o piso mínimo para mensagens muito curtas", () => {
    const delay = calculateTypingDelayMs("Oi", noJitter);
    expect(delay).toBeGreaterThanOrEqual(TYPING_MIN_MS);
  });

  it("respeita o teto máximo para mensagens muito longas", () => {
    const textoEnorme = "a".repeat(5000);
    const delay = calculateTypingDelayMs(textoEnorme, noJitter);
    expect(delay).toBeLessThanOrEqual(TYPING_MAX_MS);
  });

  it("escala com o tamanho do texto (mensagem maior demora mais)", () => {
    const curta = calculateTypingDelayMs("Oi, tudo bem?", noJitter);
    const longa = calculateTypingDelayMs("Oi, tudo bem? ".repeat(10), noJitter);
    expect(longa).toBeGreaterThan(curta);
  });

  it("REGRESSÃO: mensagem de 200 caracteres leva muito mais que os 5s antigos", () => {
    // A fórmula antiga entregava exatamente 4.500ms para 200 chars.
    // Velocidade humana real (~40-60 WPM) exige dezenas de segundos.
    const delay = calculateTypingDelayMs("a".repeat(200), noJitter);
    expect(delay).toBeGreaterThan(15000);
  });

  it("aplica jitter: randoms diferentes produzem tempos diferentes para o mesmo texto", () => {
    const texto = "Podemos agendar para amanhã às 14h?";
    const lento = calculateTypingDelayMs(texto, () => 0.99);
    const rapido = calculateTypingDelayMs(texto, () => 0.01);

    expect(lento).not.toBe(rapido);
    expect(lento).toBeGreaterThan(rapido);
  });

  it("mantém o jitter dentro de uma faixa plausível (não gera outliers absurdos)", () => {
    const texto = "a".repeat(50);
    const neutro = calculateTypingDelayMs(texto, () => 0.5);
    const extremoLento = calculateTypingDelayMs(texto, () => 1);
    const extremoRapido = calculateTypingDelayMs(texto, () => 0);

    // Jitter limitado a ±30% — evita tanto resposta instantânea quanto espera absurda
    expect(extremoLento).toBeLessThanOrEqual(Math.round(neutro * 1.35));
    expect(extremoRapido).toBeGreaterThanOrEqual(Math.round(neutro * 0.65));
  });

  it("nunca retorna valor negativo ou zero para texto vazio", () => {
    expect(calculateTypingDelayMs("", noJitter)).toBeGreaterThanOrEqual(TYPING_MIN_MS);
  });
});

describe("waitWithTypingIndicator", () => {
  let wbot: { sendPresenceUpdate: jest.Mock };
  let sleepCalls: number[];
  const fakeSleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  beforeEach(() => {
    wbot = { sendPresenceUpdate: jest.fn().mockResolvedValue(undefined) };
    sleepCalls = [];
  });

  it("sinaliza 'composing' antes de esperar e 'paused' ao final", async () => {
    await waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 3000, fakeSleep);

    const estados = wbot.sendPresenceUpdate.mock.calls.map((c) => c[0]);
    expect(estados[0]).toBe("composing");
    expect(estados[estados.length - 1]).toBe("paused");
  });

  it("renova o 'composing' em esperas longas (indicador do WhatsApp expira ~10s)", async () => {
    // 30s de espera precisa de várias renovações, senão o contato vê o
    // "digitando..." sumir e a mensagem chegar do nada depois.
    await waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 30000, fakeSleep);

    const composings = wbot.sendPresenceUpdate.mock.calls.filter(
      (c) => c[0] === "composing"
    );
    expect(composings.length).toBeGreaterThan(1);
  });

  it("não renova desnecessariamente em esperas curtas", async () => {
    await waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 2000, fakeSleep);

    const composings = wbot.sendPresenceUpdate.mock.calls.filter(
      (c) => c[0] === "composing"
    );
    expect(composings.length).toBe(1);
  });

  it("espera o tempo total solicitado, somando os intervalos", async () => {
    await waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 25000, fakeSleep);

    const total = sleepCalls.reduce((a, b) => a + b, 0);
    expect(total).toBe(25000);
  });

  it("não espera nada quando o tempo restante é zero ou negativo", async () => {
    await waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 0, fakeSleep);

    expect(sleepCalls).toHaveLength(0);
  });

  it("falha de presence não interrompe o envio (best-effort)", async () => {
    wbot.sendPresenceUpdate.mockRejectedValue(new Error("presence falhou"));

    await expect(
      waitWithTypingIndicator(wbot, "5548999@s.whatsapp.net", 3000, fakeSleep)
    ).resolves.toBeUndefined();
  });
});
