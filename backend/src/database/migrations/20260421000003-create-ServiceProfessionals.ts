import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ServiceProfessionals", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      serviceId: {
        type: DataTypes.INTEGER,
        references: { model: "Services", key: "id" },
        onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      userId: {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE", onDelete: "CASCADE"
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ServiceProfessionals");
  }
};
