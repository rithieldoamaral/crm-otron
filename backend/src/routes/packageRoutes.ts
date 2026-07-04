import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as PackageController from "../controllers/PackageController";

/**
 * Rotas de Pacotes de Sessões (Fase 6).
 *
 * Base: /packages
 *
 * Todas as rotas exigem autenticação (isAuth).
 * Escrita de templates (POST, PUT, DELETE) verificam admin internamente.
 *
 * IMPORTANTE: rotas estáticas (/purchases/...) vêm ANTES das dinâmicas (/:packageId)
 * para evitar conflito de params no Express.
 */
const packageRoutes = Router();

// ── Templates de Pacotes ──────────────────────────────────────────────────

// Listar templates
packageRoutes.get("/packages", isAuth, PackageController.index);

// Criar template (admin)
packageRoutes.post("/packages", isAuth, PackageController.store);

// Buscar template por ID
packageRoutes.get("/packages/:packageId", isAuth, PackageController.show);

// Atualizar template (admin)
packageRoutes.put("/packages/:packageId", isAuth, PackageController.update);

// Inativar template (admin)
packageRoutes.delete("/packages/:packageId", isAuth, PackageController.remove);

// ── Compras (ClientPackagePurchase) ──────────────────────────────────────

// Vender pacote para cliente
packageRoutes.post(
  "/packages/:packageId/purchase/:contactId",
  isAuth,
  PackageController.purchase
);

// Consumir uma sessão de uma compra
packageRoutes.post(
  "/packages/purchases/:purchaseId/consume",
  isAuth,
  PackageController.consumeOne
);

// Listar compras de um cliente
packageRoutes.get(
  "/packages/purchases/contact/:contactId",
  isAuth,
  PackageController.listPurchases
);

// Detalhe de uma compra
packageRoutes.get(
  "/packages/purchases/:purchaseId",
  isAuth,
  PackageController.showPurchase
);

export default packageRoutes;
