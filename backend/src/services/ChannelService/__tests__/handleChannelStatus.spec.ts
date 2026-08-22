/**
 * Testes do status de entrega (tiques) no canal oficial.
 *
 * Por que existe (item 5 da auditoria): os eventos de status chegam pela MESMA
 * rota das mensagens. Antes eram descartados sem atualizar nada, então os
 * tiques de "entregue" e "lido" não funcionavam no canal oficial.
 *
 * O teste que mais importa aqui é o de NÃO REGREDIR o ack: webhooks chegam
 * fora de ordem, e um "enviado" atrasado não pode apagar um "lido" que já
 * chegou — o atendente veria a mensagem voltar para um estado anterior.
 */

import Message from "../../../models/Message";
import {
  ACK,
  handleChannelStatus,
  parseStatusMeta,
  parseStatusTwilio
} from "../handleChannelStatus";

jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));
jest.mock("../../../libs/socket", () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) })
}));

const conexao = (channelType = "cloud_api") =>
  ({ id: 7, companyId: 42, channelType } as any);

/** Mensagem simulada com o ack atual informado. */
const mensagemComAck = (ack: number) => {
  const update = jest.fn();
  (Message.findByPk as jest.Mock).mockResolvedValue({
    id: "wamid.ABC",
    ticketId: 1234,
    companyId: 42,
    ack,
    update
  });
  return update;
};

beforeEach(() => jest.clearAllMocks());

describe("parseStatusMeta", () => {
  it("extrai status do payload aninhado da Meta", () => {
    const eventos = parseStatusMeta({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.1", status: "delivered" }]
              }
            }
          ]
        }
      ]
    });

    expect(eventos).toEqual([
      { channelMessageId: "wamid.1", status: "delivered", erro: undefined }
    ]);
  });

  it("devolve vazio quando o payload traz MENSAGEM, não status", () => {
    // A mesma rota recebe os dois; confundir criaria ticket fantasma.
    const eventos = parseStatusMeta({
      entry: [{ changes: [{ value: { messages: [{ id: "1" }] } }] }]
    });

    expect(eventos).toEqual([]);
  });

  it("captura o motivo do erro quando a Meta informa", () => {
    const [evento] = parseStatusMeta({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.1",
                    status: "failed",
                    errors: [{ title: "Número inválido" }]
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(evento.erro).toBe("Número inválido");
  });
});

describe("parseStatusTwilio", () => {
  it("extrai status do callback da Twilio", () => {
    expect(
      parseStatusTwilio({ MessageSid: "SM1", MessageStatus: "delivered" })
    ).toEqual([
      { channelMessageId: "SM1", status: "delivered", erro: undefined }
    ]);
  });

  it("devolve vazio quando não é evento de status", () => {
    expect(parseStatusTwilio({ MessageSid: "SM1", Body: "oi" })).toEqual([]);
  });
});

describe("handleChannelStatus", () => {
  it("avança o ack de enviado para entregue", async () => {
    const update = mensagemComAck(ACK.ENVIADO);

    await handleChannelStatus(
      { channelMessageId: "wamid.ABC", status: "delivered" },
      conexao()
    );

    expect(update).toHaveBeenCalledWith({ ack: ACK.ENTREGUE });
  });

  it("avança de entregue para lido", async () => {
    const update = mensagemComAck(ACK.ENTREGUE);

    await handleChannelStatus(
      { channelMessageId: "wamid.ABC", status: "read" },
      conexao()
    );

    expect(update).toHaveBeenCalledWith({ ack: ACK.LIDO });
  });

  it("NÃO REGRIDE o ack quando o webhook chega fora de ordem", async () => {
    // Mensagem já lida; chega um "sent" atrasado. Sem esta guarda, o
    // atendente veria a mensagem voltar de "lido" para "enviado".
    const update = mensagemComAck(ACK.LIDO);

    await handleChannelStatus(
      { channelMessageId: "wamid.ABC", status: "sent" },
      conexao()
    );

    expect(update).not.toHaveBeenCalled();
  });

  it("traduz os status da Twilio, que têm nomes próprios", async () => {
    const update = mensagemComAck(ACK.PENDENTE);

    await handleChannelStatus(
      { channelMessageId: "SM1", status: "sent" },
      conexao("twilio")
    );

    expect(update).toHaveBeenCalledWith({ ack: ACK.ENVIADO });
  });

  it("IGNORA status desconhecido em vez de inventar um ack", async () => {
    // Inventar mostraria estado errado ao atendente — pior que não atualizar.
    const update = mensagemComAck(ACK.ENVIADO);

    await handleChannelStatus(
      { channelMessageId: "wamid.ABC", status: "teleported" },
      conexao()
    );

    expect(update).not.toHaveBeenCalled();
  });

  it("não quebra quando o status é de mensagem que não existe aqui", async () => {
    (Message.findByPk as jest.Mock).mockResolvedValue(null);

    await expect(
      handleChannelStatus(
        { channelMessageId: "desconhecida", status: "read" },
        conexao()
      )
    ).resolves.not.toThrow();
  });

  it("ignora evento sem id ou sem status", async () => {
    await handleChannelStatus(
      { channelMessageId: "", status: "read" },
      conexao()
    );
    await handleChannelStatus({ channelMessageId: "x", status: "" }, conexao());

    expect(Message.findByPk).not.toHaveBeenCalled();
  });
});
