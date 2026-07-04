"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: Fase 6 — cria a tabela Packages (templates de pacotes de sessões).
 *
 * Cada linha representa um produto reutilizável (ex: "Pacote 10 Sessões Laser").
 * Vendas concretas ficam em ClientPackagePurchases.
 *
 * Rollback: dropTable (dados são perdidos — apenas templates, não histórico de vendas).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("Packages", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      serviceId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Services", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },

      name: { type: DataTypes.STRING(150), allowNull: false },

      description: { type: DataTypes.TEXT, allowNull: true },

      totalSessions: { type: DataTypes.INTEGER, allowNull: false },

      totalPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("Packages");
  },
};
