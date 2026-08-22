import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  AllowNull,
  HasMany,
  Unique,
  BelongsToMany,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Queue from "./Queue";
import Ticket from "./Ticket";
import WhatsappQueue from "./WhatsappQueue";
import Company from "./Company";
import Prompt from "./Prompt";
import QueueIntegrations from "./QueueIntegrations";

@Table
class Whatsapp extends Model<Whatsapp> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull
  @Unique
  @Column(DataType.TEXT)
  name: string;

  @Column(DataType.TEXT)
  session: string;

  @Column(DataType.TEXT)
  qrcode: string;

  @Column
  status: string;

  @Column
  battery: string;

  @Column
  plugged: boolean;

  @Column
  retries: number;

  @Default("")
  @Column(DataType.TEXT)
  greetingMessage: string;

  @Column(DataType.TEXT)
  greetingMediaPath: string;

  @Column(DataType.TEXT)
  greetingMediaName: string;

  @Default("caption")
  @Column(DataType.STRING)
  greetingMediaSendMode: string; // "caption" ou "separate"

  @Default("")
  @Column(DataType.TEXT)
  farewellMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  complationMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  outOfHoursMessage: string;

  @Default("")
  @Column(DataType.TEXT)
  ratingMessage: string;

  @Column({ defaultValue: "stable" })
  provider: string;

  /**
   * Tipo de canal: "baileys" | "cloud_api" | "twilio".
   *
   * NAO confundir com `provider` acima, que guarda a versao do protocolo
   * Baileys ("stable" vs beta) desde 2022 — nome parecido, semantica
   * diferente. Ver directives/canal_oficial_whatsapp.md §4.1.
   */
  @Default("baileys")
  @Column
  channelType: string;

  /**
   * Credenciais do canal, em JSON CIFRADO (AES-256-GCM).
   *
   * Guarda token permanente da Meta / Auth Token da Twilio: credencial de
   * terceiro, que por CLAUDE.md XV.6 nao pode ficar em texto puro nem ir
   * para log. Leitura e escrita SOMENTE via services/ChannelService/
   * channelConfig.ts — nunca decifrar em outro lugar.
   */
  @Column(DataType.TEXT)
  channelConfig: string;

  @Default(false)
  @AllowNull
  @Column
  isDefault: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @BelongsToMany(() => Queue, () => WhatsappQueue)
  queues: Array<Queue & { WhatsappQueue: WhatsappQueue }>;

  @HasMany(() => WhatsappQueue)
  whatsappQueues: WhatsappQueue[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  token: string;

  // @Default(0)
  // @Column
  // timeSendQueue: number;

  // @Column
  // sendIdQueue: number;

  @Column
  transferQueueId: number;

  @Column
  timeToTransfer: number;

  @ForeignKey(() => Prompt)
  @Column
  promptId: number;

  @BelongsTo(() => Prompt)
  prompt: Prompt;

  @ForeignKey(() => QueueIntegrations)
  @Column
  integrationId: number;

  @BelongsTo(() => QueueIntegrations)
  queueIntegrations: QueueIntegrations;

  @Column
  maxUseBotQueues: number;

  @Column
  timeUseBotQueues: number;

  @Column
  expiresTicket: number;

  @Column
  number: string;

  @Column(DataType.TEXT)
  pix: string;

  @Default("")
  @Column(DataType.TEXT)
  pixMessage: string;

  @Column
  expiresInactiveMessage: string;

  @Default(false)
  @Column(DataType.BOOLEAN)
  isAgentChannel: boolean;

  @Default(false)
  @Column(DataType.BOOLEAN)
  isSecretaryChannel: boolean;
}

export default Whatsapp;
