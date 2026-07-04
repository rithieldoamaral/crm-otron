import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Unique,
  Default,
  HasMany,
  ForeignKey,
  BelongsTo,
  DataType
} from "sequelize-typescript";
import ContactCustomField from "./ContactCustomField";
import Ticket from "./Ticket";
import Company from "./Company";
import Schedule from "./Schedule";
import Whatsapp from "./Whatsapp";

@Table
class Contact extends Model<Contact> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @AllowNull(false)
  @Unique
  @Column
  number: string;

  @AllowNull(false)
  @Default("")
  @Column
  email: string;

  @Default("")
  @Column
  profilePicUrl: string;

  @Default(false)
  @Column
  isGroup: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @HasMany(() => Ticket)
  tickets: Ticket[];

  @HasMany(() => ContactCustomField)
  extraInfo: ContactCustomField[];

  @Default(true)
  @Column
  active: boolean;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @Default(false)
  @Column
  disableBot: boolean

  @BelongsTo(() => Company)
  company: Company;

  @HasMany(() => Schedule, {
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    hooks: true
  })
  schedules: Schedule[];

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @Default(null)
  @Column
  lid: string;

  @AllowNull(true)
  @Column(DataType.DATEONLY)
  birthday: Date;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  /**
   * Opt-out de marketing — cumpre LGPD.
   *
   * Quando true, o contato é EXCLUÍDO de:
   *   - Campanhas de reativação (módulo Retenção)
   *   - Mensagens automáticas de aniversário
   *   - Lembretes preventivos
   *   - Programas de fidelidade automáticos
   *
   * Atendimento normal continua liberado — opt-out só afeta marketing.
   * Cliente pode marcar via palavra-chave ("parar", "não me mande mais")
   * detectada automaticamente, ou via botão no painel de Retenção.
   */
  @Default(false)
  @Column
  marketingOptOut: boolean;

  @AllowNull(true)
  @Column(DataType.DATE)
  marketingOptOutAt: Date;

  @AllowNull(true)
  @Column(DataType.STRING(255))
  marketingOptOutReason: string;

  /**
   * Código de indicação único do contato (Fase 4C).
   * Gerado preguiçosamente na primeira vez que o cliente quer indicar alguém.
   * Único globalmente (no escopo da tabela toda, não por empresa).
   */
  @AllowNull(true)
  @Column(DataType.STRING(40))
  referralCode: string;
}

export default Contact;
