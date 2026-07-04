import { QueryInterface, DataTypes } from "sequelize";

/**
 * Adiciona flag `isCompletionTag` em Tags.
 *
 * Apenas UMA tag por empresa pode ter esta flag.
 * Quando um Ticket recebe essa tag (movido no Kanban para a coluna correspondente),
 * o sistema:
 *   1. Fecha o ticket automaticamente
 *   2. Cria um ServiceHistory com source='kanban_completion'
 *
 * Permite usar o Kanban existente como funil de vendas:
 * "Lead" → "Negociação" → "Proposta" → "Venda Concluída" ⭐ (isCompletionTag = true)
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tags", "isCompletionTag", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "Se true, ticket movido para esta tag é fechado e gera ServiceHistory"
    });

    // Constraint: só 1 tag completion por empresa
    // (Postgres permite unique parcial; em outros bancos, valida na camada de service)
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX tags_one_completion_per_company
      ON "Tags" ("companyId")
      WHERE "isCompletionTag" = true
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS tags_one_completion_per_company
    `);
    await queryInterface.removeColumn("Tags", "isCompletionTag");
  }
};
