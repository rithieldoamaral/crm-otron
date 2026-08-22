import { QueryInterface, DataTypes } from "sequelize";

/**
 * Templates aprovados dos canais oficiais
 * (directives/canal_oficial_whatsapp.md §4.2).
 *
 * Fora da janela de 24h, a Meta só aceita template PREVIAMENTE APROVADO. Esta
 * tabela é um espelho local do que já foi aprovado no provedor — não é a fonte
 * da verdade, é cache consultável.
 *
 * Por que espelhar em vez de consultar a API a cada envio: um envio proativo
 * (lembrete, aniversário) não pode depender de uma chamada externa para
 * descobrir se pode acontecer. Se a API do provedor estiver lenta ou fora, o
 * envio falharia por motivo alheio à mensagem.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("WhatsappTemplates", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        // Template sem a conexão que o originou não tem uso: some junto.
        onDelete: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      name: { type: DataTypes.STRING, allowNull: false },
      language: { type: DataTypes.STRING, allowNull: false },
      category: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false },
      bodyText: { type: DataTypes.TEXT, allowNull: true },
      /**
       * Quantos parâmetros o template espera. Enviar quantidade diferente da
       * esperada faz a Meta rejeitar — validar antes evita a falha silenciosa
       * de "enviado mas não entregue".
       */
      variableCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      syncedAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Um template é identificado por nome + idioma dentro de uma conexão. O
    // único previne duplicata a cada sincronização.
    await queryInterface.addIndex("WhatsappTemplates", {
      fields: ["whatsappId", "name", "language"],
      unique: true,
      name: "whatsapp_templates_conexao_nome_idioma"
    });

    // Isolamento multi-tenant (XV.3): toda listagem filtra por empresa.
    await queryInterface.addIndex("WhatsappTemplates", {
      fields: ["companyId"],
      name: "whatsapp_templates_company"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("WhatsappTemplates");
  }
};
