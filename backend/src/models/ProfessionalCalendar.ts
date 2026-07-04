import {
  Table, Column, Model, DataType, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import Company from "./Company";
import CalendarProfessional from "./CalendarProfessional";

/**
 * ProfessionalCalendar — tokens OAuth do Google Calendar para um CalendarProfessional.
 *
 * Análogo a UserCalendar, mas para profissionais sem conta na plataforma.
 * accessToken e refreshToken são armazenados criptografados (AES-256 via tokenCrypto.ts).
 */
@Table({ tableName: "ProfessionalCalendars" })
class ProfessionalCalendar extends Model<ProfessionalCalendar> {
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

  @Column(DataType.STRING)
  googleAccountEmail: string;

  @Column(DataType.STRING)
  calendarId: string;

  /** Stored AES-256 encrypted */
  @Column(DataType.TEXT)
  accessToken: string;

  /** Stored AES-256 encrypted */
  @Column(DataType.TEXT)
  refreshToken: string;

  @Column
  tokenExpiry: Date;

  @Default(false)
  @Column
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ProfessionalCalendar;
