import { QueryInterface, DataTypes } from "sequelize";

/**
 * Adiciona campos de opt-out de marketing em Contacts.
 *
 * Cumpre LGPD: cliente pode pedir para não receber mais mensagens de marketing
 * (cupons, reativação, aniversário, etc.). Atendimento normal continua liberado.
 *
 * Cliente que envia palavras-chave ("parar", "não me mande mais", "remover")
 * é marcado automaticamente como opt-out via processamento da mensagem recebida.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Contacts", "marketingOptOut", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "True se cliente pediu para não receber marketing/reativação"
    });

    await queryInterface.addColumn("Contacts", "marketingOptOutAt", {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Quando o opt-out foi registrado"
    });

    await queryInterface.addColumn("Contacts", "marketingOptOutReason", {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Motivo informado (texto livre ou palavra-chave detectada)"
    });

    await queryInterface.addIndex("Contacts", ["marketingOptOut", "companyId"], {
      name: "contacts_opt_out_idx"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Contacts", "contacts_opt_out_idx");
    await queryInterface.removeColumn("Contacts", "marketingOptOutReason");
    await queryInterface.removeColumn("Contacts", "marketingOptOutAt");
    await queryInterface.removeColumn("Contacts", "marketingOptOut");
  }
};
