/**
 * Referrals — programa de indicação (Fase 4C).
 *
 * Conceito: cada contato tem um `referralCode` único. Quando esse código
 * é registrado em um novo contato (referredContactId), criamos um Referral.
 * Quando o indicado completa seu primeiro serviço, o referral vira
 * 'converted' e ambos (referrer e referred) ganham cupom de bônus.
 *
 * Idempotência:
 *   - UNIQUE(referredContactId): cada novo contato só pode ser indicado UMA vez
 *   - Conversão verifica outcome != 'converted' antes de processar
 */

import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("Referrals", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      /** Contato que indicou (referrer) */
      referrerContactId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      /** Novo contato indicado (referred) */
      referredContactId: {
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
      /** Código de indicação usado (snapshot — referrer pode mudar depois) */
      referralCode: {
        type: DataTypes.STRING(40),
        allowNull: false
      },
      /** pending | converted | expired */
      outcome: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending"
      },
      /** Quando o indicado fez seu primeiro serviço (NULL se ainda pending) */
      convertedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      /** Cupom dado ao referrer (gerado na conversão) */
      referrerCouponId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Coupons", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      /** Cupom dado ao indicado (gerado na conversão) */
      referredCouponId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Coupons", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Cada novo contato só pode ser indicado uma única vez
    await queryInterface.addConstraint(
      "Referrals",
      ["referredContactId"],
      {
        type: "unique",
        name: "referrals_referred_contact_unique"
      }
    );

    await queryInterface.addIndex("Referrals", ["companyId", "outcome"]);
    await queryInterface.addIndex("Referrals", ["referralCode"]);

    // ── Adiciona referralCode na tabela Contacts ────────────────────
    await queryInterface.addColumn("Contacts", "referralCode", {
      type: DataTypes.STRING(40),
      allowNull: true,
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Contacts", "referralCode");
    await queryInterface.dropTable("Referrals");
  }
};
