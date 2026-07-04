import {
  Table, Column, Model, DataType, PrimaryKey, AutoIncrement,
  ForeignKey, BelongsTo, HasOne, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import Company from "./Company";
import ProfessionalCalendar from "./ProfessionalCalendar";

/**
 * CalendarProfessional — profissional autônomo para agendamento.
 *
 * Separado da tabela Users para que o dono do negócio possa cadastrar
 * colaboradores que NÃO precisam de acesso ao CRM (ex: esteticista que
 * só precisa de calendário gerenciado). Relaciona-se com:
 *   - ProfessionalCalendar  — tokens OAuth do Google Calendar
 *   - ProfessionalWorkingHours — horários de disponibilidade
 */
@Table({ tableName: "CalendarProfessionals" })
class CalendarProfessional extends Model<CalendarProfessional> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column(DataType.STRING(150))
  name: string;

  @HasOne(() => ProfessionalCalendar)
  calendar: ProfessionalCalendar;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default CalendarProfessional;
