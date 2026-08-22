/**
 * Testes de conversão do payload dos provedores para o tipo neutro.
 *
 * Esta é a fronteira onde o formato do provedor morre. Se ela errar, o erro
 * atravessa o sistema inteiro disfarçado de dado legítimo.
 *
 * O teste do timestamp é o que trava o bug mais traiçoeiro: a Meta envia unix
 * em SEGUNDOS. Sem multiplicar por 1000, toda mensagem cairia em 1970 — e a
 * janela de 24h daria SEMPRE fechada, fazendo o sistema exigir template para
 * responder a quem acabou de escrever.
 */

import { parsePayloadMeta, parsePayloadTwilio } from "../parseIncoming";

const payloadMeta = (mensagens: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ value: { messages: mensagens } }] }]
});

describe("parsePayloadMeta", () => {
  it("converte mensagem de texto", () => {
    const [msg] = parsePayloadMeta(
      payloadMeta([
        {
          id: "wamid.ABC",
          from: "5548988368758",
          type: "text",
          timestamp: "1755792000",
          text: { body: "olá" }
        }
      ])
    );

    expect(msg.channelMessageId).toBe("wamid.ABC");
    expect(msg.body).toBe("olá");
  });

  it("canonicaliza o telefone do remetente", () => {
    const [msg] = parsePayloadMeta(
      payloadMeta([
        { id: "1", from: "5548988368758", type: "text", text: { body: "oi" } }
      ])
    );

    // Precedente: o bug do agentOwnerNumber (2026-08-20) nasceu de deixar
    // formato de telefone passar sem normalizar.
    expect(msg.from).toBe("554888368758");
  });

  it("interpreta o timestamp como SEGUNDOS, não milissegundos", () => {
    const [msg] = parsePayloadMeta(
      payloadMeta([
        {
          id: "1",
          from: "5548999999999",
          type: "text",
          timestamp: "1755792000"
        }
      ])
    );

    // Sem o *1000 isto cairia em 1970 e a janela de 24h daria sempre fechada.
    expect(msg.timestamp.getUTCFullYear()).toBe(2025);
  });

  it("usa a legenda como corpo quando a mensagem é mídia", () => {
    const [msg] = parsePayloadMeta(
      payloadMeta([
        {
          id: "1",
          from: "5548999999999",
          type: "image",
          image: { id: "media-1", caption: "veja isto" }
        }
      ])
    );

    expect(msg.body).toBe("veja isto");
    expect(msg.mediaType).toBe("image");
    expect(msg.mediaUrl).toBe("media-1");
  });

  it("converte VÁRIAS mensagens de um mesmo evento", () => {
    // A Meta agrupa: processar só a primeira perderia mensagens do cliente.
    const msgs = parsePayloadMeta(
      payloadMeta([
        { id: "1", from: "5548999999991", type: "text", text: { body: "a" } },
        { id: "2", from: "5548999999992", type: "text", text: { body: "b" } }
      ])
    );

    expect(msgs).toHaveLength(2);
  });

  it("devolve vazio para evento de STATUS, que não é mensagem", () => {
    // Confirmação de entrega/leitura chega pela mesma rota. Tratar como
    // mensagem criaria ticket fantasma a cada tique azul.
    const payload = {
      entry: [
        { changes: [{ value: { statuses: [{ id: "1", status: "read" }] } }] }
      ]
    };

    expect(parsePayloadMeta(payload)).toEqual([]);
  });

  it("devolve vazio para payload vazio ou malformado, sem estourar", () => {
    expect(parsePayloadMeta({})).toEqual([]);
    expect(parsePayloadMeta(null)).toEqual([]);
    expect(parsePayloadMeta({ entry: [] })).toEqual([]);
  });
});

describe("parsePayloadTwilio", () => {
  it("converte mensagem de texto", () => {
    const [msg] = parsePayloadTwilio({
      MessageSid: "SM123",
      From: "whatsapp:+5548988368758",
      Body: "olá",
      NumMedia: "0"
    });

    expect(msg.channelMessageId).toBe("SM123");
    expect(msg.body).toBe("olá");
  });

  it("remove o prefixo whatsapp: e canonicaliza", () => {
    const [msg] = parsePayloadTwilio({
      MessageSid: "SM1",
      From: "whatsapp:+5548988368758",
      NumMedia: "0"
    });

    expect(msg.from).toBe("554888368758");
  });

  it("classifica o tipo de mídia pelo content-type", () => {
    const [img] = parsePayloadTwilio({
      MessageSid: "SM1",
      From: "whatsapp:+5548999999999",
      NumMedia: "1",
      MediaContentType0: "image/jpeg",
      MediaUrl0: "https://api.twilio.com/media/1"
    });

    expect(img.mediaType).toBe("image");
    expect(img.mediaUrl).toBe("https://api.twilio.com/media/1");
  });

  it("classifica content-type desconhecido como documento", () => {
    const [doc] = parsePayloadTwilio({
      MessageSid: "SM1",
      From: "whatsapp:+5548999999999",
      NumMedia: "1",
      MediaContentType0: "application/pdf",
      MediaUrl0: "https://api.twilio.com/media/2"
    });

    expect(doc.mediaType).toBe("document");
  });

  it("devolve vazio quando falta identificação da mensagem", () => {
    expect(parsePayloadTwilio({})).toEqual([]);
    expect(parsePayloadTwilio({ Body: "sem sid" })).toEqual([]);
    expect(parsePayloadTwilio(null)).toEqual([]);
  });
});
