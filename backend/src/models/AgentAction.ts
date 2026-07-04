/**
 * Modelo AgentAction — auditoria de todas as ações executadas pelo agente de IA.
 * Permite rastrear custo (tokens), sucesso/falha e histórico de decisões.
 */

import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import Ticket from "./Ticket";

@Table({ tableName: "AgentActions" })
class AgentAction extends Model<AgentAction> {
  @ForeignKey(() => Company)
  @Column(DataType.INTEGER)
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Ticket)
  @Column({ type: DataType.INTEGER, allowNull: true })
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @Column({ type: DataType.INTEGER, allowNull: true })
  contactId: number;

  /** Nome da tool executada (ex: "buscar_contato") */
  @Column({ type: DataType.STRING(100), allowNull: false })
  action: string;

  @Column({ type: DataType.JSONB, allowNull: true })
  parameters: Record<string, unknown>;

  @Column({ type: DataType.JSONB, allowNull: true })
  result: Record<string, unknown>;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  success: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  errorMessage: string;

  @Column({ type: DataType.STRING(50), allowNull: true })
  provider: string;

  @Column({ type: DataType.STRING(100), allowNull: true })
  model: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  inputTokens: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  outputTokens: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AgentAction;
