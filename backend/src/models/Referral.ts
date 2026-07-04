/**
 * Referral — programa de indicação (Fase 4C).
 *
 * Fluxo:
 *   1. Cada Contact tem um `referralCode` único (gerado preguiçosamente)
 *   2. Cliente compartilha o código com um amigo
 *   3. Quando o amigo vira contato e o código é registrado → cria Referral (pending)
 *   4. Quando o amigo completa primeiro serviço → outcome='converted', gera 2 cupons
 *
 * UNIQUE(referredContactId) garante que um mesmo novo cliente não pode
 * ser indicado por múltiplos referrers — vence o primeiro registro.
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

export type ReferralOutcome = "pending" | "converted" | "expired";

@Table({ tableName: "Referrals" })
class Referral extends Model<Referral> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  referrerContactId: number;

  @BelongsTo(() => Contact, "referrerContactId")
  referrer: Contact;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  referredContactId: number;

  @BelongsTo(() => Contact, "referredContactId")
  referred: Contact;

  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column({ type: DataType.STRING(40), allowNull: false })
  referralCode: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: "pending"
  })
  outcome: ReferralOutcome;

  @Column({ type: DataType.DATE, allowNull: true })
  convertedAt: Date;

  @ForeignKey(() => Coupon)
  @Column({ type: DataType.INTEGER, allowNull: true })
  referrerCouponId: number;

  @BelongsTo(() => Coupon, "referrerCouponId")
  referrerCoupon: Coupon;

  @ForeignKey(() => Coupon)
  @Column({ type: DataType.INTEGER, allowNull: true })
  referredCouponId: number;

  @BelongsTo(() => Coupon, "referredCouponId")
  referredCoupon: Coupon;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Referral;
