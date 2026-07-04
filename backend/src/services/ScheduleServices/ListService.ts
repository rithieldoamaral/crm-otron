import { Op, Sequelize } from "sequelize";
import Contact from "../../models/Contact";
import Schedule from "../../models/Schedule";
import User from "../../models/User";
import Service from "../../models/Service";

interface Request {
  searchParam?: string;
  contactId?: number | string;
  userId?: number | string;
  professionalId?: number | string;
  serviceId?: number | string;
  companyId?: number;
  pageNumber?: string | number;
  geral?: boolean;
  queueId?: number;
  whatsappId?: number;
}

interface Response {
  schedules: Schedule[];
  count: number;
  hasMore: boolean;
}

const ListService = async ({
  searchParam,
  contactId = "",
  userId = "",
  professionalId = "",
  serviceId = "",
  pageNumber = "1",
  companyId,
  geral,
  queueId,
  whatsappId
}: Request): Promise<Response> => {
  let whereCondition = {};
  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  if (searchParam) {
    whereCondition = {
      [Op.or]: [
        {
          "$Schedule.body$": Sequelize.where(
            Sequelize.fn("LOWER", Sequelize.col("Schedule.body")),
            "LIKE",
            `%${searchParam.toLowerCase()}%`
          )
        },
        {
          "$Contact.name$": Sequelize.where(
            Sequelize.fn("LOWER", Sequelize.col("contact.name")),
            "LIKE",
            `%${searchParam.toLowerCase()}%`
          )
        },
      ],
    }
  }

  if (contactId !== "") {
    whereCondition = {
      ...whereCondition,
      contactId
    }
  }

  if (userId !== "") {
    whereCondition = {
      ...whereCondition,
      userId
    }
  }

  if (professionalId !== "" && professionalId !== undefined && professionalId !== null) {
    whereCondition = {
      ...whereCondition,
      professionalId
    }
  }

  if (serviceId !== "" && serviceId !== undefined && serviceId !== null) {
    whereCondition = {
      ...whereCondition,
      serviceId
    }
  }

  whereCondition = {
    ...whereCondition,
    companyId: {
      [Op.eq]: companyId
    },
    // Bug #26 (Round 10): agendamentos CANCELADOS não devem aparecer no calendário.
    // O status "CANCELADO" é permanente — exibi-los gera confusão pois o bot
    // confirmou o cancelamento mas o evento continuava visível após refresh.
    status: { [Op.notIn]: ["CANCELADO"] }
  }

  const { count, rows: schedules } = await Schedule.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name"] },
      { model: User, as: "user", attributes: ["id", "name"] },
      { model: Service, as: "service", attributes: ["id", "name", "durationMinutes"], required: false },
    ]
  });

  const hasMore = count > offset + schedules.length;

  return {
    schedules,
    count,
    hasMore
  };
};

export default ListService;
