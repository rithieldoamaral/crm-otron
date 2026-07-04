/**
 * ShowQueueIntegrationService
 *
 * Busca uma integração de fila pelo ID.
 * Mantida apenas como dependência interna do wbotMessageListener — a UI de
 * gerenciamento de integrações externas (n8n, typebot, dialogflow) foi removida
 * no Sprint 1 (decisão: crm_otron/decisions_log.md — 2026-05-17).
 */

import QueueIntegrations from "../../models/QueueIntegrations";

const ShowQueueIntegrationService = async (
  id: number | string,
  companyId: number
): Promise<QueueIntegrations> => {
  const integration = await QueueIntegrations.findOne({
    where: { id, companyId }
  });

  if (!integration) {
    throw new Error("ERR_QUEUE_INTEGRATION_NOT_FOUND");
  }

  return integration;
};

export default ShowQueueIntegrationService;
