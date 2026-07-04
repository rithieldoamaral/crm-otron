/**
 * PreventiveTouches — registra os toques preventivos enviados
 * (mensagens proativas para clientes em risco de dormência).
 *
 * Idempotência por design:
 *   UNIQUE(contactId, baselineHistoryId) — onde baselineHistoryId é o id
 *   do último ServiceHistory na hora do envio. Quando o cliente volta e
 *   gera novo serviço, esse ID muda, permitindo um novo toque preventivo
 *   em ciclos futuros.
 *
 * Fase 3A do Módulo de Retenção.
 */

import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("PreventiveTouches", {
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
       * ID do último ServiceHistory no momento do envio.
       * Quando o cliente gera novo serviço, esse ID muda e libera
       * um novo toque preventivo em ciclos futuros.
       *
       * Pode ser NULL apenas se o contato não tem nenhum histórico
       * (caso extremamente raro, mas tratado).
       */
      baselineHistoryId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "ServiceHistories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      /** Quando a mensagem foi enviada */
      sentAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      /** Ratio (daysSinceLastService / avgInterval) no momento do envio */
      ratioAtSend: {
        type: DataTypes.DECIMAL(6, 3),
        allowNull: false
      },
      /** Dias desde o último serviço, no momento do envio */
      daysSinceLastService: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Idempotência: 1 toque preventivo por ciclo (definido por baselineHistoryId)
    await queryInterface.addConstraint(
      "PreventiveTouches",
      ["contactId", "baselineHistoryId"],
      {
        type: "unique",
        name: "preventive_touches_contact_baseline_unique"
      }
    );

    // Índice para queries por empresa
    await queryInterface.addIndex("PreventiveTouches", ["companyId", "sentAt"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("PreventiveTouches");
  }
};
