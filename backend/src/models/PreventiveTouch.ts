/**
 * PreventiveTouch — rastreia mensagens de lembrete preventivo enviadas
 * para clientes em risco de dormência.
 *
 * "Risco de dormência" = ratio (daysSinceLastService / avgInterval) acima
 * do limiar configurado (default: 0.8). Equivale ao status `quase_na_hora`
 * do DormantDetectionService.
 *
 * A constraint UNIQUE(contactId, baselineHistoryId) garante que apenas um
 * toque preventivo seja enviado por ciclo de serviço. Quando o cliente
 * volta e gera novo ServiceHistory, baselineHistoryId muda — abrindo nova
 * janela para envio em ciclos futuros.
 */

import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  DataType,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import ServiceHistory from "./ServiceHistory";

@Table({ tableName: "PreventiveTouches" })
class PreventiveTouch extends Model<PreventiveTouch> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /**
   * ID do último ServiceHistory no momento do envio.
   * Define o "ciclo" para fins de idempotência.
   */
  @ForeignKey(() => ServiceHistory)
  @Column({ type: DataType.INTEGER, allowNull: true })
  baselineHistoryId: number;

  @BelongsTo(() => ServiceHistory)
  baselineHistory: ServiceHistory;

  /** Quando a mensagem foi enviada */
  @Column({ type: DataType.DATE, allowNull: false })
  sentAt: Date;

  /** Ratio no momento do envio (0.80 a ~1.00 normalmente) */
  @Column({ type: DataType.DECIMAL(6, 3), allowNull: false })
  ratioAtSend: number;

  /** Dias desde o último serviço no momento do envio */
  @Column({ type: DataType.INTEGER, allowNull: false })
  daysSinceLastService: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default PreventiveTouch;
