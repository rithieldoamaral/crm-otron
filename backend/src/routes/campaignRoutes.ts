/**
 * Anti-banimento (2026-07-26): enquanto operamos via Baileys (API nao-oficial),
 * disparo em massa por empresas-cliente e o maior vetor de banimento do numero.
 * Todo o modulo de Campanhas fica restrito ao super admin (dono da plataforma).
 * Esconder o menu no frontend nao basta — sem este gate, qualquer usuario
 * autenticado ainda dispararia campanha via chamada direta a API.
 */
import express from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";

import * as CampaignController from "../controllers/CampaignController";
import multer from "multer";
import uploadConfig from "../config/upload";

const upload = multer(uploadConfig);

const routes = express.Router();

routes.get("/campaigns/list", isAuth, isSuper, CampaignController.findList);

routes.get("/campaigns", isAuth, isSuper, CampaignController.index);

routes.get("/campaigns/:id", isAuth, isSuper, CampaignController.show);

routes.post("/campaigns", isAuth, isSuper, CampaignController.store);

routes.put("/campaigns/:id", isAuth, isSuper, CampaignController.update);

routes.delete("/campaigns/:id", isAuth, isSuper, CampaignController.remove);

routes.post("/campaigns/:id/cancel", isAuth, isSuper, CampaignController.cancel);

routes.post("/campaigns/:id/restart", isAuth, isSuper, CampaignController.restart);

routes.post(
  "/campaigns/:id/media-upload",
  isAuth, isSuper,
  upload.array("file"),
  CampaignController.mediaUpload
);

routes.delete(
  "/campaigns/:id/media-upload",
  isAuth, isSuper,
  CampaignController.deleteMedia
);

export default routes;
