/**
 * Modelo Coupon — cupons únicos rastreáveis para campanhas de retenção.
 *
 * Cada cupom é gerado para um contato (opcional, pode ser genérico) e tem:
 *   - Código único legível (ex: ANIVER-MARIA-7H2K)
 *   - Janela de validade (validFrom → validUntil)
 *   - Estado de redenção (redeemedAt + redeemedBy)
 *
 * Reasons:
 *   - 'birthday'     — gerado automaticamente para aniversariantes
 *   - 'reactivation' — gerado por reativação de adormecido
 *   - 'loyalty'      — recompensa do programa de fidelidade
 *   - 'referral'     — recompensa por indicação que converteu
 *   - 'manual'       — gerado manualmente por atendente/admin
 *
 * Tipos de desconto:
 *   - 'percent'       — 10 = 10% off
 *   - 'fixed'         — 10 = R$ 10 off
 *   - 'free_service'  — serviço grátis (discountValue ignorado)
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
import User from "./User";

export type CouponReason =
  | "birthday"
  | "reactivation"
  | "loyalty"
  | "referral"
  | "manual";

export type CouponDiscountType = "percent" | "fixed" | "free_service";

@Table({ tableName: "Coupons" })
class Coupon extends Model<Coupon> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  /** Código único do cupom (ex: ANIVER-MARIA-7H2K) — único globalmente */
  @Column({ type: DataType.STRING(40), allowNull: false, unique: true })
  code: string;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: true })
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column({ type: DataType.STRING(30), allowNull: false })
  reason: CouponReason;

  @Column({ type: DataType.STRING(20), allowNull: false })
  discountType: CouponDiscountType;

  @Column({ type: DataType.DECIMAL(10, 2), allowNull: false })
  discountValue: number;

  @Column({ type: DataType.DATE, allowNull: false })
  validFrom: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  validUntil: Date;

  /** NULL = ainda não redimido */
  @Column({ type: DataType.DATE, allowNull: true })
  redeemedAt: Date;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true })
  redeemedBy: number;

  @BelongsTo(() => User)
  redeemer: User;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  // ── Helpers ─────────────────────────────────────────────────────

  /** Verifica se o cupom está válido para uso (não expirado, não redimido) */
  isValid(now: Date = new Date()): boolean {
    if (this.redeemedAt) return false;
    if (now < this.validFrom) return false;
    if (now > this.validUntil) return false;
    return true;
  }

  /** Status human-friendly */
  get status(): "active" | "redeemed" | "expired" | "scheduled" {
    if (this.redeemedAt) return "redeemed";
    const now = new Date();
    if (now < this.validFrom) return "scheduled";
    if (now > this.validUntil) return "expired";
    return "active";
  }
}

export default Coupon;
