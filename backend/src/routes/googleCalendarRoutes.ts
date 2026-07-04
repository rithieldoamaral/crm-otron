import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import * as GoogleCalendarController from "../controllers/GoogleCalendarController";

const googleCalendarRoutes = Router();

/*
 * Permissões:
 * - GETs (leitura): isAuth — agentes IA e atendentes precisam consultar status/serviços.
 * - POST/PUT/DELETE (mutações de config): isAuth + isAdmin — só admin da empresa.
 * - OAuth callback: sem auth (Google é quem chama).
 * - auth-url: isAuth — usuário pode iniciar próprio OAuth.
 */

// OAuth
googleCalendarRoutes.get("/google-calendar/auth-url", isAuth, GoogleCalendarController.getAuthUrl);
googleCalendarRoutes.get("/google-calendar/oauth-callback", GoogleCalendarController.oauthCallback); // no auth — Google redirects here
googleCalendarRoutes.delete("/google-calendar/disconnect/:userId", isAuth, isAdmin, GoogleCalendarController.disconnectUser);
googleCalendarRoutes.get("/google-calendar/status", isAuth, GoogleCalendarController.getConnectionStatus);

// Services CRUD — mutações requerem admin
googleCalendarRoutes.get("/google-calendar/services", isAuth, GoogleCalendarController.listServices);
googleCalendarRoutes.post("/google-calendar/services", isAuth, isAdmin, GoogleCalendarController.createService);
googleCalendarRoutes.put("/google-calendar/services/:id", isAuth, isAdmin, GoogleCalendarController.updateService);
googleCalendarRoutes.delete("/google-calendar/services/:id", isAuth, isAdmin, GoogleCalendarController.deleteService);

// Working hours — leitura aberta, escrita só admin
// ?type=professional para CalendarProfessionals (sem conta CRM)
googleCalendarRoutes.get("/google-calendar/working-hours/:userId", isAuth, GoogleCalendarController.getWorkingHours);
googleCalendarRoutes.put("/google-calendar/working-hours/:userId", isAuth, isAdmin, GoogleCalendarController.saveWorkingHours);

// CalendarProfessionals CRUD — profissionais sem conta CRM
googleCalendarRoutes.get("/google-calendar/professionals", isAuth, GoogleCalendarController.listProfessionals);
googleCalendarRoutes.post("/google-calendar/professionals", isAuth, isAdmin, GoogleCalendarController.createProfessional);
googleCalendarRoutes.put("/google-calendar/professionals/:id", isAuth, isAdmin, GoogleCalendarController.updateProfessional);
googleCalendarRoutes.delete("/google-calendar/professionals/:id", isAuth, isAdmin, GoogleCalendarController.deleteProfessional);

// Rename — endpoint unificado para users CRM e professionals autônomos
// Usa companyId do JWT exclusivamente (sem risco de cross-company)
googleCalendarRoutes.put("/google-calendar/rename/:id", isAuth, isAdmin, GoogleCalendarController.renameProfessional);

export default googleCalendarRoutes;
