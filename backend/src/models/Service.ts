import {
  Table, Column, CreatedAt, UpdatedAt, Model, DataType,
  PrimaryKey, AutoIncrement, Default, ForeignKey, BelongsTo, HasMany,
  AllowNull
} from "sequelize-typescript";
import Company from "./Company";
import ServiceProfessional from "./ServiceProfessional";

@Table
class Service extends Model<Service> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING)
  name: string;

  @Column
  durationMinutes: number;

  @Column(DataType.TEXT)
  description: string;

  /**
   * Preço unitário do serviço em Reais.
   * null = preço não cadastrado (exibe "a combinar" no frontend).
   * Adicionado na Fase 5 — migration 20260521000001-add-price-to-Services.
   */
  @AllowNull(true)
  @Column(DataType.DECIMAL(10, 2))
  price: number;

  /**
   * Categoria livre do serviço (ex: "Depilação a Laser", "Coloração").
   * Usado para agrupar serviços na página de catálogo e em analytics de Fase 7.
   * Adicionado na Fase 5 — migration 20260521000001-add-price-to-Services.
   */
  @AllowNull(true)
  @Column(DataType.STRING(80))
  category: string;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @Default(true)
  @Column
  isActive: boolean;

  @HasMany(() => ServiceProfessional)
  serviceProfessionals: ServiceProfessional[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Service;
