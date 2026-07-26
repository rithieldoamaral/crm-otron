/**
 * humanTypingDelay — simula o tempo de digitação de um atendente humano.
 *
 * POR QUE ISSO EXISTE (2026-07-26): usamos a Baileys (API não-oficial do
 * WhatsApp). Os modelos de detecção de automação da Meta dão peso alto a dois
 * sinais que a implementação anterior emitia claramente:
 *
 *   1. Velocidade sobre-humana — a fórmula antiga usava 15ms por caractere
 *      (≈4.000 palavras/minuto) com teto de 5s. Nenhum humano digita assim.
 *   2. Timing determinístico — a mesma entrada produzia sempre exatamente o
 *      mesmo atraso. Intervalo robótico é assinatura de bot.
 *
 * A correção ataca os dois: velocidade de digitação humana real (~40-60 WPM)
 * e jitter aleatório em torno dela, de forma que duas respostas de mesmo
 * tamanho nunca levem exatamente o mesmo tempo.
 *
 * Nada disso torna a detecção impossível — apenas reduz a probabilidade.
 * A solução definitiva é migrar para a API oficial (WhatsApp Cloud API).
 */

/** Tempo de "leitura" da mensagem do cliente antes de começar a digitar. */
const READ_BASE_MS = 1200;

/**
 * Milissegundos por caractere digitado. 160ms/char ≈ 47 palavras por minuto
 * (considerando ~5 caracteres + espaço por palavra), que é a velocidade de um
 * atendente treinado digitando em teclado. Com o jitter de ±30%, a faixa
 * efetiva fica entre ~36 e ~67 WPM — plausível para pessoas diferentes.
 */
const MS_PER_CHAR = 160;

/** Piso: mesmo um "ok" leva um tempo mínimo de leitura + reação. */
export const TYPING_MIN_MS = 2000;

/**
 * Teto: acima disso o cliente desiste de esperar, e na prática um humano
 * quebraria a resposta em várias mensagens. 25s mantém o realismo sem
 * inviabilizar o atendimento.
 */
export const TYPING_MAX_MS = 25000;

/** Amplitude do jitter: ±30% em torno do tempo calculado. */
const JITTER_RANGE = 0.6;
const JITTER_FLOOR = 0.7;

/**
 * O indicador "digitando..." do WhatsApp expira sozinho em ~10s. Em esperas
 * longas precisamos reenviar, senão o contato vê o indicador sumir e a
 * mensagem aparecer do nada — padrão mais suspeito que não ter indicador.
 */
const COMPOSING_REFRESH_MS = 8000;

/**
 * Jitter em distribuição de Bates (média de 2 uniformes): aproxima uma curva
 * normal mas é LIMITADA, ao contrário de uma gaussiana real. Isso evita
 * outliers de 3-sigma que gerariam esperas absurdas (ou instantâneas).
 *
 * @param random - Função geradora [0,1). Injetável para testes determinísticos.
 * @returns Fator multiplicador entre 0.7 e 1.3, concentrado em 1.0
 */
function batesJitter(random: () => number): number {
  const media = (random() + random()) / 2;
  return JITTER_FLOOR + media * JITTER_RANGE;
}

/**
 * Calcula quanto tempo um humano levaria para ler e digitar esta resposta.
 *
 * @param text - Texto que será enviado ao contato
 * @param random - Gerador aleatório injetável (padrão: Math.random)
 * @returns Atraso em milissegundos, entre TYPING_MIN_MS e TYPING_MAX_MS
 *
 * @example
 * calculateTypingDelayMs("Tenho às 14h amanhã, posso confirmar?");
 * // ≈ 7000ms (varia a cada chamada por causa do jitter)
 */
export function calculateTypingDelayMs(
  text: string,
  random: () => number = Math.random
): number {
  const bruto = READ_BASE_MS + text.length * MS_PER_CHAR;
  const comJitter = Math.round(bruto * batesJitter(random));

  return Math.min(Math.max(comJitter, TYPING_MIN_MS), TYPING_MAX_MS);
}

/** Interface mínima do socket Baileys usada aqui — evita acoplar ao tipo completo. */
interface PresenceCapableSocket {
  sendPresenceUpdate: (state: string, jid: string) => Promise<unknown>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mantém o indicador "digitando..." ativo durante toda a espera e o encerra
 * com "paused" logo antes do envio — exatamente o que o app faz com um humano.
 *
 * Falhas de presence são engolidas de propósito (best-effort): o indicador é
 * cosmético e nunca deve impedir a entrega da resposta ao cliente.
 *
 * @param wbot - Socket Baileys da conexão
 * @param jid - JID do destinatário (ex: "5548999999999@s.whatsapp.net")
 * @param totalWaitMs - Tempo total a aguardar; <= 0 não espera nada
 * @param sleep - Função de espera injetável (padrão: setTimeout real)
 */
export async function waitWithTypingIndicator(
  wbot: PresenceCapableSocket,
  jid: string,
  totalWaitMs: number,
  sleep: (ms: number) => Promise<void> = realSleep
): Promise<void> {
  const sinalizar = async (estado: "composing" | "paused"): Promise<void> => {
    try {
      await wbot.sendPresenceUpdate(estado, jid);
    } catch {
      // Best-effort: presence é cosmético, nunca bloqueia o envio.
    }
  };

  if (totalWaitMs <= 0) {
    // Ainda assim marcamos composing/paused: o ciclo completo é o que o
    // aplicativo real emite, mesmo quando a digitação é instantânea.
    await sinalizar("composing");
    await sinalizar("paused");
    return;
  }

  let restante = totalWaitMs;
  await sinalizar("composing");

  while (restante > 0) {
    const fatia = Math.min(restante, COMPOSING_REFRESH_MS);
    await sleep(fatia);
    restante -= fatia;

    // Renova o indicador só se ainda houver espera pela frente.
    if (restante > 0) await sinalizar("composing");
  }

  await sinalizar("paused");
}
