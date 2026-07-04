import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as GlobalSettingsController from "../controllers/GlobalSettingsController";

/**
 * Rotas de configurações globais da plataforma.
 *
 * Base: /global-settings
 *
 * Ambas as rotas requerem isAuth + isSuper (super admin da plataforma).
 * O guard é aplicado via middleware de rota — sem verificação duplicada no controller.
 */
const globalSettingsRoutes = Router();

globalSettingsRoutes.get("/global-settings", isAuth, isSuper, GlobalSettingsController.index);
globalSettingsRoutes.put("/global-settings", isAuth, isSuper, GlobalSettingsController.update);

export default globalSettingsRoutes;
