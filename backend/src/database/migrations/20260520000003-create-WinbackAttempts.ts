/**
 * WinbackAttempts — tentativas de reativação de clientes perdidos.
 *
 * Conceito: quando um cliente atinge status "perdido" (ratio ≥ 4.0 do
 * intervalo médio), uma mensagem de win-back é enviada com cupom de
 * alto valor para reativar. Cooldown configurável evita spam.
 *
 * Idempotência: tentativas espaçadas no tempo, não por ciclo de serviço
 * (cliente perdido não tem mais ciclos). Limite via cooldown configurável.
 *
 * Fase 3C do Módulo de Retenção.
 */

import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("WinbackAttempts", {
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
      /** Cupom de reativação gerado */
      couponId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Coupons", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      /** Quando a tentativa foi enviada */
      sentAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      /** Resultado: pendente | convertido (cliente voltou) | sem_resposta */
      outcome: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending"
      },
      /** Quando o cliente respondeu/converteu (NULL se sem_resposta ou pending) */
      convertedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Para verificar cooldown rapidamente
    await queryInterface.addIndex("WinbackAttempts", ["contactId", "sentAt"]);
    await queryInterface.addIndex("WinbackAttempts", ["companyId", "sentAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("WinbackAttempts");
  }
};
