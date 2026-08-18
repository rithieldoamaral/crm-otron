import QueueOption from "../../models/QueueOption";
import ShowService from "./ShowService";

interface QueueData {
  queueId?: string;
  title?: string;
  option?: string;
  message?: string;
  parentId?: string;
  queueType?: string;
  queueOptionsId?: number;
  queueUsersId?: number;
}

const UpdateService = async (
  queueOptionId: number | string,
  queueOptionData: QueueData
): Promise<QueueOption> => {

  const queueOption = await ShowService(queueOptionId);

  // SEQUELIZE 6: só inclui queueId convertido quando realmente enviado,
  // preservando o comportamento original (chave ausente = coluna intocada).
  const updatePayload: Record<string, unknown> = { ...queueOptionData };
  if (queueOptionData.queueId !== undefined) {
    updatePayload.queueId = Number(queueOptionData.queueId);
  }
  await queueOption.update(updatePayload);

  return queueOption;
};

export default UpdateService;
