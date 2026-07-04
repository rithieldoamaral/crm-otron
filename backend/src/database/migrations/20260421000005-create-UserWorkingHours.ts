import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("UserWorkingHours", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
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
      dayOfWeek: { type: DataTypes.INTEGER, allowNull: false },
      startTime: { type: DataTypes.STRING, allowNull: true },
      endTime: { type: DataTypes.STRING, allowNull: true },
      isWorking: { type: DataTypes.BOOLEAN, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("UserWorkingHours");
  }
};
