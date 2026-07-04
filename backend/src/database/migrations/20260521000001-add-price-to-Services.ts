"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration: Fase 5 — adiciona campos de preço e categoria à tabela Services.
 *
 * Mudanças:
 *   - `price`    DECIMAL(10,2) NULL — preço unitário do serviço em Reais
 *   - `category` VARCHAR(80)   NULL — categoria livre (ex: "Depilação a Laser")
 *
 * Ambos os campos são nullable para não quebrar serviços cadastrados antes
 * desta migration (backward compatible).
 *
 * Rollback: remove as duas colunas (dados são perdidos — aviso operacional).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn("Services", "price", {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    });

    await queryInterface.addColumn("Services", "category", {
      type: DataTypes.STRING(80),
      allowNull: true,
      defaultValue: null,
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // AVISO: rollback apaga os preços e categorias cadastrados.
    await queryInterface.removeColumn("Services", "price");
    await queryInterface.removeColumn("Services", "category");
  },
};
