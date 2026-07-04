/**
 * GlobalSetting — configurações globais da plataforma (nível super admin).
 *
 * Diferente de Setting (por empresa/companyId), GlobalSetting armazena
 * pares key-value que se aplicam a TODAS as empresas da plataforma.
 *
 * Uso principal: configuração de provedores LLM globais, definida pelo
 * super admin e herdada por todas as empresas automaticamente.
 *
 * Keys utilizadas:
 *   globalAgentProvider    — provedor LLM do Agente de Atendimento
 *   globalAgentApiKey      — API key do Agente de Atendimento
 *   globalAgentModel       — modelo LLM do Agente de Atendimento
 *   globalSecretaryProvider — provedor LLM da Secretária IA
 *   globalSecretaryApiKey  — API key da Secretária IA
 *   globalSecretaryModel   — modelo LLM da Secretária IA
 */

import {
  Table,
  Column,
  Model,
  PrimaryKey,
  AutoIncrement,
  Unique,
  CreatedAt,
  UpdatedAt,
  DataType,
} from "sequelize-typescript";

@Table({ tableName: "GlobalSettings" })
class GlobalSetting extends Model<GlobalSetting> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  /** Chave única da configuração (ex: "globalAgentModel") */
  @Unique
  @Column
  key: string;

  /** Valor armazenado como string (números, booleans devem ser convertidos pelo consumer) */
  @Column(DataType.TEXT)
  value: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default GlobalSetting;
