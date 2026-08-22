import { Router } from "express";

import * as WhatsappTemplateController from "../controllers/WhatsappTemplateController";
import isAuth from "../middleware/isAuth";

const whatsappTemplateRoutes = Router();

/**
 * Templates dos canais oficiais.
 *
 * `isAuth` em TODAS as rotas. O gate de empresa é feito dentro do controller,
 * que carrega a conexão com `companyId` da sessão no WHERE — de forma que um
 * id de conexão de outro tenant simplesmente não é encontrado (CLAUDE.md XV.3).
 *
 * Diferente das rotas de governança de tokens, aqui NÃO se exige `isSuper`: o
 * template é dado operacional da própria empresa (quais mensagens ela pode
 * disparar), não dado comercial da plataforma.
 */
whatsappTemplateRoutes.get(
  "/whatsapp-templates/:whatsappId",
  isAuth,
  WhatsappTemplateController.index
);

whatsappTemplateRoutes.post(
  "/whatsapp-templates/:whatsappId/sync",
  isAuth,
  WhatsappTemplateController.sync
);

export default whatsappTemplateRoutes;
