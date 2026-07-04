/**
 * Model SystemLog — registro de auditoria do sistema.
 *
 * Imutável por design: sem UpdatedAt. Logs nunca são editados.
 * Visível apenas para superadmin via GET /api/logs.
 * Retenção: 30 dias (limpeza periódica via cron).
 */

import {
  Table,
  Column,
  CreatedAt,
  Model,
  DataType,
  ForeignKey,
  BelongsTo
} from "sequelize-typescript";
import Company from "./Company";
import User from "./User";

@Table({ tableName: "SystemLogs", updatedAt: false })
class SystemLog extends Model<SystemLog> {
  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: true })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  /**
   * Ação executada — formato "entidade.verbo".
   * Exemplos: "user.login", "ticket.close", "setting.update", "agent.tool_call"
   */
  @Column({ type: DataType.STRING(100), allowNull: false })
  action: string;

  /**
   * Nome da entidade afetada — ex.: "Ticket", "User", "Setting".
   * Null para eventos de sistema sem entidade associada.
   */
  @Column({ type: DataType.STRING(50), allowNull: true })
  entity: string;

  /** ID da entidade afetada. Null quando não aplicável. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  entityId: number;

  /** Payload livre: IP, user-agent, valores antes/depois, motivo, etc. */
  @Column({ type: DataType.JSONB, allowNull: true })
  details: Record<string, unknown>;

  /** IP de origem da requisição. */
  @Column({ type: DataType.STRING(50), allowNull: true })
  ip: string;

  @CreatedAt
  createdAt: Date;
}

export default SystemLog;
