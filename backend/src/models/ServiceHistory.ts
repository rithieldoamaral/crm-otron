/**
 * Modelo ServiceHistory — registra cada visita/serviço realizado por um contato.
 *
 * Fonte de verdade para:
 *   - Detecção de clientes adormecidos (Retention module)
 *   - Análise RFM (Recência, Frequência, Monetary)
 *   - Programa de fidelidade (contagem de visitas)
 *   - Cross-sell suggestions (que serviços o cliente já fez)
 *
 * Não confundir com Schedule (agendamento futuro):
 *   - Schedule = compromisso planejado (pode ou não acontecer)
 *   - ServiceHistory = serviço CONCLUÍDO (já aconteceu)
 *
 * Sources possíveis:
 *   - 'scheduled_autoclose' — auto-fechado pelo cron quando passou do horário
 *   - 'kanban_completion'   — atendente moveu para tag "Venda Concluída"
 *   - 'manual'              — atendente registrou explicitamente
 *   - 'migration'           — backfill de dados históricos
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
import Ticket from "./Ticket";
import Schedule from "./Schedule";
import Service from "./Service";

export type ServiceHistorySource =
  | "scheduled_autoclose"
  | "kanban_completion"
  | "manual"
  | "migration"
  /** Fase 6: receita de venda de pacote (cash basis — uma entrada por compra). */
  | "package_purchase";

@Table({ tableName: "ServiceHistories" })
class ServiceHistory extends Model<ServiceHistory> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => Contact)
  @Column({ type: DataType.INTEGER, allowNull: false })
  contactId: number;

  @BelongsTo(() => Contact)
  contact: Contact;

  @ForeignKey(() => Ticket)
  @Column({ type: DataType.INTEGER, allowNull: true })
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => Company)
  @Column({ type: DataType.INTEGER, allowNull: false })
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Schedule)
  @Column({ type: DataType.INTEGER, allowNull: true })
  scheduleId: number;

  @BelongsTo(() => Schedule)
  schedule: Schedule;

  /**
   * FK para o serviço do catálogo (Fase 7 — nullable, backward-compatible).
   * Registros históricos (pré-migration) e chamadas legadas ficam com null e
   * continuam a ser agregados por `serviceType`. Preferir este campo no
   * analytics quando presente.
   */
  @ForeignKey(() => Service)
  @Column({ type: DataType.INTEGER, allowNull: true })
  serviceId: number;

  @BelongsTo(() => Service)
  service: Service;

  /** Origem do registro — ver type ServiceHistorySource */
  @Column({ type: DataType.STRING(30), allowNull: false })
  source: ServiceHistorySource;

  /** Opcional: tipo de serviço (ex: "corte", "barba", "pintura") */
  @Column({ type: DataType.STRING(80), allowNull: true })
  serviceType: string;

  /** Opcional: valor monetário do serviço */
  @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
  value: number;

  /**
   * Quando o serviço REALMENTE ocorreu.
   * Pode ser diferente de createdAt (ex: registro retroativo de histórico).
   */
  @Column({ type: DataType.DATE, allowNull: false })
  occurredAt: Date;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ServiceHistory;
