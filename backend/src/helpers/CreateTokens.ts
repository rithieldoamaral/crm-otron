import { sign, SignOptions } from "jsonwebtoken";
import authConfig from "../config/auth";
import User from "../models/User";

export const createAccessToken = (user: User): string => {
  const { secret, expiresIn } = authConfig;

  return sign(
    {
      usarname: user.name,
      profile: user.profile,
      id: user.id,
      companyId: user.companyId
    },
    secret,
    {
      // SEGURANÇA (jsonwebtoken 9): expiresIn agora é tipado como
      // `number | StringValue` (template literal), mas o valor real
      // (ex.: "15m") vem de env var e é `string` genérico em runtime —
      // o cast só ajusta a checagem estática, sem mudar o comportamento.
      expiresIn: expiresIn as SignOptions["expiresIn"]
    }
  );
};

export const createRefreshToken = (user: User): string => {
  const { refreshSecret, refreshExpiresIn } = authConfig;

  return sign(
    { id: user.id, tokenVersion: user.tokenVersion, companyId: user.companyId },
    refreshSecret,
    {
      expiresIn: refreshExpiresIn as SignOptions["expiresIn"]
    }
  );
};
