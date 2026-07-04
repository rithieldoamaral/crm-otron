import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AgentActions", {
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
        onDelete: "CASCADE"
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      contactId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      /** Nome da tool executada (buscar_contato, enviar_mensagem, etc.) */
      action: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      parameters: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      result: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      success: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: true
      },
      model: {
        type: DataTypes.STRING(100),
        allowNull: true
      },
      inputTokens: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      outputTokens: {
        type: DataTypes.INTEGER,
        allowNull: true
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

    await queryInterface.addIndex("AgentActions", ["companyId"], {
      name: "AgentActions_companyId_idx"
    });
    await queryInterface.addIndex("AgentActions", ["ticketId"], {
      name: "AgentActions_ticketId_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AgentActions");
  }
};
