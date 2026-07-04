"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: cria a tabela ProfessionalCalendars.
 *
 * Armazena tokens OAuth do Google Calendar para CalendarProfessionals
 * (profissionais sem conta na plataforma). Análoga à tabela UserCalendars,
 * mas referencia CalendarProfessionals em vez de Users.
 *
 * Tokens são encriptados com AES-256 antes de persistir (ver tokenCrypto.ts).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable("ProfessionalCalendars", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      professionalId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
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

      googleAccountEmail: { type: DataTypes.STRING(255), allowNull: true },
      calendarId:         { type: DataTypes.STRING(255), allowNull: true },
      accessToken:        { type: DataTypes.TEXT,        allowNull: true },
      refreshToken:       { type: DataTypes.TEXT,        allowNull: true },
      tokenExpiry:        { type: DataTypes.DATE,        allowNull: true },
      isActive:           { type: DataTypes.BOOLEAN,     defaultValue: false },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("ProfessionalCalendars");
  },
};
