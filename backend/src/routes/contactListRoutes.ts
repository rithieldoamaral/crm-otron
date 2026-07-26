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
import uploadConfig from "../config/upload";

import * as ContactListController from "../controllers/ContactListController";
import multer from "multer";

const routes = express.Router();

const upload = multer(uploadConfig);

routes.get("/contact-lists/list", isAuth, isSuper, ContactListController.findList);

routes.get("/contact-lists", isAuth, isSuper, ContactListController.index);

routes.get("/contact-lists/:id", isAuth, isSuper, ContactListController.show);

routes.post("/contact-lists", isAuth, isSuper, ContactListController.store);

routes.post(
  "/contact-lists/:id/upload",
  isAuth, isSuper,
  upload.array("file"),
  ContactListController.upload
);

routes.put("/contact-lists/:id", isAuth, isSuper, ContactListController.update);

routes.delete("/contact-lists/:id", isAuth, isSuper, ContactListController.remove);

export default routes;
