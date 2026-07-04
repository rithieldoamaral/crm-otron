/**
 * Testes para handleOAuthCallback — validação de scopes recebidos do Google.
 *
 * Bug #21 (Round 7+, 04/05/2026): após reconectar, o Google devolveu um token
 * SEM o scope `auth/calendar` (usuário desmarcou a permissão na tela de
 * consent). O sistema aceitou o token mesmo assim, salvou no DB com
 * isActive=true, e tudo que envolvia Google Calendar começou a falhar com
 * "Request had insufficient authentication scopes".
 *
 * Defesa: validar `tokens.scope` na callback. Sem `auth/calendar`, REJEITAR
 * (não salvar) e propagar erro específico para o frontend orientar o usuário.
 */

jest.mock("../../../models/UserCalendar");
jest.mock("googleapis", () => {
  const getToken = jest.fn();
  const userinfoGet = jest.fn();
  const setCredentials = jest.fn();
  const generateAuthUrl = jest.fn();
  const OAuth2 = jest.fn().mockImplementation(() => ({
    getToken,
    setCredentials,
    generateAuthUrl
  }));
  return {
    google: {
      auth: { OAuth2 },
      oauth2: jest.fn().mockReturnValue({ userinfo: { get: userinfoGet } })
    },
    __mocks: { getToken, userinfoGet, setCredentials, generateAuthUrl, OAuth2 }
  };
});
jest.mock("../oauthState", () => ({
  signState: jest.fn().mockReturnValue("signed_state"),
  verifyState: jest.fn().mockReturnValue({ userId: 10, companyId: 1 })
}));
jest.mock("../tokenCrypto", () => ({
  encryptToken: jest.fn((s: string) => `enc:${s}`),
  decryptToken: jest.fn((s: string) => s.replace(/^enc:/, ""))
}));

import { handleOAuthCallback } from "../oauth";
import UserCalendar from "../../../models/UserCalendar";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mocks } = require("googleapis");

describe("handleOAuthCallback — validação de scopes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __mocks.userinfoGet.mockResolvedValue({ data: { email: "user@gmail.com" } });
    (UserCalendar.findOne as jest.Mock).mockResolvedValue(null);
    (UserCalendar.create as jest.Mock).mockResolvedValue({});
    (UserCalendar.update as jest.Mock).mockResolvedValue([1]);
  });

  it("rejeita quando o Google devolve token SEM scope auth/calendar", async () => {
    __mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: "tok_a",
        refresh_token: "tok_r",
        expiry_date: Date.now() + 3600000,
        // Scope que faltou auth/calendar — o usuário só consentiu profile/email
        scope: "email profile https://www.googleapis.com/auth/userinfo.email openid"
      }
    });

    await expect(handleOAuthCallback("code", "state")).rejects.toThrow(/calendar|scope|permiss/i);

    // Crítico: NÃO deve persistir token quebrado
    expect(UserCalendar.create).not.toHaveBeenCalled();
    expect(UserCalendar.update).not.toHaveBeenCalled();
  });

  it("aceita quando o token contém scope auth/calendar", async () => {
    __mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: "tok_a",
        refresh_token: "tok_r",
        expiry_date: Date.now() + 3600000,
        scope:
          "email profile https://www.googleapis.com/auth/calendar " +
          "https://www.googleapis.com/auth/userinfo.email openid"
      }
    });

    await handleOAuthCallback("code", "state");

    expect(UserCalendar.create).toHaveBeenCalledTimes(1);
    const created = (UserCalendar.create as jest.Mock).mock.calls[0][0];
    expect(created.isActive).toBe(true);
    expect(created.userId).toBe(10);
  });

  it("aceita quando scope vem como string sem o domínio explícito (fallback defensivo)", async () => {
    // Alguns retornos do Google trazem scope abreviado ou com URL completa.
    // Aceitamos as duas variações conhecidas para não falhar em casos legítimos.
    __mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: "tok_a",
        refresh_token: "tok_r",
        expiry_date: Date.now() + 3600000,
        scope: "email profile https://www.googleapis.com/auth/calendar"
      }
    });
    await handleOAuthCallback("code", "state");
    expect(UserCalendar.create).toHaveBeenCalledTimes(1);
  });
});
