import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const table = await queryInterface.describeTable("Schedules");

    const addIfMissing = async (col: string, def: any) => {
      if (!(table as any)[col]) {
        await queryInterface.addColumn("Schedules", col, def);
      }
    };

    await addIfMissing("serviceId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Services", key: "id" },
      onUpdate: "CASCADE", onDelete: "SET NULL"
    });
    await addIfMissing("professionalId", { type: DataTypes.INTEGER, allowNull: true });
    await addIfMissing("googleEventId", { type: DataTypes.STRING, allowNull: true });
    await addIfMissing("reminderStatus", { type: DataTypes.STRING, allowNull: true });
    await addIfMissing("reminderSentAt", { type: DataTypes.DATE, allowNull: true });
    await addIfMissing("confirmedAt", { type: DataTypes.DATE, allowNull: true });
  },

  down: async (queryInterface: QueryInterface) => {
    for (const col of ["serviceId", "professionalId", "googleEventId", "reminderStatus", "reminderSentAt", "confirmedAt"]) {
      await queryInterface.removeColumn("Schedules", col);
    }
  }
};
