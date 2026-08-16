import AppError from "../../errors/AppError";
import Announcement from "../../models/Announcement";

interface Data {
  id: number | string;
  priority: string;
  title: string;
  text: string;
  status: string;
  companyId: number;
}

const UpdateService = async (data: Data): Promise<Announcement> => {
  const { id } = data;

  const record = await Announcement.findByPk(id);

  if (!record) {
    throw new AppError("ERR_NO_ANNOUNCEMENT_FOUND", 404);
  }

  // SEQUELIZE 6: casts preservam os valores já enviados (id sempre foi
  // number|string, status sempre foi tipado string na interface local
  // embora a coluna seja boolean) — comportamento em runtime inalterado.
  await record.update({
    ...data,
    id: data.id as unknown as number,
    status: data.status as unknown as boolean,
    priority: Number(data.priority)
  });

  return record;
};

export default UpdateService;
