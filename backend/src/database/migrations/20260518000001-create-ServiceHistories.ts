import { QueryInterface, DataTypes } from "sequelize";

/**
 * Tabela ServiceHistories — fonte de verdade para o módulo de Retenção.
 *
 * Cada row representa UMA visita/serviço realizado por um contato.
 * Alimenta:
 *   - Detecção de adormecidos (intervalo médio entre serviços)
 *   - Análise RFM (frequência, recência, monetary)
 *   - Programa de fidelidade (contagem de visitas)
 *   - Cross-sell (que serviços o cliente já fez)
 *
 * Sources possíveis:
 *   - 'scheduled_autoclose' — agendamento que passou do horário e foi auto-fechado
 *   - 'kanban_completion'   — ticket movido para a tag marcada como "Venda Concluída"
 *   - 'manual'              — atendente registrou explicitamente
 *   - 'migration'           — registro retroativo da migração inicial
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ServiceHistories", {
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
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      scheduleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Schedules", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      source: {
        type: DataTypes.STRING(30),
        allowNull: false,
        comment: "scheduled_autoclose | kanban_completion | manual | migration"
      },
      serviceType: {
        type: DataTypes.STRING(80),
        allowNull: true,
        comment: "Opcional: 'corte', 'barba', 'pintura', etc."
      },
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Valor monetário da venda/serviço (opcional)"
      },
      occurredAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: "Quando o serviço ocorreu (não quando o registro foi criado)"
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Índices para queries de retenção serem rápidas
    await queryInterface.addIndex("ServiceHistories", ["contactId", "occurredAt"], {
      name: "service_histories_contact_occurred_idx"
    });
    await queryInterface.addIndex("ServiceHistories", ["companyId", "occurredAt"], {
      name: "service_histories_company_occurred_idx"
    });
    await queryInterface.addIndex("ServiceHistories", ["ticketId"], {
      name: "service_histories_ticket_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ServiceHistories");
  }
};
