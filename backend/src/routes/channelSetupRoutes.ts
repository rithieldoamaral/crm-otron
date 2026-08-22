import { Router } from "express";

import * as ChannelSetupController from "../controllers/ChannelSetupController";
import isAuth from "../middleware/isAuth";

const channelSetupRoutes = Router();

/**
 * Configuração de canais oficiais (Assistente de Conexão).
 *
 * TODAS exigem `isAuth`. Diferente do webhook — que é público porque o
 * provedor chama de fora —, estas rotas são usadas pela própria interface e
 * não têm motivo para dispensar sessão.
 *
 * O gate de empresa fica no controller, que carrega a conexão com o
 * `companyId` da sessão dentro do WHERE: id de outra empresa simplesmente não
 * é encontrado (CLAUDE.md XV.3).
 */
channelSetupRoutes.post(
  "/channel/validate",
  isAuth,
  ChannelSetupController.validate
);

channelSetupRoutes.put(
  "/channel/:whatsappId/config",
  isAuth,
  ChannelSetupController.saveConfig
);

channelSetupRoutes.get(
  "/channel/:whatsappId/webhook-info",
  isAuth,
  ChannelSetupController.webhookInfo
);

channelSetupRoutes.post(
  "/channel/:whatsappId/test-message",
  isAuth,
  ChannelSetupController.testMessage
);

export default channelSetupRoutes;
