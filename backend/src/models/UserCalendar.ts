import {
  Table, Column, Model, DataType, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import User from "./User";
import Company from "./Company";

@Table
class UserCalendar extends Model<UserCalendar> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Column(DataType.STRING)
  googleAccountEmail: string;

  @Column(DataType.STRING)
  calendarId: string;

  // Stored AES-256 encrypted
  @Column(DataType.TEXT)
  accessToken: string;

  // Stored AES-256 encrypted
  @Column(DataType.TEXT)
  refreshToken: string;

  @Column
  tokenExpiry: Date;

  @Default(true)
  @Column
  isActive: boolean;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default UserCalendar;
