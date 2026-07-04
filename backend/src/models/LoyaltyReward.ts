/**
 * LoyaltyReward — recompensas de fidelidade entregues a clientes que
 * atingem marcos de serviços completados.
 *
 * O programa de fidelidade entrega cupons automaticamente quando o
 * cliente atinge marcos configuráveis (default: 5, 10, 20, 50, 100).
 *
 * UNIQUE(contactId, milestone) garante que cada marco seja entregue
 * apenas uma vez por cliente. Mesmo que o hook seja chamado duas vezes
 * para o mesmo serviço, a recompensa só é criada uma vez.
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
import Coupon from "./Coupon";

@Table({ tableName: "LoyaltyRewards" })
class LoyaltyReward extends Model<LoyaltyReward> {
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

  /** Marco atingido (5, 10, 20, etc) */
  @Column({ type: DataType.INTEGER, allowNull: false })
  milestone: number;

  @ForeignKey(() => Coupon)
  @Column({ type: DataType.INTEGER, allowNull: true })
  couponId: number;

  @BelongsTo(() => Coupon)
  coupon: Coupon;

  @Column({ type: DataType.DATE, allowNull: false })
  awardedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default LoyaltyReward;
