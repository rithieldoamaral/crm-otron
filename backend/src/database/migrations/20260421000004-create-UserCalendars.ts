import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("UserCalendars", {
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
      googleAccountEmail: { type: DataTypes.STRING, allowNull: true },
      calendarId: { type: DataTypes.STRING, allowNull: true },
      accessToken: { type: DataTypes.TEXT, allowNull: true },
      refreshToken: { type: DataTypes.TEXT, allowNull: true },
      tokenExpiry: { type: DataTypes.DATE, allowNull: true },
      isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("UserCalendars");
  }
};
