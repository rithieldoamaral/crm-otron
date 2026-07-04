"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: Fase 6 — cria a tabela ClientPackagePurchases.
 *
 * Cada linha = uma venda concreta de pacote para um cliente.
 * totalSessions e totalPrice são snapshots do momento da compra para
 * garantir imutabilidade histórica (o template Package pode mudar depois).
 *
 * packageId usa SET NULL no onDelete para preservar o histórico de compras
 * mesmo se o template do pacote for deletado.
 *
 * Rollback: dropTable.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("ClientPackagePurchases", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
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

      packageId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Packages", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },

      /** Snapshot do nome do serviço no momento da compra. */
      serviceName: { type: DataTypes.STRING(150), allowNull: true },

      /** Snapshot: número de sessões contratadas. */
      totalSessions: { type: DataTypes.INTEGER, allowNull: false },

      /** Sessões já consumidas (incrementado por PackageConsumption). */
      sessionsUsed: { type: DataTypes.INTEGER, defaultValue: 0 },

      /** Snapshot: valor total pago. */
      totalPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },

      /** 'active' | 'completed' | 'expired' | 'cancelled' */
      status: { type: DataTypes.STRING(20), defaultValue: "active" },

      /** Nullable = sem data de validade. */
      expiresAt: { type: DataTypes.DATE, allowNull: true },

      /** Data da venda (pode diferir de createdAt em backfills). */
      purchasedAt: { type: DataTypes.DATE, allowNull: false },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("ClientPackagePurchases");
  },
};
