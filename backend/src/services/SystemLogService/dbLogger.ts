/**
 * dbLogger — escritor de logs fire-and-forget.
 *
 * Por que fire-and-forget:
 * - Logs de auditoria NUNCA devem bloquear a request principal.
 * - Uma falha de log (ex: DB sobrecarregado) não deve derrubar a operação de negócio.
 * - O superadmin prefere "log perdido" a "ticket não fechou por causa do log".
 *
 * Uso:
 *   dbLog({ action: "ticket.close", companyId, userId, entity: "Ticket", entityId: ticket.id, req });
 *
 * O `req` é opcional — quando presente extrai IP automaticamente.
 * Todos os campos além de `action` são opcionais.
 */

import SystemLog from "../../models/SystemLog";
import { Request } from "express";

interface LogPayload {
  /** Formato "entidade.verbo" — ex.: "user.login", "ticket.close", "setting.update" */
  action: string;
  companyId?: number;
  userId?: number;
  entity?: string;
  entityId?: number;
  details?: Record<string, unknown>;
  /**
   * Request Express opcional — usado apenas para extrair o IP.
   * Não armazenamos body nem headers sensíveis.
   */
  req?: Pick<Request, "ip" | "headers">;
}

/**
 * Persiste um evento de auditoria de forma assíncrona sem bloquear o chamador.
 *
 * Erros de escrita são logados no stderr mas não propagados.
 * Nunca aguardar (await) esta função — use fire-and-forget:
 *
 * @example
 *   dbLog({ action: "ticket.close", companyId: 1, userId: 5, entity: "Ticket", entityId: 42 });
 */
export function dbLog(payload: LogPayload): void {
  // Extrai IP: prioriza X-Forwarded-For (proxy/load-balancer) depois req.ip
  const ip = payload.req
    ? ((payload.req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
       payload.req.ip ??
       null)
    : null;

  // Fire-and-forget: cria a Promise mas não awaita
  SystemLog.create({
    action: payload.action,
    companyId: payload.companyId ?? null,
    userId: payload.userId ?? null,
    entity: payload.entity ?? null,
    entityId: payload.entityId ?? null,
    details: payload.details ?? null,
    ip
  }).catch((err: unknown) => {
    // Não relança — log de auditoria nunca deve derrubar operação de negócio
    console.error("[dbLogger] Falha ao gravar SystemLog:", err);
  });
}

// ─── Constantes de ação (evita strings mágicas espalhadas no código) ────────

export const LOG_ACTIONS = {
  // Autenticação
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  USER_LOGIN_FAILED: "user.login_failed",

  // Gestão de usuários
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",

  // Tickets
  TICKET_CREATED: "ticket.created",
  TICKET_CLOSED: "ticket.closed",
  TICKET_REOPENED: "ticket.reopened",
  TICKET_TRANSFERRED: "ticket.transferred",

  // Configurações
  SETTING_UPDATED: "setting.updated",

  // Agente IA
  AGENT_TOOL_CALL: "agent.tool_call",
  AGENT_SESSION_START: "agent.session_start",

  // Sistema
  COMPANY_CREATED: "company.created",
  COMPANY_UPDATED: "company.updated",
  BACKUP_CREATED: "backup.created",
} as const;

export type LogAction = typeof LOG_ACTIONS[keyof typeof LOG_ACTIONS];
