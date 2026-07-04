import {
  Table, Column, Model, PrimaryKey, AutoIncrement,
  ForeignKey, BelongsTo, CreatedAt, UpdatedAt
} from "sequelize-typescript";
import Service from "./Service";
import User from "./User";
import Company from "./Company";

@Table
class ServiceProfessional extends Model<ServiceProfessional> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Service)
  @Column
  serviceId: number;

  @BelongsTo(() => Service)
  service: Service;

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

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default ServiceProfessional;
