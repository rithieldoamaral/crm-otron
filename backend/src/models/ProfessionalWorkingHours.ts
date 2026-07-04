import {
  Table, Column, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import Company from "./Company";
import CalendarProfessional from "./CalendarProfessional";

/**
 * ProfessionalWorkingHours — horários de trabalho para CalendarProfessional.
 *
 * Análogo a UserWorkingHours, mas para profissionais sem conta na plataforma.
 * dayOfWeek: 0=Domingo, 1=Segunda … 6=Sábado.
 *
 * Full-replace pattern: o PUT apaga todos os registros do professional e
 * recria em transação — sem update parcial para evitar estado inconsistente.
 */
@Table({ tableName: "ProfessionalWorkingHours" })
class ProfessionalWorkingHours extends Model<ProfessionalWorkingHours> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => CalendarProfessional)
  @Column
  professionalId: number;

  @BelongsTo(() => CalendarProfessional)
  professional: CalendarProfessional;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column
  dayOfWeek: number;

  @Column
  startTime: string;

  @Column
  endTime: string;

  @Default(true)
  @Column
  isWorking: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ProfessionalWorkingHours;
