import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import { BaileysAdapter } from "./adapters/BaileysAdapter";
import { CloudApiAdapter } from "./adapters/CloudApiAdapter";
import { TwilioAdapter } from "./adapters/TwilioAdapter";
import { ChannelAdapter, ChannelType } from "./types";

/**
 * Fábrica de adaptadores: dada uma conexão, devolve como falar por ela.
 *
 * É a única porta pela qual o resto do sistema descobre "como envio mensagem
 * nesta conexão". Centralizar aqui é o que permite ao Agente, à Secretária e
 * aos serviços de ticket não conhecerem provedor nenhum.
 *
 * @param whatsapp - Conexão de origem.
 * @returns Adaptador correspondente ao `channelType` da conexão.
 * @throws {AppError} ERR_UNKNOWN_CHANNEL_TYPE se o tipo não for reconhecido.
 *
 * @example
 * const canal = getChannelAdapter(whatsapp);
 * await canal.sendText({ to: numero, body: "olá" });
 */
export const getChannelAdapter = (whatsapp: Whatsapp): ChannelAdapter => {
  // Conexão criada antes desta feature não tem o campo preenchido em memória
  // (o default vive no banco). Tratar ausência como Baileys é o que mantém a
  // base legada funcionando sem migração de dados.
  const tipo = (whatsapp.channelType || "baileys") as ChannelType;

  switch (tipo) {
    case "baileys":
      return new BaileysAdapter(whatsapp.id);

    case "cloud_api":
      return new CloudApiAdapter(whatsapp);

    case "twilio":
      return new TwilioAdapter(whatsapp);

    default:
      // Sem default silencioso: cair no Baileys mandaria a mensagem por um
      // canal que o operador não escolheu, e o erro só apareceria como
      // "cliente não recebeu" dias depois.
      throw new AppError(
        `ERR_UNKNOWN_CHANNEL_TYPE: ${tipo} (conexão ${whatsapp.id})`,
        400
      );
  }
};
