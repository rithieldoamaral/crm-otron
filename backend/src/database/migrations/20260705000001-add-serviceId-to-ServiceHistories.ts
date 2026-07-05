"use strict";

import { QueryInterface, DataTypes } from "sequelize";

/**
 * Migration (Fase 7): adiciona FK `serviceId` à tabela ServiceHistories.
 *
 * PORQUÊ: hoje o analytics agrupa receita por `serviceType` (texto livre), o que
 * é frágil — variações de grafia ("corte" vs "Corte") viram buckets distintos e
 * não há vínculo confiável com o catálogo (Services). `serviceId` permite
 * GROUP BY por serviço real do catálogo.
 *
 * BACKWARD-COMPATIBLE por design:
 *   - Coluna NULLABLE: registros históricos ficam com serviceId = NULL e
 *     continuam a ser agregados por `serviceType` (fallback). Nenhum número
 *     existente muda.
 *   - onDelete SET NULL: apagar um serviço do catálogo NÃO apaga o histórico
 *     financeiro (a receita já aconteceu); apenas perde o vínculo.
 *   - Index (companyId, serviceId): suporta o GROUP BY por serviço quando o
 *     analytics passar a preferir serviceId.
 *
 * Rollback: remove o índice e a coluna (o vínculo é perdido; os registros e o
 * campo `serviceType` permanecem intactos).
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.addColumn("ServiceHistories", "serviceId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "Services", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addIndex("ServiceHistories", ["companyId", "serviceId"], {
      name: "service_histories_company_service_idx",
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeIndex(
      "ServiceHistories",
      "service_histories_company_service_idx"
    );
    await queryInterface.removeColumn("ServiceHistories", "serviceId");
  },
};
