import {
  Table, Column, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import User from "./User";
import Company from "./Company";

// dayOfWeek: 0=Domingo, 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado

@Table
class UserWorkingHours extends Model<UserWorkingHours> {
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

export default UserWorkingHours;
