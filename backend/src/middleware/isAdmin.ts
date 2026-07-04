import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import User from "../models/User";

/**
 * isAdmin — bloqueia rotas administrativas a usuários não-admin da empresa.
 *
 * Why: endpoints como criar/editar Services, configurar Working Hours,
 * conectar/desconectar Google Calendar de outros profissionais são operações
 * sensíveis que só o admin da empresa deve poder executar. Sem este check,
 * qualquer atendente poderia alterar configurações que afetam todos.
 *
 * How to apply: use depois de `isAuth` em rotas administrativas:
 *   router.post("/sensitive", isAuth, isAdmin, Controller.action);
 *
 * Note: "admin" aqui é o admin da empresa (User.profile === "admin"),
 * distinto de `isSuper` que é o super-admin da plataforma SaaS.
 */
const isAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const user = await User.findByPk(req.user.id);
  if (!user || user.profile !== "admin") {
    throw new AppError("Acesso negado. Apenas administradores.", 403);
  }
  return next();
};

export default isAdmin;
