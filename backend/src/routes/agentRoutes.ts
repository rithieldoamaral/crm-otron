import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as AgentController from "../controllers/AgentController";

const agentRoutes = Router();

agentRoutes.post("/agent/models", isAuth, AgentController.listModels);
agentRoutes.post("/agent/sandbox", isAuth, AgentController.sandboxChat);

export default agentRoutes;
