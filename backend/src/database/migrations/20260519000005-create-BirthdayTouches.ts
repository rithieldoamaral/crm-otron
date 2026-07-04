import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("BirthdayTouches", {
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
       * Ano do ciclo (ex: 2026). Combinado com touchType garante disparo único por ano.
       */
      year: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      /**
       * Qual dos 3 toques foi enviado:
       *   dm3 — D-3 (antecipação, 3 dias antes)
       *   d0  — D-0 (aniversário, + gera cupom)
       *   dp7 — D+7 (follow-up, 7 dias depois)
       */
      touchType: {
        type: DataTypes.ENUM("dm3", "d0", "dp7"),
        allowNull: false
      },
      /**
       * Quando a mensagem foi efetivamente enviada.
       */
      sentAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      /**
       * ID do cupom gerado no toque D-0 (NULL nos outros toques).
       */
      couponId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Coupons", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    // Idempotência: 1 toque por tipo por contato por ano
    // Sequelize v5: addConstraint(table, fields[], options)
    await queryInterface.addConstraint("BirthdayTouches", ["contactId", "year", "touchType"], {
      type: "unique",
      name: "birthday_touches_contact_year_type_unique"
    });

    // Índice para queries rápidas por empresa
    await queryInterface.addIndex("BirthdayTouches", ["companyId", "year"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("BirthdayTouches");
  }
};
