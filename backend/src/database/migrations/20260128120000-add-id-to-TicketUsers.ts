import { QueryInterface, DataTypes, QueryTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Verifica se a tabela já possui coluna id (migration pode ser redundante
      // caso create-TicketUsers já inclua id com autoIncrement)
      const [columns] = await queryInterface.sequelize.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'TicketUsers' AND column_name = 'id';`,
        { transaction }
      );

      if ((columns as any[]).length > 0) {
        // Coluna id já existe — garante apenas o índice único de integridade
        await queryInterface.sequelize.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "TicketUsers_ticketId_userId_unique"
           ON "TicketUsers" ("ticketId", "userId");`,
          { transaction }
        );
        await transaction.commit();
        return;
      }

      // Remover a chave primária composta existente
      await queryInterface.sequelize.query(
        'ALTER TABLE "TicketUsers" DROP CONSTRAINT "TicketUsers_pkey";',
        { transaction }
      );

      // Adicionar a coluna id com sequence (IF NOT EXISTS para idempotência)
      await queryInterface.sequelize.query(
        'CREATE SEQUENCE IF NOT EXISTS "TicketUsers_id_seq";',
        { transaction }
      );
      
      await queryInterface.sequelize.query(
        'ALTER TABLE "TicketUsers" ADD COLUMN "id" INTEGER NOT NULL DEFAULT nextval(\'"TicketUsers_id_seq"\');',
        { transaction }
      );
      
      await queryInterface.sequelize.query(
        'ALTER SEQUENCE "TicketUsers_id_seq" OWNED BY "TicketUsers"."id";',
        { transaction }
      );

      // Definir id como chave primária
      await queryInterface.sequelize.query(
        'ALTER TABLE "TicketUsers" ADD PRIMARY KEY ("id");',
        { transaction }
      );

      // Criar índice único para manter a integridade de ticketId + userId
      await queryInterface.addIndex("TicketUsers", ["ticketId", "userId"], {
        unique: true,
        name: "TicketUsers_ticketId_userId_unique",
        transaction
      });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      // Remover o índice único
      await queryInterface.removeIndex(
        "TicketUsers",
        "TicketUsers_ticketId_userId_unique",
        { transaction }
      );

      // Remover a chave primária atual
      await queryInterface.sequelize.query(
        'ALTER TABLE "TicketUsers" DROP CONSTRAINT "TicketUsers_pkey";',
        { transaction }
      );

      // Remover a coluna id
      await queryInterface.removeColumn("TicketUsers", "id", { transaction });

      // Remover a sequence
      await queryInterface.sequelize.query(
        'DROP SEQUENCE IF EXISTS "TicketUsers_id_seq";',
        { transaction }
      );

      // Recriar a chave primária composta
      await queryInterface.sequelize.query(
        'ALTER TABLE "TicketUsers" ADD CONSTRAINT "TicketUsers_pkey" PRIMARY KEY ("ticketId", "userId");',
        { transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
