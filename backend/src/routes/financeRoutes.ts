import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as FinanceController from "../controllers/FinanceController";

/**
 * Rotas do Módulo Financeiro Analytics (Fase 7).
 *
 * Base: /finance
 * Todas as rotas requerem autenticação (isAuth).
 * companyId sempre extraído do JWT — nunca do body.
 */
const financeRoutes = Router();

// KPIs: receita total, ticket médio, crescimento vs período anterior
financeRoutes.get("/finance/summary", isAuth, FinanceController.summary);

// Receita por dia (gráfico de linha)
financeRoutes.get("/finance/revenue-by-day", isAuth, FinanceController.byDay);

// Receita por dia da semana (gráfico de barras)
financeRoutes.get("/finance/revenue-by-weekday", isAuth, FinanceController.byWeekday);

// Top clientes por receita
financeRoutes.get("/finance/top-clients", isAuth, FinanceController.topClients);

// Top serviços por receita
financeRoutes.get("/finance/top-services", isAuth, FinanceController.topServices);

export default financeRoutes;
