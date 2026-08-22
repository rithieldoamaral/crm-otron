import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  DataType,
  Default
} from "sequelize-typescript";

import Company from "./Company";
import Whatsapp from "./Whatsapp";

/**
 * Template aprovado de um canal oficial.
 *
 * Espelho local do que já foi aprovado no provedor. NÃO é a fonte da verdade:
 * a aprovação acontece no painel da Meta, e esta tabela é reconstruída pela
 * sincronização (`syncTemplates`).
 *
 * Existe para que um envio proativo não dependa de chamada externa para
 * descobrir se pode acontecer — se a API do provedor estivesse lenta, o
 * lembrete falharia por motivo alheio à mensagem.
 */
@Table({ tableName: "WhatsappTemplates" })
class WhatsappTemplate extends Model<WhatsappTemplate> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Whatsapp)
  @Column
  whatsappId: number;

  @BelongsTo(() => Whatsapp)
  whatsapp: Whatsapp;

  /** Isolamento multi-tenant (CLAUDE.md XV.3). */
  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /** Nome no provedor. Na Twilio, guarda o ContentSid. */
  @Column
  name: string;

  /** Código do idioma, ex. "pt_BR". */
  @Column
  language: string;

  /** MARKETING | UTILITY | AUTHENTICATION — define a tarifa cobrada. */
  @Column
  category: string;

  /** APPROVED | PENDING | REJECTED. Só APPROVED pode ser enviado. */
  @Column
  status: string;

  /** Corpo com placeholders `{{1}}`, para o operador reconhecer o template. */
  @Column(DataType.TEXT)
  bodyText: string;

  /**
   * Quantidade de parâmetros esperada.
   *
   * Enviar número diferente do esperado faz a Meta rejeitar — validar antes
   * evita a falha silenciosa de "sistema marcou enviado, cliente não recebeu".
   */
  @Default(0)
  @Column
  variableCount: number;

  @Column
  syncedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WhatsappTemplate;
