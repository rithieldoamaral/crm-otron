/**
 * WinbackAttempt — registra tentativas de reativação para clientes perdidos.
 *
 * Diferente de PreventiveTouch (1 por ciclo) e LoyaltyReward (1 por marco),
 * tentativas de win-back têm cooldown temporal: após enviar uma tentativa,
 * espera N dias antes de enviar outra (configurável, default 90 dias).
 *
 * Outcomes:
 *   - 'pending'      — enviado, aguardando resposta
 *   - 'converted'    — cliente voltou (gerou novo ServiceHistory após sent)
 *   - 'no_response'  — passou cooldown sem retorno
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

export type WinbackOutcome = "pending" | "converted" | "no_response";

@Table({ tableName: "WinbackAttempts" })
class WinbackAttempt extends Model<WinbackAttempt> {
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

  @ForeignKey(() => Coupon)
  @Column({ type: DataType.INTEGER, allowNull: true })
  couponId: number;

  @BelongsTo(() => Coupon)
  coupon: Coupon;

  @Column({ type: DataType.DATE, allowNull: false })
  sentAt: Date;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: "pending"
  })
  outcome: WinbackOutcome;

  @Column({ type: DataType.DATE, allowNull: true })
  convertedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default WinbackAttempt;
