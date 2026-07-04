/**
 * systemLogRoutes — rotas de auditoria (superadmin only).
 *
 * Dupla proteção: isAuth (token válido) + isSuper (flag super = true).
 * Nenhuma rota de escrita exposta — logs são criados internamente via dbLogger.
 */

import express from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as SystemLogController from "../controllers/SystemLogController";

const systemLogRoutes = express.Router();

systemLogRoutes.get("/logs", isAuth, isSuper, SystemLogController.index);

export default systemLogRoutes;
