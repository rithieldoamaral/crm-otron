/**
 * Modelo ClientPackagePurchase — Compra de pacote por um cliente específico.
 *
 * Representa uma venda concreta: um cliente comprou N sessões de um pacote.
 * Os campos `totalSessions` e `totalPrice` são snapshots do momento da compra
 * para garantir imutabilidade histórica (o template Package pode mudar depois).
 *
 * Relações:
 *   - ClientPackagePurchase  N:1  Company
 *   - ClientPackagePurchase  N:1  Contact     (cliente comprador)
 *   - ClientPackagePurchase  N:1  Package     (template base)
 *   - ClientPackagePurchase  1:N  PackageConsumption
 *
 * Status:
 *   - 'active'    — ainda há sessões e não expirou
 *   - 'completed' — todas as sessões foram consumidas
 *   - 'expired'   — passou da data de validade (expiresAt)
 *   - 'cancelled' — cancelado manualmente pelo admin
 *
 * Adicionado na Fase 6 — migration 20260521000003-create-ClientPackagePurchases.
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
  Default,
  ForeignKey,
  BelongsTo,
  HasMany,
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Package from "./Package";

export type PurchaseStatus = "active" | "completed" | "expired" | "cancelled";

@Table({ tableName: "ClientPackagePurchases" })
class ClientPackagePurchase extends Model<ClientPackagePurchase> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  /** Empresa — filtragem multi-tenant. */
  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /** Cliente que adquiriu o pacote. */
  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  /**
   * Template de pacote base.
   * Nullable para suportar compras históricas se o pacote for deletado
   * (SET NULL em vez de CASCADE para preservar o histórico de compras).
   */
  @AllowNull(true)
  @ForeignKey(() => Package)
  @Column(DataType.INTEGER)
  packageId: number;

  @BelongsTo(() => Package)
  package: Package;

  /**
   * Snapshot do nome do serviço no momento da compra.
   * Garante rastreabilidade mesmo se o Package for alterado depois.
   */
  @AllowNull(true)
  @Column(DataType.STRING(150))
  serviceName: string;

  /** Snapshot: número total de sessões contratadas. */
  @AllowNull(false)
  @Column(DataType.INTEGER)
  totalSessions: number;

  /** Sessões já consumidas. Incrementado a cada PackageConsumption. */
  @Default(0)
  @Column(DataType.INTEGER)
  sessionsUsed: number;

  /** Snapshot: valor total pago pelo pacote em Reais. */
  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  totalPrice: number;

  /** Status calculado + cancelamento manual. */
  @Default("active")
  @Column(DataType.STRING(20))
  status: PurchaseStatus;

  /**
   * Data de validade do pacote (nullable = sem expiração).
   * Quando preenchida, após esta data o status passa a 'expired'.
   */
  @AllowNull(true)
  @Column(DataType.DATE)
  expiresAt: Date;

  /** Data em que a compra foi registrada (pode diferir de createdAt em backfills). */
  @AllowNull(false)
  @Column(DataType.DATE)
  purchasedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ClientPackagePurchase;
