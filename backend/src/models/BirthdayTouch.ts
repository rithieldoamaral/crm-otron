/**
 * BirthdayTouch — rastreia quais dos 3 toques do fluxo de aniversário foram enviados.
 *
 * O fluxo Fase 2 dispara 3 mensagens por aniversariante por ano:
 *   dm3 — D-3: antecipação ("seu aniversário está chegando 🎁")
 *   d0  — D-0: parabéns + cupom único gerado automaticamente
 *   dp7 — D+7: follow-up com lembrete do cupom
 *
 * A constraint UNIQUE(contactId, year, touchType) garante idempotência:
 * mesmo que o cron rode duas vezes no mesmo minuto, o toque só é registrado uma vez.
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

export type BirthdayTouchType = "dm3" | "d0" | "dp7";

@Table({ tableName: "BirthdayTouches" })
class BirthdayTouch extends Model<BirthdayTouch> {
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

  /** Ano do ciclo (ex: 2026). Com touchType + contactId = unique. */
  @Column({ type: DataType.INTEGER, allowNull: false })
  year: number;

  /** Qual dos 3 toques foi enviado */
  @Column({ type: DataType.ENUM("dm3", "d0", "dp7"), allowNull: false })
  touchType: BirthdayTouchType;

  /** Quando a mensagem foi efetivamente enviada */
  @Column({ type: DataType.DATE, allowNull: false })
  sentAt: Date;

  /** Cupom gerado no toque D-0 (null nos outros toques) */
  @ForeignKey(() => Coupon)
  @Column({ type: DataType.INTEGER, allowNull: true })
  couponId: number;

  @BelongsTo(() => Coupon)
  coupon: Coupon;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default BirthdayTouch;
