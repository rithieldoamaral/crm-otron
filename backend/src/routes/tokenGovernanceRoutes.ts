import express from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import * as TokenGovernanceController from "../controllers/TokenGovernanceController";

/**
 * Rotas do módulo de governança de tokens.
 *
 * SEGURANÇA (CLAUDE.md XV.1 e XV.3): TODAS exigem `isSuper`. Consumo e custo
 * por empresa são dados comerciais sensíveis — um cliente não pode ver o de
 * outro, nem o próprio custo bruto, que revelaria a margem da plataforma.
 *
 * Esconder a aba no frontend é UX. O gate real é este middleware: sem ele,
 * qualquer JWT válido leria /token-governance/overview via curl.
 */
const tokenGovernanceRoutes = express.Router();

tokenGovernanceRoutes.get(
  "/token-governance/overview",
  isAuth,
  isSuper,
  TokenGovernanceController.overview
);

tokenGovernanceRoutes.get(
  "/token-governance/by-model",
  isAuth,
  isSuper,
  TokenGovernanceController.byModel
);

tokenGovernanceRoutes.get(
  "/token-governance/series",
  isAuth,
  isSuper,
  TokenGovernanceController.series
);

tokenGovernanceRoutes.get(
  "/token-governance/credits/:companyId",
  isAuth,
  isSuper,
  TokenGovernanceController.credits
);

tokenGovernanceRoutes.post(
  "/token-governance/credits/:companyId",
  isAuth,
  isSuper,
  TokenGovernanceController.addCredit
);

tokenGovernanceRoutes.get(
  "/token-governance/prices",
  isAuth,
  isSuper,
  TokenGovernanceController.listPrices
);

tokenGovernanceRoutes.put(
  "/token-governance/prices",
  isAuth,
  isSuper,
  TokenGovernanceController.upsertPrice
);

export default tokenGovernanceRoutes;
