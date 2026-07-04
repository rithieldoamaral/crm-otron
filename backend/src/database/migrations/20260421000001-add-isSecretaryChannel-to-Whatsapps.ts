import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const tableDescription = await queryInterface.describeTable("Whatsapps");

    if (!(tableDescription as any).isSecretaryChannel) {
      await queryInterface.addColumn("Whatsapps", "isSecretaryChannel", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "isSecretaryChannel");
  }
};
