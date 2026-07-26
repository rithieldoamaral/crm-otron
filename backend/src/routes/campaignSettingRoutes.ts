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

import * as CampaignSettingController from "../controllers/CampaignSettingController";
import multer from "multer";
import uploadConfig from "../config/upload";

const upload = multer(uploadConfig);

const routes = express.Router();

routes.get("/campaign-settings", isAuth, isSuper, CampaignSettingController.index);

routes.post("/campaign-settings", isAuth, isSuper, CampaignSettingController.store);

export default routes;
