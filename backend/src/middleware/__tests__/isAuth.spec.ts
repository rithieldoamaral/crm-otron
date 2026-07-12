import { Request, Response } from "express";
import { sign } from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import isAuth from "../isAuth";
import authConfig from "../../config/auth";

jest.mock("@sentry/node", () => ({
  setTag: jest.fn()
}));

// Evita que config/auth.ts (módulo real) lance "JWT_SECRET must be defined"
// quando a suíte roda sem .env carregado — mock isola o teste dessa dependência.
jest.mock("../../config/auth", () => ({
  __esModule: true,
  default: {
    secret: "test-secret",
    expiresIn: "15m",
    refreshSecret: "test-refresh-secret",
    refreshExpiresIn: "7d"
  }
}));

describe("isAuth middleware", () => {
  const mockSetTag = Sentry.setTag as jest.Mock;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { headers: {} };
    res = {};
    next = jest.fn();
  });

  const buildToken = (payload: object): string =>
    sign(payload, authConfig.secret, { expiresIn: "1h" });

  it("marca o erro reportado (Sentry) com companyId e userId do token decodificado", () => {
    const token = buildToken({ id: "42", profile: "admin", companyId: 7 });
    req.headers = { authorization: `Bearer ${token}` };

    isAuth(req as Request, res as Response, next);

    expect(mockSetTag).toHaveBeenCalledWith("companyId", "7");
    expect(mockSetTag).toHaveBeenCalledWith("userId", "42");
    expect(next).toHaveBeenCalled();
  });

  it("não marca nada e propaga erro quando o token é inválido", () => {
    req.headers = { authorization: "Bearer token-invalido" };

    expect(() => isAuth(req as Request, res as Response, next)).toThrow(
      "Invalid token. We'll try to assign a new one on next request"
    );
    expect(mockSetTag).not.toHaveBeenCalled();
  });

  it("não marca nada e propaga erro quando não há header de autorização", () => {
    expect(() => isAuth(req as Request, res as Response, next)).toThrow(
      "ERR_SESSION_EXPIRED"
    );
    expect(mockSetTag).not.toHaveBeenCalled();
  });
});
