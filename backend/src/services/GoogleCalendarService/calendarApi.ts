/**
 * calendarApi — wrapper da Google Calendar API.
 * Centraliza autenticação OAuth2, refresh de tokens e chamadas à API.
 * Tokens são descriptografados antes do uso e NUNCA logados.
 */

import { google } from "googleapis";
import { decryptToken, encryptToken } from "./tokenCrypto";
import { BusyPeriod } from "./availabilityEngine";
import UserCalendar from "../../models/UserCalendar";
import { logger } from "../../utils/logger";

interface CalendarCredentials {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date;
  calendarId: string;
  /**
   * Opcional: quando presente, tokens refreshados são persistidos no DB.
   * Aceita tanto `userCalendarId` (legado) quanto `id` (campo nativo do
   * Sequelize model UserCalendar) — as tools chamadoras passam o objeto
   * UserCalendar inteiro, que tem `id`. Sem essa flexibilidade, o handler
   * de tokens nunca persistia (Bug #19, Round 7).
   */
  userCalendarId?: number;
  id?: number;
}

interface CreateEventInput {
  calendarId: string;
  credentials: CalendarCredentials;
  summary: string;
  description: string;
  startDateTime: string; // ISO 8601
  endDateTime: string;   // ISO 8601
}

interface DeleteEventInput {
  calendarId: string;
  credentials: CalendarCredentials;
  eventId: string;
}

interface FreeBusyInput {
  calendarId: string;
  credentials: CalendarCredentials;
  date: string; // "YYYY-MM-DD"
}

/**
 * Detecta se um erro do Google indica que a conexão do calendário entrou em
 * estado inválido PERMANENTE — refresh_token revogado/expirado (`invalid_grant`)
 * ou token sem o scope de calendário (`insufficient authentication scopes`).
 *
 * PORQUÊ: só nesses casos faz sentido marcar `UserCalendar.isActive=false` — o
 * token não reativa sozinho e a UI precisa mostrar "Desconectado" para forçar
 * reconexão. Erros transitórios (quota, rede, 5xx) NÃO entram aqui: são
 * temporários e invalidar a conexão geraria falso-desconectado.
 *
 * Espelha exatamente os gatilhos de `traduzirErroGoogleCalendar` (criarEvento.ts)
 * que setam `invalidarConexao: true`, mantendo a semântica consistente entre as
 * tools.
 *
 * @param err - Erro capturado de uma chamada à Google Calendar API.
 * @returns `true` se a conexão deve ser invalidada; `false` caso contrário.
 *
 * @example
 * isCalendarConnectionInvalid(new Error("invalid_grant")); // true
 * isCalendarConnectionInvalid(new Error("quota exceeded")); // false
 */
export function isCalendarConnectionInvalid(err: any): boolean {
  const raw: string = (err?.message ?? "").toString().toLowerCase();
  return (
    raw.includes("invalid_grant") ||
    raw.includes("insufficient authentication scopes")
  );
}

/**
 * Executa uma chamada à Google Calendar API e, se o erro indicar conexão
 * inválida permanente, marca o `UserCalendar` como `isActive=false` antes de
 * repropagar o erro.
 *
 * PORQUÊ: antes, só `criarEvento` invalidava a conexão em token morto. As demais
 * tools (verificarDisponibilidade, buscarProximoHorario, cancelarEvento,
 * reagendarEvento) falhavam em silêncio e a UI seguia mostrando "Conectado"
 * verde. Este wrapper centraliza (DRY) a detecção + invalidação para qualquer
 * chamada à API.
 *
 * O erro é SEMPRE repropagado — o caller decide o fallback (fail-open, mensagem
 * ao cliente, etc.). Este helper apenas garante o efeito colateral de
 * invalidação e o log estruturado.
 *
 * @param fn - Função que executa a chamada à API e resolve com o resultado.
 * @param userCalendarId - ID do UserCalendar a invalidar em caso de token morto.
 *   Se ausente/undefined, apenas loga (não há registro para atualizar).
 * @param context - Rótulo da tool chamadora para os logs (ex.: "verificar_disponibilidade").
 * @returns O resultado de `fn` em caso de sucesso.
 * @throws Repropaga qualquer erro lançado por `fn`.
 */
export async function executeWithCalendarErrorHandling<T>(
  fn: () => Promise<T>,
  userCalendarId: number | undefined,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (isCalendarConnectionInvalid(err)) {
      if (userCalendarId) {
        try {
          await UserCalendar.update(
            { isActive: false } as any,
            { where: { id: userCalendarId } }
          );
          logger.warn(
            `[${context}] UserCalendar #${userCalendarId} marcado isActive=false ` +
            `devido a token inválido (${(err?.message ?? "").toString().slice(0, 80)})`
          );
        } catch (updateErr: any) {
          logger.error(
            `[${context}] falha ao marcar isActive=false | userCalendar=${userCalendarId}: ${updateErr?.message}`
          );
        }
      } else {
        logger.warn(
          `[${context}] token inválido detectado sem userCalendarId para invalidar ` +
          `(${(err?.message ?? "").toString().slice(0, 80)})`
        );
      }
    }
    throw err;
  }
}

function buildOAuth2Client(credentials: CalendarCredentials) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: decryptToken(credentials.accessToken),
    refresh_token: decryptToken(credentials.refreshToken),
    expiry_date: credentials.tokenExpiry?.getTime()
  });

  // Persiste tokens refreshados de volta no DB (fire-and-forget).
  // Sem isso, cada nova chamada à API faria um refresh desnecessário —
  // o googleapis SDK faz refresh automático quando detecta expiração,
  // mas o access_token novo fica só em memória.
  // Aceita id ou userCalendarId — as tools passam o model do Sequelize
  // (campo `id`); chamadores antigos usam `userCalendarId` explícito.
  const ucId = credentials.userCalendarId ?? credentials.id;
  if (ucId) {
    client.on("tokens", (tokens) => {
      (async () => {
        try {
          const updates: any = {};
          if (tokens.access_token) updates.accessToken = encryptToken(tokens.access_token);
          if (tokens.refresh_token) updates.refreshToken = encryptToken(tokens.refresh_token);
          if (tokens.expiry_date) updates.tokenExpiry = new Date(tokens.expiry_date);
          if (Object.keys(updates).length) {
            await UserCalendar.update(updates, { where: { id: ucId } });
          }
        } catch (e) {
          console.error("[GoogleCalendar] Falha ao persistir tokens refreshados:", e);
        }
      })();
    });
  }

  return client;
}

/**
 * Retorna os períodos ocupados de um calendário em uma data específica.
 * Usa a API freebusy do Google Calendar.
 */
export async function getBusyPeriods(input: FreeBusyInput): Promise<BusyPeriod[]> {
  const auth = buildOAuth2Client(input.credentials);
  const calendar = google.calendar({ version: "v3", auth });

  // Bug #33 (2026-05-24): sem sufixo de timezone, `new Date("YYYY-MM-DDT00:00:00")`
  // é interpretado como hora LOCAL do servidor. Em servidor UTC (produção Linux),
  // isso gera uma janela deslocada 3h — eventos BRT não aparecem na query Google.
  // Fix: forçar BRT explicitamente (-03:00). Brazil aboliu horário de verão em 2019,
  // então -03:00 é sempre correto para América/São Paulo.
  const dayStart = new Date(`${input.date}T00:00:00-03:00`);
  const dayEnd = new Date(`${input.date}T23:59:59-03:00`);

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: input.calendarId }]
    }
  });

  const busy = response.data.calendars?.[input.calendarId]?.busy ?? [];

  // Bug #33 (2026-05-24): `.toTimeString()` renderiza no fuso do SERVIDOR.
  // Em servidor UTC, um evento de 9h BRT (12h UTC) aparecia como "12:00" —
  // bloqueando slots que estavam livres do ponto de vista do cliente em BRT.
  // Fix: renderizar explicitamente em America/Sao_Paulo, que é o fuso usado
  // por availabilityEngine para calcular slots (strings "HH:MM" = BRT).
  return busy.map(period => ({
    start: new Date(period.start!).toLocaleTimeString("en-GB", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit"
    }),
    end: new Date(period.end!).toLocaleTimeString("en-GB", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit"
    })
  }));
}

/**
 * Cria um evento no Google Calendar e retorna o ID do evento criado.
 */
export async function createCalendarEvent(input: CreateEventInput): Promise<{ id: string }> {
  const auth = buildOAuth2Client(input.credentials);
  const calendar = google.calendar({ version: "v3", auth });

  const event = await calendar.events.insert({
    calendarId: input.calendarId,
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startDateTime, timeZone: "America/Sao_Paulo" },
      end: { dateTime: input.endDateTime, timeZone: "America/Sao_Paulo" }
    }
  });

  return { id: event.data.id! };
}

/**
 * Remove um evento do Google Calendar pelo ID.
 */
export async function deleteCalendarEvent(input: DeleteEventInput): Promise<void> {
  const auth = buildOAuth2Client(input.credentials);
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.delete({
    calendarId: input.calendarId,
    eventId: input.eventId
  });
}
