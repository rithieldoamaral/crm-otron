import express from "express";
import isAuth from "../middleware/isAuth";
import * as RetentionController from "../controllers/RetentionController";

const retentionRoutes = express.Router();

/** Lista contatos que precisam de atenção (atrasado, adormecido, perdido) */
retentionRoutes.get("/retention/dormant", isAuth, RetentionController.listDormant);

/** Estatísticas do fluxo de aniversário inteligente */
retentionRoutes.get("/retention/birthday-stats", isAuth, RetentionController.getBirthdayStats);

/** Estatísticas do lembrete preventivo (Fase 3A) */
retentionRoutes.get("/retention/preventive-stats", isAuth, RetentionController.getPreventiveStats);

/** Estatísticas do programa de fidelidade (Fase 3B) */
retentionRoutes.get("/retention/loyalty-stats", isAuth, RetentionController.getLoyaltyStats);

/** Estatísticas do win-back (Fase 3C) */
retentionRoutes.get("/retention/winback-stats", isAuth, RetentionController.getWinbackStats);

/** RFM individual de um contato (Fase 4A) */
retentionRoutes.get("/retention/rfm/:contactId", isAuth, RetentionController.getContactRFM);

/** Distribuição da base por segmento RFM (Fase 4A) */
retentionRoutes.get("/retention/rfm-segments", isAuth, RetentionController.getRFMSegments);

/** Pares de serviços frequentemente comprados juntos (Fase 4B) */
retentionRoutes.get("/retention/cross-sell/pairs", isAuth, RetentionController.getCrossSellPairs);

/** Sugestões de cross-sell para um contato (Fase 4B) */
retentionRoutes.get("/retention/cross-sell/:contactId", isAuth, RetentionController.getContactCrossSell);

/** Código de indicação do contato (Fase 4C) */
retentionRoutes.get("/retention/referral/:contactId/code", isAuth, RetentionController.getReferralCode);

/** Lista indicações feitas pelo contato (Fase 4C) */
retentionRoutes.get("/retention/referral/:contactId/list", isAuth, RetentionController.getReferralsList);

/** Estatísticas agregadas do programa de indicação (Fase 4C) */
retentionRoutes.get("/retention/referral-stats", isAuth, RetentionController.getReferralStats);

/** Registra nova indicação (Fase 4C) */
retentionRoutes.post("/retention/referral/register", isAuth, RetentionController.postRegisterReferral);

/** Sumário agregado para cards de dashboard */
retentionRoutes.get("/retention/summary", isAuth, RetentionController.getSummary);

/** Perfil completo de retenção de um contato */
retentionRoutes.get("/contacts/:contactId/retention", isAuth, RetentionController.getContactRetention);

/** Gera cupom de reativação para contato dormente (admin) */
retentionRoutes.post("/retention/:contactId/coupon", isAuth, RetentionController.generateReactivationCoupon);

export default retentionRoutes;
