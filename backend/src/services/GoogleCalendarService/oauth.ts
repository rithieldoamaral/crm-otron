/**
 * oauth — fluxo OAuth2 do Google Calendar.
 * Gera URL de autorização e processa o callback com code → tokens.
 */

import { google } from "googleapis";
import { encryptToken } from "./tokenCrypto";
import { signState, verifyState } from "./oauthState";
import UserCalendar from "../../models/UserCalendar";
import ProfessionalCalendar from "../../models/ProfessionalCalendar";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

const SCOPES = [
  CALENDAR_SCOPE,
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];

/**
 * Erro lançado quando o token devolvido pelo Google não inclui o scope de
 * calendário. Marker class para o controller distinguir desse erro genérico
 * e mandar mensagem específica ao frontend.
 *
 * Bug #21 (04/05/2026): observado quando o usuário desmarca a checkbox
 * "Google Calendar" na tela de consent (pensando que era seguro). O sistema
 * aceitava o token sem `auth/calendar`, salvava `isActive=true`, e tudo
 * relacionado a calendário começava a falhar com 403. Agora rejeitamos
 * antes de persistir.
 */
export class MissingCalendarScopeError extends Error {
  public readonly code = "MISSING_CALENDAR_SCOPE";
  constructor(grantedScope: string) {
    super(
      `O Google não autorizou acesso ao Calendário (scope auth/calendar ausente). ` +
      `Permissões concedidas: "${grantedScope || "(nenhuma)"}". ` +
      `Reconecte e marque TODAS as permissões na tela do Google.`
    );
  }
}

/**
 * Verifica se o scope retornado pelo Google contém auth/calendar. Aceita
 * a URL completa (forma padrão da Google) ou o sufixo "auth/calendar".
 */
function hasCalendarScope(scopeString: string | undefined | null): boolean {
  if (!scopeString) return false;
  const parts = scopeString.split(/\s+/);
  return parts.some(s => s === CALENDAR_SCOPE || s.endsWith("/auth/calendar"));
}

function buildClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Gera a URL de autorização OAuth2 do Google.
 *
 * Para platform users: passar userId (número).
 * Para CalendarProfessionals (sem conta CRM): passar professionalId.
 *
 * O state é assinado via HMAC — impede que atacantes forjem userId/companyId.
 */
export function getAuthorizationUrl(
  userId: number | null,
  companyId: number,
  professionalId?: number
): string {
  const client = buildClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: signState(
      professionalId != null
        ? { professionalId, companyId }
        : { userId: userId!, companyId }
    )
  });
}

/**
 * Processa o callback OAuth2: troca o code por tokens e salva na tabela correta.
 * - Platform users → UserCalendars
 * - CalendarProfessionals → ProfessionalCalendars
 * Tokens são encriptados com AES-256 antes de persistir.
 */
export async function handleOAuthCallback(code: string, state: string): Promise<void> {
  // verifyState lança se o state foi adulterado ou não tem assinatura válida
  const { userId, professionalId, companyId } = verifyState(state);

  const client = buildClient();
  const { tokens } = await client.getToken(code);

  // GUARDA CRÍTICA: rejeitar token sem scope de calendário ANTES de qualquer
  // outra operação. Salvar um token sem auth/calendar é o pior dos mundos:
  // o frontend mostra "Conectado" mas tudo relacionado a calendário falha.
  if (!hasCalendarScope(tokens.scope)) {
    throw new MissingCalendarScopeError(tokens.scope ?? "");
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();

  const encryptedAccess = encryptToken(tokens.access_token!);
  const tokenExpiry = new Date(tokens.expiry_date!);
  const googleAccountEmail = profile.email ?? "";

  if (professionalId != null) {
    // Standalone professional (sem conta CRM) → ProfessionalCalendars
    const existing = await ProfessionalCalendar.findOne({ where: { professionalId, companyId } });
    const payload: any = {
      professionalId, companyId,
      googleAccountEmail, calendarId: googleAccountEmail,
      accessToken: encryptedAccess, tokenExpiry, isActive: true
    };
    if (tokens.refresh_token) {
      payload.refreshToken = encryptToken(tokens.refresh_token);
    } else if (!existing?.refreshToken) {
      throw new Error("Google did not return a refresh_token. Revoke access at myaccount.google.com/permissions and try again.");
    }
    if (existing) await existing.update(payload);
    else await ProfessionalCalendar.create(payload);
  } else {
    // Platform user → UserCalendars (fluxo original)
    const existing = await UserCalendar.findOne({ where: { userId: userId!, companyId } });
    const payload: any = {
      userId: userId!, companyId,
      googleAccountEmail, calendarId: googleAccountEmail,
      accessToken: encryptedAccess, tokenExpiry, isActive: true
    };
    if (tokens.refresh_token) {
      payload.refreshToken = encryptToken(tokens.refresh_token);
    } else if (!existing?.refreshToken) {
      throw new Error("Google did not return a refresh_token. Revoke access at myaccount.google.com/permissions and try again.");
    }
    if (existing) await existing.update(payload);
    else await UserCalendar.create(payload);
  }
}

/**
 * Desconecta o Google Calendar de um platform user.
 * Marca como inativo E apaga tokens — menor retenção de dados (LGPD).
 */
export async function disconnectCalendar(userId: number, companyId: number): Promise<void> {
  await UserCalendar.update(
    { isActive: false, accessToken: "", refreshToken: "", tokenExpiry: new Date(0) },
    { where: { userId, companyId } }
  );
}

/**
 * Desconecta o Google Calendar de um CalendarProfessional (sem conta CRM).
 * Mesma política de retenção que disconnectCalendar.
 */
export async function disconnectProfessionalCalendar(
  professionalId: number,
  companyId: number
): Promise<void> {
  await ProfessionalCalendar.update(
    { isActive: false, accessToken: "", refreshToken: "", tokenExpiry: new Date(0) },
    { where: { professionalId, companyId } }
  );
}
