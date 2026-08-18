/**
 * Razão de créditos por empresa — lançamentos, nunca saldo.
 *
 * O saldo é SEMPRE a soma dos lançamentos (`SUM(amountBrl)`), nunca uma coluna
 * mutável. Coluna de saldo tem dois defeitos graves aqui:
 *   1. Lost update: dois débitos concorrentes leem o mesmo valor e um
 *      sobrescreve o outro — dinheiro some sem rastro.
 *   2. Perde o "por quê": você vê que a empresa está zerada, mas não como
 *      chegou lá.
 *
 * Convenção de sinal: crédito é POSITIVO, consumo é NEGATIVO. Assim o saldo é
 * uma soma simples e o extrato lê como extrato bancário.
 *
 * APPEND-ONLY: erro se corrige com lançamento de ajuste, nunca com UPDATE.
 */

import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";

@Table({ tableName: "CreditLedgers" })
class CreditLedger extends Model<CreditLedger> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /** grant | consumption | adjustment | expiry */
  @AllowNull(false)
  @Column(DataType.STRING(20))
  type: string;

  /** Positivo credita, negativo debita. DECIMAL porque é dinheiro. */
  @AllowNull(false)
  @Column({ type: DataType.DECIMAL(16, 8), defaultValue: 0 })
  amountBrl: number;

  /** Obrigatória: lançamento sem motivo é impossível de auditar depois. */
  @AllowNull(false)
  @Column(DataType.STRING(255))
  description: string;

  /** Liga o lançamento à origem (ex: período de consumo, id de pagamento). */
  @Column({ type: DataType.STRING(80), allowNull: true })
  referenceId: string;

  /** Quem concedeu/ajustou. Nulo em lançamento automático de consumo. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  createdByUserId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CreditLedger;
