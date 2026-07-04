/**
 * DashboardDataServiceV2
 *
 * Extensão do DashboardDataService com dois filtros adicionais:
 * - queueId  — filtra por departamento/fila
 * - userId   — filtra por atendente específico
 *
 * Por que v2 em vez de editar o v1:
 * - Princípio de mínima mudança (CLAUDE.md II.6) — o v1 está em produção e é
 *   chamado por hooks existentes do frontend. Tocar nele arriscaria regressão.
 * - O v2 adiciona apenas 2 condições opcionais ao WHERE do CTE — zero refactor.
 */

import { QueryTypes } from "sequelize";
import * as _ from "lodash";
import sequelize from "../../database";

export interface DashboardDataV2 {
  counters: any;
  attendants: any[];
}

export interface ParamsV2 {
  days?: number;
  date_from?: string;
  date_to?: string;
  /** Filtrar pelo ID da fila. 0 ou undefined = todas as filas. */
  queue_id?: number;
  /** Filtrar por atendente específico. 0 ou undefined = todos. */
  user_id?: number;
}

export default async function DashboardDataServiceV2(
  companyId: string | number,
  params: ParamsV2
): Promise<DashboardDataV2> {
  // Mesma query base do v1 — adicionamos condições dinâmicas no CTE
  const query = `
    with
    traking as (
      select
        c.name "companyName",
        u.name "userName",
        u.online "userOnline",
        w.name "whatsappName",
        ct.name "contactName",
        ct.number "contactNumber",
        (tt."finishedAt" is not null) "finished",
        (tt."userId" is null and tt."finishedAt" is null) "pending",
        coalesce((
          (date_part('day', age(coalesce(tt."ratingAt", tt."finishedAt") , tt."startedAt")) * 24 * 60) +
          (date_part('hour', age(coalesce(tt."ratingAt", tt."finishedAt"), tt."startedAt")) * 60) +
          (date_part('minutes', age(coalesce(tt."ratingAt", tt."finishedAt"), tt."startedAt")))
        ), 0) "supportTime",
        coalesce((
          (date_part('day', age(tt."startedAt", tt."queuedAt")) * 24 * 60) +
          (date_part('hour', age(tt."startedAt", tt."queuedAt")) * 60) +
          (date_part('minutes', age(tt."startedAt", tt."queuedAt")))
        ), 0) "waitTime",
        t.status,
        tt.*,
        ct."id" "contactId",
        t."queueId"
      from "TicketTraking" tt
      left join "Companies" c on c.id = tt."companyId"
      left join "Users" u on u.id = tt."userId"
      left join "Whatsapps" w on w.id = tt."whatsappId"
      left join "Tickets" t on t.id = tt."ticketId"
      left join "Contacts" ct on ct.id = t."contactId"
      -- filterPeriod
    ),
    counters as (
      select
        (select avg("supportTime") from traking where "supportTime" > 0) "avgSupportTime",
        (select avg("waitTime") from traking where "waitTime" > 0) "avgWaitTime",
        (
          select count(distinct t2.id)
          from "Tickets" t2
          where t2.status = 'open'
            and t2."companyId" = ?
            -- queueFilterLive
        ) "supportHappening",
        (
          select count(distinct t3.id)
          from "Tickets" t3
          where t3.status = 'pending'
            and t3."companyId" = ?
            -- queueFilterLive2
        ) "supportPending",
        (select count(id) from traking where finished) "supportFinished",
        (
          select count(leads.id) from (
            select
              ct1.id,
              count(tt1.id) total
            from traking tt1
            left join "Tickets" t1 on t1.id = tt1."ticketId"
            left join "Contacts" ct1 on ct1.id = t1."contactId"
            group by 1
            having count(tt1.id) = 1
          ) leads
        ) "leads",
        (
          select count(id) from "Companies"
        ) "totalCompanies",
        (
          select count(id) from "Whatsapps" where session <> ''
        ) "totalWhatsappSessions"
    ),
    attedants as (
      select
        u.id,
        u.name,
        coalesce(att."avgSupportTime", 0) "avgSupportTime",
        att.tickets,
        att.rating,
        att.online
      from "Users" u
      left join (
        select
          u1.id,
          u1."name",
          u1."online",
          avg(t."supportTime") "avgSupportTime",
          count(t."id") tickets,
          coalesce(avg(ur.rate), 0) rating
        from "Users" u1
        left join traking t on t."userId" = u1.id
        left join "UserRatings" ur on ur."userId" = t."userId"
          and ur."createdAt"::date = t."finishedAt"::date
        group by 1, 2
      ) att on att.id = u.id
      where u."companyId" = ?
      order by att.name
    )
    select
      (select coalesce(jsonb_build_object('counters', c.*)->>'counters', '{}')::jsonb from counters c) counters,
      (select coalesce(json_agg(a.*), '[]')::jsonb from attedants a) attendants;
  `;

  // ─── Monta WHERE dinâmico do CTE traking ────────────────────────────────
  let where = `where tt."companyId" = ?`;
  const replacements: any[] = [companyId];

  if (_.has(params, "days") && params.days! > 0) {
    where += ` and tt."queuedAt" >= (now() - '? days'::interval)`;
    replacements.push(parseInt(`${params.days}`.replace(/\D/g, ""), 10));
  }

  if (_.has(params, "date_from")) {
    where += ` and tt."queuedAt" >= ?`;
    replacements.push(`${params.date_from} 00:00:00`);
  }

  if (_.has(params, "date_to")) {
    where += ` and tt."finishedAt" <= ?`;
    replacements.push(`${params.date_to} 23:59:59`);
  }

  // Filtro por fila — novo no v2
  if (params.queue_id && params.queue_id > 0) {
    where += ` and t."queueId" = ?`;
    replacements.push(params.queue_id);
  }

  // Filtro por atendente — novo no v2
  if (params.user_id && params.user_id > 0) {
    where += ` and tt."userId" = ?`;
    replacements.push(params.user_id);
  }

  // Params para os subqueries de counters (supportHappening, supportPending, attedants)
  replacements.push(companyId); // ? em supportHappening
  replacements.push(companyId); // ? em supportPending
  replacements.push(companyId); // ? em attedants WHERE

  // Substitui filtros de queue nas contagens ao vivo (se filtro de fila ativo)
  let queueFilterLive = "";
  let queueFilterLive2 = "";
  if (params.queue_id && params.queue_id > 0) {
    queueFilterLive = `and t2."queueId" = ${parseInt(String(params.queue_id), 10)}`;
    queueFilterLive2 = `and t3."queueId" = ${parseInt(String(params.queue_id), 10)}`;
  }

  const finalQuery = query
    .replace("-- filterPeriod", where)
    .replace("-- queueFilterLive", queueFilterLive)
    .replace("-- queueFilterLive2", queueFilterLive2);

  const responseData: DashboardDataV2 = await sequelize.query(finalQuery, {
    replacements,
    type: QueryTypes.SELECT,
    plain: true
  });

  return responseData;
}
