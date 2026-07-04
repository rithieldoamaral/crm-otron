"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: Fase 6 — cria a tabela PackageConsumptions.
 *
 * Uma linha por sessão consumida de um pacote.
 * serviceHistoryId é nullable para suportar consumos manuais (sem agendamento).
 *
 * contactId é desnormalizado (também existe em ClientPackagePurchase)
 * para permitir queries rápidas por cliente sem JOIN adicional.
 *
 * Rollback: dropTable.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("PackageConsumptions", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      clientPackagePurchaseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "ClientPackagePurchases", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      contactId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      /**
       * Nullable — preenchido apenas quando o consumo veio de um
       * ServiceHistory existente (kanban_completion / scheduled_autoclose).
       */
      serviceHistoryId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "ServiceHistories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },

      notes: { type: DataTypes.TEXT, allowNull: true },

      consumedAt: { type: DataTypes.DATE, allowNull: false },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("PackageConsumptions");
  },
};
