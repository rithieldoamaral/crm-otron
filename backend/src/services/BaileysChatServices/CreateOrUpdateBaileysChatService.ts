import { Chat } from "baileys";
import Long from "long";
import BaileysChats from "../../models/BaileysChats";

// SEQUELIZE 6: baileys tipa conversationTimestamp como `number | Long`
// (protobuf 64-bit), mas a coluna é `number` — converte Long -> number
// preservando o valor exato (comportamento inalterado).
const toTimestampNumber = (
  value: number | Long | null | undefined
): number | undefined => {
  if (value === null || value === undefined) return undefined;
  return Long.isLong(value) ? value.toNumber() : value;
};

export const CreateOrUpdateBaileysChatService = async (
  whatsappId: number,
  chat: Partial<Chat>,
): Promise<BaileysChats> => {
  const { id, conversationTimestamp, unreadCount } = chat;
  const conversationTimestampNum = toTimestampNumber(conversationTimestamp);
  const baileysChat = await BaileysChats.findOne({
    where: {
      whatsappId,
      jid: id,
    }
  });

  if (baileysChat) {
    const baileysChats = await baileysChat.update({
      conversationTimestamp: conversationTimestampNum,
      unreadCount: unreadCount ? baileysChat.unreadCount + unreadCount : 0
    });

    return baileysChats;
  }
  // timestamp now

  const timestamp = new Date().getTime();

  // convert timestamp to number
  const conversationTimestampNumber = Number(timestamp);

  const baileysChats = await BaileysChats.create({
    whatsappId,
    jid: id,
    conversationTimestamp: conversationTimestampNum || conversationTimestampNumber,
    unreadCount: unreadCount || 1,
  });

  return baileysChats;
};
