import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  BelongsToMany,
  ForeignKey,
  BelongsTo,
  HasMany
} from "sequelize-typescript";
import Company from "./Company";
import Ticket from "./Ticket";
import TicketTag from "./TicketTag";

@Table
class Tag extends Model<Tag> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column
  name: string;

  @Column
  color: string;

  @HasMany(() => TicketTag)
  ticketTags: TicketTag[];

  @BelongsToMany(() => Ticket, () => TicketTag)
  tickets: Ticket[];

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;

  @Column
  kanban: number;

  /**
   * Marca esta tag como a etapa final do funil de vendas.
   * Quando um ticket recebe esta tag (ex: arrastado no Kanban para a coluna
   * correspondente), o sistema automaticamente:
   *   1. Fecha o ticket
   *   2. Cria um ServiceHistory com source='kanban_completion'
   *
   * Constraint do banco: apenas UMA tag por empresa pode ter isCompletionTag = true.
   */
  @Column({ defaultValue: false })
  isCompletionTag: boolean;
}

export default Tag;
