import { QueryInterface, DataTypes } from "sequelize";

/**
 * Medição de consumo de LLM — uma linha por CHAMADA ao modelo.
 *
 * Existe separada de `AgentActions` porque as duas respondem perguntas
 * diferentes: AgentActions audita O QUE o agente fez (uma linha por tool);
 * TokenUsages mede QUANTO custou (uma linha por chamada ao LLM).
 *
 * Misturar as duas foi a origem do bug que motivou este módulo: os tokens
 * eram gravados dentro do laço de tool calls, então um turno com 3 tools
 * contava o consumo 3 vezes e um turno sem tool não contava nenhuma.
 *
 * Tabela é APPEND-ONLY: nunca sofre UPDATE. Correção se faz por lançamento
 * novo, para que o histórico financeiro permaneça auditável.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("TokenUsages", {
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
        // RESTRICT e não CASCADE: histórico financeiro não pode evaporar
        // junto com a empresa. Encerrar contrato não apaga o que foi gasto.
        onDelete: "RESTRICT"
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      /** agent | secretary | summary — de onde partiu a chamada */
      source: {
        type: DataTypes.STRING(30),
        allowNull: false
      },
      provider: { type: DataTypes.STRING(50), allowNull: false },
      model: { type: DataTypes.STRING(120), allowNull: false },

      inputTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      outputTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      /** Entrada servida por cache. Zero enquanto o caching não é usado. */
      cachedInputTokens: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },

      // ── Preço CONGELADO no momento do uso ────────────────────────────
      // Recalcular consumo antigo com o preço de hoje reescreveria histórico
      // e invalidaria qualquer valor já informado ao cliente.
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
      usdToBrlUsed: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 0
      },
      markupPercent: {
        type: DataTypes.DECIMAL(8, 4),
        allowNull: false,
        defaultValue: 0
      },

      costUsd: {
        type: DataTypes.DECIMAL(16, 8),
        allowNull: false,
        defaultValue: 0
      },
      costBrl: {
        type: DataTypes.DECIMAL(16, 8),
        allowNull: false,
        defaultValue: 0
      },
      /** Custo + markup: o que é imputado à empresa. Igual ao custo quando markup=0. */
      priceBrl: {
        type: DataTypes.DECIMAL(16, 8),
        allowNull: false,
        defaultValue: 0
      },

      /** Provider não devolveu usage — não estimamos, sinalizamos. */
      usageMissing: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      /** Modelo sem preço cadastrado — custo 0 e destaque no painel. */
      pricingMissing: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },

      /**
       * Chave de idempotência: impede que um retry da mesma chamada vire
       * débito duplicado. UNIQUE no banco — a garantia não pode depender de
       * o código lembrar de checar antes.
       */
      idempotencyKey: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true
      },

      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // O painel sempre filtra por empresa e período; sem este índice a consulta
    // vira varredura completa assim que a tabela crescer.
    await queryInterface.addIndex("TokenUsages", ["companyId", "createdAt"], {
      name: "token_usages_company_period_idx"
    });

    // Ranking por modelo dentro de um período.
    await queryInterface.addIndex(
      "TokenUsages",
      ["companyId", "model", "createdAt"],
      {
        name: "token_usages_company_model_idx"
      }
    );

    // Custo por atendimento agrupa por ticket.
    await queryInterface.addIndex("TokenUsages", ["ticketId"], {
      name: "token_usages_ticket_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("TokenUsages");
  }
};
