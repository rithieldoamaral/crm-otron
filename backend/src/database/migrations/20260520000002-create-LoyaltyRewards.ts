/**
 * LoyaltyRewards — recompensas de fidelidade entregues automaticamente
 * quando o cliente atinge marcos (5, 10, 20 serviços, etc).
 *
 * Idempotência: UNIQUE(contactId, milestone) — cada marco só pode ser
 * recompensado uma vez por cliente.
 *
 * Fase 3B do Módulo de Retenção.
 */

import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("LoyaltyRewards", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      /**
       * Marco atingido (ex: 5, 10, 20). Combinado com contactId é único.
       * Permite múltiplos marcos por cliente sem duplicação.
       */
      milestone: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      /** Cupom gerado como recompensa */
      couponId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Coupons", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      /** Quando foi entregue */
      awardedAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addConstraint(
      "LoyaltyRewards",
      ["contactId", "milestone"],
      {
        type: "unique",
        name: "loyalty_rewards_contact_milestone_unique"
      }
    );

    await queryInterface.addIndex("LoyaltyRewards", ["companyId", "awardedAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("LoyaltyRewards");
  }
};
