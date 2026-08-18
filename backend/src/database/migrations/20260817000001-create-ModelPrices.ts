import { QueryInterface, DataTypes } from "sequelize";

/**
 * Catálogo de preços por provider+modelo (directives/token_governance.md).
 *
 * O seed cobre apenas modelos cujo preço é conhecido com confiança. Modelos
 * fora da lista aparecem no painel como "preço não cadastrado" em vez de
 * receberem um valor chutado — estimativa silenciosa vira número errado com
 * aparência de número certo. O superadmin cadastra pela própria tela.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ModelPrices", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: false
      },
      model: {
        type: DataTypes.STRING(120),
        allowNull: false
      },
      // DECIMAL e não FLOAT: preço é dinheiro; binário flutuante acumula erro
      // quando somado sobre milhares de chamadas.
      inputPricePerMillion: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      outputPricePerMillion: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      cachedInputPricePerMillion: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      effectiveFrom: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      source: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Busca sempre por (provider, model) ordenando por effectiveFrom.
    await queryInterface.addIndex(
      "ModelPrices",
      ["provider", "model", "effectiveFrom"],
      {
        name: "model_prices_lookup_idx"
      }
    );

    const now = new Date();
    const seed = (
      provider: string,
      model: string,
      input: number,
      output: number,
      cached: number
    ) => ({
      provider,
      model,
      inputPricePerMillion: input,
      outputPricePerMillion: output,
      cachedInputPricePerMillion: cached,
      effectiveFrom: now,
      source: "Seed inicial 2026-08 — CONFERIR nas docs oficiais do provedor",
      createdAt: now,
      updatedAt: now
    });

    await queryInterface.bulkInsert("ModelPrices", [
      seed("anthropic", "claude-haiku-4-5", 1.0, 5.0, 0.1),
      seed("anthropic", "claude-sonnet-4-5", 3.0, 15.0, 0.3),
      seed("openai", "gpt-4o-mini", 0.15, 0.6, 0.075),
      seed("openai", "gpt-4o", 2.5, 10.0, 1.25),
      seed("deepseek", "deepseek-chat", 0.27, 1.1, 0.027),
      seed("deepseek", "deepseek-reasoner", 0.55, 2.19, 0.055)
    ]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ModelPrices");
  }
};
