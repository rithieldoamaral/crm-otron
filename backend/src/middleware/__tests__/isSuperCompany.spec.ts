/**
 * Testes TDD para isSuperCompany — escritos ANTES da implementação
 * conforme CLAUDE.md seção II.1.
 *
 * Contexto (2026-07-26): /api/messages/send autentica por TOKEN da conexão
 * WhatsApp (tokenAuth), não por JWT de usuário — logo `req.user` não existe e
 * o middleware `isSuper` padrão não se aplica. Este middleware resolve a
 * identidade pelo caminho token → Whatsapp → companyId → existe super admin?
 */

import { Request, Response, NextFunction } from "express";

jest.mock("../../models/Whatsapp", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));
jest.mock("../../models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";
import isSuperCompany from "../isSuperCompany";

// AppError NAO estende Error, entao .rejects.toThrow() nao o reconhece.
// Asserimos a forma do objeto — de quebra valida o statusCode 401.

const mockWhatsappFind = Whatsapp.findByPk as jest.Mock;
const mockUserFindOne = User.findOne as jest.Mock;

describe("isSuperCompany middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    // tokenAuth injeta whatsappId em req.params antes deste middleware rodar
    req = { params: { whatsappId: "7" } };
    res = {};
    next = jest.fn();
  });

  it("permite quando a conexão pertence a uma empresa que tem super admin", async () => {
    mockWhatsappFind.mockResolvedValue({ id: 7, companyId: 1 });
    mockUserFindOne.mockResolvedValue({ id: 42, super: true });

    await isSuperCompany(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(mockUserFindOne).toHaveBeenCalledWith({
      where: { companyId: 1, super: true }
    });
  });

  it("bloqueia quando a empresa da conexão NÃO tem super admin (cliente comum)", async () => {
    mockWhatsappFind.mockResolvedValue({ id: 7, companyId: 2 });
    mockUserFindOne.mockResolvedValue(null);

    await expect(
      isSuperCompany(req as Request, res as Response, next)
    ).rejects.toMatchObject({ message: "Acesso não permitido", statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });

  it("bloqueia quando a conexão não existe", async () => {
    mockWhatsappFind.mockResolvedValue(null);

    await expect(
      isSuperCompany(req as Request, res as Response, next)
    ).rejects.toMatchObject({ message: "Acesso não permitido", statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });

  it("bloqueia quando whatsappId não foi resolvido por tokenAuth", async () => {
    req.params = {};

    await expect(
      isSuperCompany(req as Request, res as Response, next)
    ).rejects.toMatchObject({ message: "Acesso não permitido", statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
    // Não deve nem consultar o banco sem identificar a conexão
    expect(mockWhatsappFind).not.toHaveBeenCalled();
  });
});
