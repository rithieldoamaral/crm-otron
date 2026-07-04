"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: cria a tabela ProfessionalWorkingHours.
 *
 * Horários de trabalho para CalendarProfessionals (profissionais sem conta na plataforma).
 * Análoga à tabela UserWorkingHours, mas referencia CalendarProfessionals.
 *
 * Full-replace pattern: no PUT, todos os registros são apagados e recriados
 * em transação (sem update parcial — evita estado inconsistente).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("ProfessionalWorkingHours", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      professionalId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "CalendarProfessionals", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      dayOfWeek: { type: DataTypes.INTEGER, allowNull: false }, // 0=Sun … 6=Sat
      startTime:  { type: DataTypes.STRING(5), allowNull: false }, // "HH:MM"
      endTime:    { type: DataTypes.STRING(5), allowNull: false },
      isWorking:  { type: DataTypes.BOOLEAN, defaultValue: true },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("ProfessionalWorkingHours");
  },
};
