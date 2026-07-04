import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const tableDescription = await queryInterface.describeTable("Whatsapps");

    if (!(tableDescription as any).isAgentChannel) {
      await queryInterface.addColumn("Whatsapps", "isAgentChannel", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "isAgentChannel");
  }
};
