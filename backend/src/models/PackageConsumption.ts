/**
 * Modelo PackageConsumption — Registro de cada sessão consumida de um pacote.
 *
 * Uma linha por sessão utilizada. O campo `serviceHistoryId` é nullable
 * para suportar consumos manuais sem agendamento (ex: presença registrada
 * diretamente pelo admin sem passar pelo fluxo de Schedule).
 *
 * Relações:
 *   - PackageConsumption  N:1  Company
 *   - PackageConsumption  N:1  ClientPackagePurchase
 *   - PackageConsumption  N:1  Contact            (desnormalizado para queries rápidas)
 *   - PackageConsumption  N:1  ServiceHistory     (nullable)
 *
 * Adicionado na Fase 6 — migration 20260521000004-create-PackageConsumptions.
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
  BelongsTo,
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import ClientPackagePurchase from "./ClientPackagePurchase";
import ServiceHistory from "./ServiceHistory";

@Table({ tableName: "PackageConsumptions" })
class PackageConsumption extends Model<PackageConsumption> {
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

  /** Compra de pacote à qual esta sessão pertence. */
  @ForeignKey(() => ClientPackagePurchase)
  @Column({ type: DataType.INTEGER, allowNull: false })
  clientPackagePurchaseId: number;

  @BelongsTo(() => ClientPackagePurchase)
  clientPackagePurchase: ClientPackagePurchase;

  /**
   * Cliente dono da sessão — desnormalizado para simplificar queries
   * que precisam apenas do contactId sem JOIN em ClientPackagePurchase.
   */
  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  /**
   * ServiceHistory associado (nullable).
   * Preenchido quando o consumo é originado de um atendimento registrado
   * (source='kanban_completion' ou 'scheduled_autoclose').
   * Null para consumos manuais diretos.
   */
  @AllowNull(true)
  @ForeignKey(() => ServiceHistory)
  @Column(DataType.INTEGER)
  serviceHistoryId: number;

  @BelongsTo(() => ServiceHistory)
  serviceHistory: ServiceHistory;

  /** Observações livres do atendente (ex: "região tratada: pernas"). */
  @AllowNull(true)
  @Column(DataType.TEXT)
  notes: string;

  /** Data/hora em que a sessão foi consumida (pode diferir de createdAt). */
  @AllowNull(false)
  @Column(DataType.DATE)
  consumedAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default PackageConsumption;
