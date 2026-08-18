import { QueryInterface, DataTypes } from "sequelize";

/**
 * Razão de créditos (directives/token_governance.md).
 *
 * Saldo = SUM(amountBrl) por empresa. Não existe coluna de saldo, de
 * propósito: coluna mutável sofre lost update sob concorrência e apaga o
 * rastro de como a empresa chegou àquele valor.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("CreditLedgers", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        // Histórico financeiro não evapora junto com a empresa.
        onDelete: "RESTRICT"
      },
      type: {
        type: DataTypes.STRING(20),
        allowNull: false
      },
      // Positivo credita, negativo debita.
      amountBrl: {
        type: DataTypes.DECIMAL(16, 8),
        allowNull: false,
        defaultValue: 0
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      referenceId: {
        type: DataTypes.STRING(80),
        allowNull: true
      },
      createdByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // O saldo é somado por empresa a cada consulta do painel.
    await queryInterface.addIndex("CreditLedgers", ["companyId", "createdAt"], {
      name: "credit_ledgers_company_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("CreditLedgers");
  }
};
