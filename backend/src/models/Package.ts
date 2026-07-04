/**
 * Modelo Package — Pacote de sessões (template/catálogo).
 *
 * Um Package é um produto reutilizável que pode ser vendido a múltiplos
 * clientes. Cada venda gera um ClientPackagePurchase vinculado a este template.
 *
 * Relações:
 *   - Package  N:1  Company    (multi-tenant obrigatório)
 *   - Package  N:1  Service    (nullable — pacote pode ser genérico)
 *   - Package  1:N  ClientPackagePurchase
 *
 * Adicionado na Fase 6 — migration 20260521000002-create-Packages.
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
import Service from "./Service";

@Table({ tableName: "Packages" })
class Package extends Model<Package> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  /** Empresa dona do pacote — filtragem multi-tenant. */
  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  /**
   * Serviço vinculado ao pacote (ex: "Depilação a Laser").
   * Nullable para permitir pacotes genéricos sem serviço específico.
   */
  @AllowNull(true)
  @ForeignKey(() => Service)
  @Column(DataType.INTEGER)
  serviceId: number;

  @BelongsTo(() => Service)
  service: Service;

  /** Nome comercial do pacote (ex: "Pacote 10 Sessões de Laser"). */
  @AllowNull(false)
  @Column(DataType.STRING(150))
  name: string;

  /** Descrição detalhada exibida no frontend e nas mensagens WhatsApp. */
  @AllowNull(true)
  @Column(DataType.TEXT)
  description: string;

  /** Número de sessões incluídas no pacote. Mínimo 1. */
  @AllowNull(false)
  @Column(DataType.INTEGER)
  totalSessions: number;

  /**
   * Preço total do pacote em Reais.
   * Usado como valor de receita no ServiceHistory (source='package_purchase').
   */
  @AllowNull(false)
  @Column(DataType.DECIMAL(10, 2))
  totalPrice: number;

  /** Inativo = pacote não pode ser vendido (mas compras existentes continuam). */
  @Default(true)
  @Column(DataType.BOOLEAN)
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Package;
