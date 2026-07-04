/**
 * Migration: create_SystemLogs
 *
 * Tabela de auditoria para uso do superadmin. Registra ações relevantes do
 * sistema: logins, mudanças de configuração, operações de ticket, etc.
 *
 * Design:
 * - Sem `updatedAt`: logs são imutáveis por definição.
 * - `companyId` nullable: eventos de sistema (ex: criação de empresa) não têm companyId.
 * - `details` JSONB: payload livre para contexto adicional sem alterar schema.
 * - Index em (companyId, createdAt) e em createdAt isolado — os dois padrões de
 *   consulta: "logs de empresa X" e "todos os logs por data".
 * - Retenção via cron externo (não enforced na tabela) — configurado para 30 dias.
 */

import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("SystemLogs", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      entity: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      entityId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      details: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      ip: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    });

    // Index para filtro por empresa + data (consulta mais comum)
    await queryInterface.addIndex("SystemLogs", ["companyId", "createdAt"]);
    // Index para varredura global por data (superadmin sem filtro de empresa)
    await queryInterface.addIndex("SystemLogs", ["createdAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("SystemLogs");
  }
};
