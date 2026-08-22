import { QueryInterface, DataTypes } from "sequelize";

/**
 * Canal oficial do WhatsApp (directives/canal_oficial_whatsapp.md §4.1).
 *
 * `channelType` com default "baileys" é o que garante que TODA conexão
 * existente continue funcionando sem migração de dados: quem já está no banco
 * passa a ser explicitamente Baileys, que é o comportamento que já tinha.
 *
 * NÃO reaproveita a coluna `provider`, que existe desde 2022 mas guarda a
 * versão do protocolo Baileys ("stable" vs beta) — nome parecido, semântica
 * diferente. Reaproveitar geraria bug sutil.
 *
 * `channelConfig` guarda credencial de terceiro (token permanente da Meta,
 * Auth Token da Twilio) e por isso é gravado CIFRADO — ver
 * helpers/encryptedField.ts e CLAUDE.md XV.6. O tipo é TEXT porque o
 * ciphertext em base64 não tem tamanho fixo previsível.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.addColumn("Whatsapps", "channelType", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "baileys"
      }),
      queryInterface.addColumn("Whatsapps", "channelConfig", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      })
    ]);
  },

  down: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.removeColumn("Whatsapps", "channelType"),
      queryInterface.removeColumn("Whatsapps", "channelConfig")
    ]);
  }
};
