/**
 * Registro de consumo de LLM — uma linha por CHAMADA ao modelo.
 *
 * Separado de `AgentAction` de propósito: AgentAction audita o que o agente
 * FEZ (uma linha por tool executada); TokenUsage mede quanto CUSTOU (uma
 * linha por chamada ao LLM). Ver directives/token_governance.md.
 *
 * APPEND-ONLY: nunca sofre UPDATE. Correção se faz por lançamento novo.
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
import Ticket from "./Ticket";

@Table({ tableName: "TokenUsages" })
class TokenUsage extends Model<TokenUsage> {
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

  @ForeignKey(() => Ticket)
  @Column({ type: DataType.INTEGER, allowNull: true })
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  /** agent | secretary | summary */
  @AllowNull(false)
  @Column(DataType.STRING(30))
  source: string;

  @AllowNull(false)
  @Column(DataType.STRING(50))
  provider: string;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  model: string;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  inputTokens: number;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  outputTokens: number;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  cachedInputTokens: number;

  // ── Preço congelado no momento do uso ──────────────────────────────
  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  inputPricePerMillion: number;

  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  outputPricePerMillion: number;

  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  cachedInputPricePerMillion: number;

  @Column({ type: DataType.DECIMAL(12, 6), defaultValue: 0 })
  usdToBrlUsed: number;

  @Column({ type: DataType.DECIMAL(8, 4), defaultValue: 0 })
  markupPercent: number;

  @Column({ type: DataType.DECIMAL(16, 8), defaultValue: 0 })
  costUsd: number;

  @Column({ type: DataType.DECIMAL(16, 8), defaultValue: 0 })
  costBrl: number;

  /** Custo + markup. Igual a costBrl enquanto markup = 0. */
  @Column({ type: DataType.DECIMAL(16, 8), defaultValue: 0 })
  priceBrl: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  usageMissing: boolean;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  pricingMissing: boolean;

  /** Impede que retry da mesma chamada vire débito duplicado (UNIQUE no banco). */
  @AllowNull(false)
  @Column(DataType.STRING(80))
  idempotencyKey: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default TokenUsage;
