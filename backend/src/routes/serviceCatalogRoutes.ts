import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as ServiceCatalogController from "../controllers/ServiceCatalogController";

/**
 * Rotas do Catálogo de Serviços (Fase 5).
 *
 * Base: /service-catalog
 *
 * Todas as rotas exigem autenticação (isAuth).
 * Operações de escrita (POST, PUT, DELETE) verificam perfil admin internamente.
 */
const serviceCatalogRoutes = Router();

// Listar serviços (todos os perfis autenticados)
serviceCatalogRoutes.get(
  "/service-catalog",
  isAuth,
  ServiceCatalogController.index
);

// Criar serviço (admin only — verificado no controller)
serviceCatalogRoutes.post(
  "/service-catalog",
  isAuth,
  ServiceCatalogController.store
);

// Buscar serviço por ID
serviceCatalogRoutes.get(
  "/service-catalog/:serviceId",
  isAuth,
  ServiceCatalogController.show
);

// Atualizar serviço (admin only — verificado no controller)
serviceCatalogRoutes.put(
  "/service-catalog/:serviceId",
  isAuth,
  ServiceCatalogController.update
);

// Remover serviço (admin only — verificado no controller)
serviceCatalogRoutes.delete(
  "/service-catalog/:serviceId",
  isAuth,
  ServiceCatalogController.remove
);

export default serviceCatalogRoutes;
