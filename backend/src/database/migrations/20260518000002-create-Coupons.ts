import { QueryInterface, DataTypes } from "sequelize";

/**
 * Tabela Coupons — cupons únicos rastreáveis.
 *
 * Cada cupom é gerado para um contato específico (ou pode ser genérico).
 * Sistema garante código único por empresa e impede double-redemption.
 *
 * Reasons:
 *   - 'birthday'     — gerado pelo Aniversário Inteligente
 *   - 'reactivation' — gerado por reativação de adormecido
 *   - 'loyalty'      — programa de fidelidade (X visitas → cupom)
 *   - 'referral'     — recompensa por indicação
 *   - 'manual'       — gerado manualmente por atendente/admin
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("Coupons", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      code: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true,
        comment: "Código único do cupom (ex: ANIVER-MARIA-7H2K)"
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Contacts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Cupom pode ficar órfão se contato for deletado"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      reason: {
        type: DataTypes.STRING(30),
        allowNull: false,
        comment: "birthday | reactivation | loyalty | referral | manual"
      },
      discountType: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: "percent | fixed | free_service"
      },
      discountValue: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Valor (10 = 10% se type=percent, R$10 se type=fixed)"
      },
      validFrom: {
        type: DataTypes.DATE,
        allowNull: false
      },
      validUntil: {
        type: DataTypes.DATE,
        allowNull: false
      },
      redeemedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "NULL = ainda não usado"
      },
      redeemedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        comment: "Atendente que confirmou o uso"
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Índices para queries de cupom serem rápidas
    await queryInterface.addIndex("Coupons", ["contactId", "validUntil"], {
      name: "coupons_contact_validity_idx"
    });
    await queryInterface.addIndex("Coupons", ["companyId", "redeemedAt"], {
      name: "coupons_company_redeemed_idx"
    });
    await queryInterface.addIndex("Coupons", ["code"], {
      name: "coupons_code_idx",
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("Coupons");
  }
};
