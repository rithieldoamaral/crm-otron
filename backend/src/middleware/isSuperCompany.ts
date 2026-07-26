import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import User from "../models/User";

/**
 * Restringe rotas autenticadas por TOKEN de conexão (tokenAuth) ao super admin.
 *
 * POR QUE EXISTE (2026-07-26): o middleware `isSuper` padrão lê `req.user.id`,
 * que só existe em rotas autenticadas por JWT. A API externa de envio
 * (`/api/messages/send`) autentica pelo token da conexão WhatsApp — não há
 * usuário na request. Sem este gate, esconder a aba "Avançado" no frontend
 * seria puramente cosmético: qualquer cliente de posse do token continuaria
 * disparando mensagens em massa, que é o principal vetor de banimento
 * enquanto operamos via Baileys (API não-oficial).
 *
 * A identidade é resolvida por: token → Whatsapp → companyId → a empresa tem
 * algum usuário super admin? Só a empresa do dono da plataforma tem — por isso
 * o teste identifica corretamente "conexão do dono" vs "conexão de cliente".
 *
 * DEVE rodar DEPOIS de tokenAuth, que é quem injeta `whatsappId` em req.params.
 *
 * @param req - Request Express (espera req.params.whatsappId preenchido)
 * @throws AppError 401 se a conexão não existir ou não pertencer ao super admin
 */
const isSuperCompany = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const { whatsappId } = req.params;

  if (!whatsappId) {
    throw new AppError("Acesso não permitido", 401);
  }

  const whatsapp = await Whatsapp.findByPk(whatsappId);

  if (!whatsapp) {
    throw new AppError("Acesso não permitido", 401);
  }

  const superUser = await User.findOne({
    where: { companyId: whatsapp.companyId, super: true }
  });

  if (!superUser) {
    throw new AppError("Acesso não permitido", 401);
  }

  return next();
};

export default isSuperCompany;
