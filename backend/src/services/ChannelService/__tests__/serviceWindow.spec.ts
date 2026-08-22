/**
 * Testes da janela de atendimento de 24 horas.
 *
 * Por que existe: nos canais oficiais, mensagem livre só pode ser enviada até
 * 24h APÓS A ÚLTIMA MENSAGEM DO CLIENTE. Fora disso a Meta exige template
 * aprovado.
 *
 * O risco que estes testes cobrem é o pior tipo: se o cálculo errar para mais,
 * o sistema tenta enviar livre fora da janela, a Meta REJEITA, e sem tratamento
 * o ticket fica marcado como respondido enquanto o cliente nunca recebeu nada.
 * Falha invisível.
 *
 * A contagem parte da última mensagem RECEBIDA (fromMe = false). Mensagem
 * nossa não reabre janela nenhuma — se reabrisse, bastaria o sistema falar
 * sozinho para manter a janela viva para sempre.
 */

import { estaNaJanelaDeAtendimento, JANELA_MS } from "../serviceWindow";

const agora = new Date("2026-08-21T12:00:00.000Z");

/** Mensagem no formato mínimo que a função consome. */
const msg = (horasAtras: number, fromMe: boolean) => ({
  fromMe,
  createdAt: new Date(agora.getTime() - horasAtras * 60 * 60 * 1000)
});

describe("estaNaJanelaDeAtendimento", () => {
  it("está aberta quando o cliente escreveu há 1 hora", () => {
    expect(estaNaJanelaDeAtendimento([msg(1, false)], agora)).toBe(true);
  });

  it("está aberta às 23h59 — limite inferior", () => {
    expect(estaNaJanelaDeAtendimento([msg(23.98, false)], agora)).toBe(true);
  });

  it("está FECHADA às 24h01 — limite superior", () => {
    expect(estaNaJanelaDeAtendimento([msg(24.02, false)], agora)).toBe(false);
  });

  it("está fechada quando o cliente escreveu há 3 dias", () => {
    expect(estaNaJanelaDeAtendimento([msg(72, false)], agora)).toBe(false);
  });

  it("está fechada quando NUNCA houve mensagem do cliente", () => {
    // Contato novo que a empresa quer abordar: só com template.
    expect(estaNaJanelaDeAtendimento([], agora)).toBe(false);
  });

  it("NÃO reabre a janela com mensagem NOSSA recente", () => {
    // O ponto central: cliente falou há 30h, nós respondemos há 1h. A janela
    // continua fechada. Se contasse a nossa, o sistema manteria a janela viva
    // sozinho e mandaria mensagem livre indefinidamente — que a Meta rejeita.
    const historico = [msg(30, false), msg(1, true)];

    expect(estaNaJanelaDeAtendimento(historico, agora)).toBe(false);
  });

  it("usa a mensagem MAIS RECENTE do cliente quando há várias", () => {
    const historico = [msg(50, false), msg(40, true), msg(2, false)];

    expect(estaNaJanelaDeAtendimento(historico, agora)).toBe(true);
  });

  it("não depende da ordem do array", () => {
    // O chamador pode entregar ordenado por qualquer critério; a função não
    // deve confiar em ordenação prévia.
    const desordenado = [msg(2, false), msg(50, false), msg(40, true)];

    expect(estaNaJanelaDeAtendimento(desordenado, agora)).toBe(true);
  });

  it("ignora mensagem com data inválida em vez de quebrar", () => {
    const comLixo = [{ fromMe: false, createdAt: null }, msg(1, false)] as any;

    expect(estaNaJanelaDeAtendimento(comLixo, agora)).toBe(true);
  });

  it("está fechada se TODAS as datas forem inválidas", () => {
    // Conservador de propósito: sem dado confiável, assume fechada e exige
    // template. O erro seguro aqui é exigir template a mais, nunca a menos.
    const soLixo = [{ fromMe: false, createdAt: undefined }] as any;

    expect(estaNaJanelaDeAtendimento(soLixo, agora)).toBe(false);
  });
});

describe("JANELA_MS", () => {
  it("são exatamente 24 horas", () => {
    expect(JANELA_MS).toBe(24 * 60 * 60 * 1000);
  });
});
