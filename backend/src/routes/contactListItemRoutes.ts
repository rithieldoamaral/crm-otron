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

import * as ContactListItemController from "../controllers/ContactListItemController";

const routes = express.Router();

routes.get(
  "/contact-list-items/list",
  isAuth, isSuper,
  ContactListItemController.findList
);

routes.get("/contact-list-items", isAuth, isSuper, ContactListItemController.index);

routes.get("/contact-list-items/:id", isAuth, isSuper, ContactListItemController.show);

routes.post("/contact-list-items", isAuth, isSuper, ContactListItemController.store);

routes.put("/contact-list-items/:id", isAuth, isSuper, ContactListItemController.update);

routes.delete(
  "/contact-list-items/:id",
  isAuth, isSuper,
  ContactListItemController.remove
);

export default routes;
