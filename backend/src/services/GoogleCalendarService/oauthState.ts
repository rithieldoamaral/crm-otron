/**
 * oauthState — assinatura HMAC do parâmetro `state` do OAuth2.
 *
 * Why: o state do OAuth identifica o usuário+empresa que iniciaram o fluxo.
 * Sem assinatura, um atacante pode forjar um state apontando para userId/companyId
 * de outra empresa e injetar seus tokens Google na conta da vítima.
 *
 * Formato: `<base64url(payload)>.<hex(hmacSha256)>`
 *
 * How to apply: `signState` na geração da URL, `verifyState` no callback.
 * Lança Error se a assinatura for inválida.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface OAuthStatePayload {
  /** Platform user ID (CRM account). Mutually exclusive with professionalId. */
  userId?: number;
  /** CalendarProfessional ID (standalone professional without CRM account). */
  professionalId?: number;
  companyId: number;
}

function getSecret(): string {
  const secret = process.env.CALENDAR_TOKEN_SECRET;
  if (!secret) {
    // Falha explícita em runtime se a secret não está definida — preferível
    // a silently assinar com string vazia (bypass trivial).
    throw new Error("CALENDAR_TOKEN_SECRET env var is required for OAuth state signing");
  }
  return secret;
}

function hmac(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("hex");
}

export function signState(payload: OAuthStatePayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encoded);
  return `${encoded}.${signature}`;
}

export function verifyState(state: string | null | undefined): OAuthStatePayload {
  if (!state || typeof state !== "string") {
    throw new Error("Missing state parameter");
  }
  const parts = state.split(".");
  if (parts.length !== 2) {
    throw new Error("Malformed state parameter (expected payload.signature)");
  }
  const [encoded, signature] = parts;
  const expectedSig = hmac(encoded);

  // timingSafeEqual evita timing attacks na comparação da assinatura
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid state signature");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return payload as OAuthStatePayload;
}
