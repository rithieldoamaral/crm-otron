"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: cria a tabela CalendarProfessionals.
 *
 * Profissionais autônomos para agendamento — NÃO precisam de conta na plataforma.
 * Ex: uma esteticista que não usa o CRM mas precisa ter seu calendário gerenciado.
 *
 * Decisão arquitetural: separado da tabela Users para não forçar a criação de
 * contas CRM para profissionais que só precisam de agendamento via Google Calendar.
 * Referenciado por ProfessionalCalendars e ProfessionalWorkingHours.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("CalendarProfessionals", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      name: { type: DataTypes.STRING(150), allowNull: false },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("CalendarProfessionals");
  },
};
