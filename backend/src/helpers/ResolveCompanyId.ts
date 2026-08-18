import { Request } from "express";
import AppError from "../errors/AppError";
import User from "../models/User";
import { logger } from "../utils/logger";

/**
 * Resolve com segurança qual empresa uma requisição pode consultar.
 *
 * REGRA (CLAUDE.md XV.3): a identidade do tenant vem da SESSÃO. O valor
 * enviado pelo cliente só é aceito quando o usuário é super admin — e,
 * mesmo assim, é validado.
 *
 * Motivo: três controllers deixavam o `companyId` da query string vencer
 * o da sessão, então qualquer usuário autenticado lia dados de outra
 * empresa trocando o parâmetro. Estar logado (autenticação) não é ter
 * direito ao recurso (autorização).
 *
 * O acesso entre empresas continua existindo porque é usado de verdade:
 * o painel de super admin (CompaniesManager) lista usuários de uma
 * empresa específica. O que muda é que agora ele é verificado.
 *
 * @param req - Request autenticado (req.user preenchido por `isAuth`)
 * @param requested - companyId pedido pelo cliente (query/body), se houver
 * @returns O companyId que a requisição pode legitimamente consultar
 * @throws {AppError} ERR_INVALID_COMPANY_ID (400) se não for número válido
 * @throws {AppError} ERR_NO_PERMISSION (403) se pedir outra empresa sem ser super
 *
 * @example
 * // Controller que aceita filtro opcional por empresa:
 * const companyId = await resolveCompanyId(req, req.query.companyId);
 * const users = await SimpleListService({ companyId });
 */
const resolveCompanyId = async (
  req: Request,
  requested?: string | number | null
): Promise<number> => {
  const sessionCompanyId = Number(req.user.companyId);

  // Nada pedido: usa a empresa da sessão. Caminho mais comum, sem custo
  // de consulta ao banco.
  if (requested === undefined || requested === null || requested === "") {
    return sessionCompanyId;
  }

  const requestedId = Number(requested);

  // `Number("1 OR 1=1--")` é NaN. Sem esta checagem o NaN seguiria adiante
  // e viraria erro obscuro no banco em vez de 400 claro para o cliente.
  if (!Number.isInteger(requestedId) || requestedId <= 0) {
    throw new AppError("ERR_INVALID_COMPANY_ID", 400);
  }

  // Pediu a própria empresa: liberado sem consultar o banco.
  if (requestedId === sessionCompanyId) {
    return sessionCompanyId;
  }

  // Pediu OUTRA empresa: só super admin. A flag vem do banco, nunca do
  // token — token é dado sob controle do cliente (XV.2).
  const user = await User.findByPk(req.user.id);

  if (!user || !user.super) {
    // Tentativa de acesso cruzado é evento de segurança: logar com
    // contexto suficiente para investigar (CLAUDE.md II.5 — nada de
    // catch silencioso, e V.2 — nível apropriado).
    logger.warn({
      fn: "resolveCompanyId",
      userId: req.user.id,
      sessionCompanyId,
      requestedCompanyId: requestedId,
      msg: "Tentativa de acesso a dados de outra empresa negada"
    });

    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  return requestedId;
};

export default resolveCompanyId;
