/**
 * RetentionController — endpoints REST do Módulo de Retenção.
 *
 * Endpoints:
 *   GET  /retention/dormant                    — lista contatos que precisam de atenção
 *   GET  /retention/summary                    — sumário agregado (stats para dashboard)
 *   GET  /contacts/:contactId/retention        — perfil completo de retenção do contato
 *   POST /retention/:contactId/coupon          — gera cupom de reativação para um contato
 *
 * Fluxo do GET /retention/dormant:
 *   1. Busca contactIds distintos com ServiceHistory na empresa
 *   2. Para cada: carrega histórico + classifica com DormantDetectionService
 *   3. Filtra pelos status solicitados (default: atrasado, adormecido, perdido)
 *   4. Retorna lista paginada com dados de contato + classificação
 */

import { Request, Response } from "express";
import { Op } from "sequelize";
import Contact from "../models/Contact";
import ServiceHistory from "../models/ServiceHistory";
import BirthdayTouch from "../models/BirthdayTouch";
import PreventiveTouch from "../models/PreventiveTouch";
import LoyaltyReward from "../models/LoyaltyReward";
import WinbackAttempt from "../models/WinbackAttempt";
import Coupon from "../models/Coupon";
import { classify, DormantStatusType } from "../services/RetentionService/DormantDetectionService";
import { listForContact, getSummaryForContact } from "../services/RetentionService/ServiceHistoryService";
import { groupHistoryByContact } from "../services/RetentionService/ServiceHistoryService.utils";
import { createCoupon, listForContact as listCoupons } from "../services/RetentionService/CouponService";
import {
  isDormantStatus,
  buildDormantSummary,
  DEFAULT_DORMANT_STATUSES,
  STATUS_LABELS
} from "../services/RetentionService/RetentionService.utils";
import {
  extractMonthDay,
  getDayOffsetFromBirthday
} from "../services/RetentionService/BirthdayService.utils";
import {
  analyzeRFM,
  SEGMENT_LABELS,
  RFMSegment
} from "../services/RetentionService/RFMService.utils";
import {
  findServicePairs,
  suggestServicesForContact,
  ServiceRecord
} from "../services/RetentionService/CrossSellService.utils";
import {
  getOrCreateReferralCode,
  registerReferral,
  listReferralsByReferrer,
  getReferralSummary
} from "../services/RetentionService/ReferralService";
import Referral from "../models/Referral";
import ClientPackagePurchase from "../models/ClientPackagePurchase";
import { hasActivePackage } from "../services/PackageService/PackageService.utils";
import AppError from "../errors/AppError";

// ── Tipos locais ───────────────────────────────────────────────────

type DormantQuery = {
  status?: string;     // "atrasado,adormecido,perdido" (CSV) ou status único
  page?: string;
  limit?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Parseia o parâmetro `status` da query string para um array de DormantStatusType.
 * Aceita: CSV ("atrasado,perdido") ou string única ("adormecido").
 * Se não fornecido, retorna DEFAULT_DORMANT_STATUSES.
 */
function parseStatusFilter(statusParam?: string): DormantStatusType[] {
  if (!statusParam) return DEFAULT_DORMANT_STATUSES;
  const parts = statusParam.split(",").map(s => s.trim()) as DormantStatusType[];
  const valid: DormantStatusType[] = [
    "novo", "em_dia", "quase_na_hora", "atrasado", "adormecido", "perdido"
  ];
  return parts.filter(p => valid.includes(p));
}

/**
 * Retorna o conjunto de contactIds que têm PELO MENOS UM pacote ativo na empresa.
 *
 * Guard de retenção (Tier 2): cliente com pacote ativo (comprou N sessões e ainda
 * está consumindo) NÃO deve entrar na lista de adormecidos/perdidos — o
 * ServiceHistory só registra receita na COMPRA (cash basis), então o algoritmo o
 * vê "parado" e o classificaria como perdido, gerando winback/cupom desnecessário.
 *
 * Batch: carrega todas as compras da empresa de uma vez e agrupa por contato
 * (evita N+1). O status ATIVO é derivado via `hasActivePackage` (não confia no
 * campo `status` persistido, que pode estar desatualizado).
 *
 * @param companyId - Empresa (multi-tenant)
 * @returns Set de contactIds com pacote ativo
 */
async function loadActivePackageContactIds(companyId: number): Promise<Set<number>> {
  const purchases = await ClientPackagePurchase.findAll({
    where: { companyId },
    attributes: ["contactId", "sessionsUsed", "totalSessions", "expiresAt", "status"]
  });

  const byContact = new Map<number, any[]>();
  for (const p of purchases) {
    const list = byContact.get(p.contactId) ?? [];
    list.push(p);
    byContact.set(p.contactId, list);
  }

  const active = new Set<number>();
  for (const [contactId, list] of byContact) {
    if (hasActivePackage(list as any)) active.add(contactId);
  }
  return active;
}

// ── Controllers ──────────────────────────────────────────────────────

/**
 * GET /retention/dormant
 *
 * Query params:
 *   status — CSV de statuses (default: atrasado,adormecido,perdido)
 *   page   — página (default: 1)
 *   limit  — itens por página (max: 100, default: 20)
 */
export const listDormant = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { status, page = "1", limit = "20" } = req.query as DormantQuery;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const statusFilter = parseStatusFilter(status);

  // 1. Carrega TODO o histórico da empresa em UMA query e agrupa por contato em
  //    memória (ITEM C — escala). Antes: 1 query de contactIds distintos + N
  //    queries `listForContact` (N+1). Agora: 1 query só. `groupHistoryByContact`
  //    replica exatamente o `ORDER BY occurredAt DESC LIMIT 50` por contato, então
  //    os registros passados a `classify` — e todos os números — são idênticos.
  const historyRows = await ServiceHistory.findAll({
    attributes: ["contactId", "occurredAt"],
    where: { companyId },
    order: [["occurredAt", "DESC"]],
    raw: true
  }) as any[];

  const historyByContact = groupHistoryByContact(historyRows, 50);

  if (historyByContact.size === 0) {
    return res.json({ items: [], total: 0, page: pageNum, pages: 0, summary: buildDormantSummary([]) });
  }

  // 2. Classifica cada contato
  //    Guard de pacote ativo (Tier 2): contatos com pacote ativo são excluídos da
  //    lista de reativação — estão engajados (comprando/consumindo sessões) e o
  //    cash basis do ServiceHistory os faria parecer "parados" indevidamente.
  const activePackageContacts = await loadActivePackageContactIds(companyId);

  const classified: Array<{
    contactId: number;
    status: DormantStatusType;
    daysSinceLastService: number;
    ratio: number;
    totalServices: number;
  }> = [];

  for (const [contactId, history] of historyByContact) {
    if (activePackageContacts.has(contactId)) continue;

    const result = classify(history);

    if (isDormantStatus(result.status, statusFilter)) {
      classified.push({
        contactId,
        status: result.status,
        daysSinceLastService: result.daysSinceLastService,
        ratio: result.ratio,
        totalServices: result.totalServices
      });
    }
  }

  // Ordena por urgência: perdido > adormecido > atrasado
  const statusOrder: Record<DormantStatusType, number> = {
    perdido: 0, adormecido: 1, atrasado: 2, quase_na_hora: 3, em_dia: 4, novo: 5
  };
  classified.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

  // 3. Paginação
  const total = classified.length;
  const pages = Math.ceil(total / limitNum);
  const offset = (pageNum - 1) * limitNum;
  const slice = classified.slice(offset, offset + limitNum);

  // 4. Enriquece com dados do Contact
  const contacts = await Contact.findAll({
    where: { id: slice.map(s => s.contactId), companyId }
  });
  const contactMap = new Map(contacts.map(c => [c.id, c]));

  const items = slice.map(s => ({
    contact: contactMap.get(s.contactId) ?? null,
    dormant: {
      status: s.status,
      statusLabel: STATUS_LABELS[s.status],
      daysSinceLastService: s.daysSinceLastService,
      ratio: s.ratio,
      totalServices: s.totalServices
    }
  }));

  return res.json({
    items,
    total,
    page: pageNum,
    pages,
    summary: buildDormantSummary(classified)
  });
};

/**
 * GET /retention/summary
 *
 * Retorna apenas o sumário agregado (útil para cards de dashboard).
 */
export const getSummary = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  // Carga única + agrupamento em memória (ITEM C — mesmo padrão do listDormant,
  // elimina o N+1 sem alterar números).
  const historyRows = await ServiceHistory.findAll({
    attributes: ["contactId", "occurredAt"],
    where: { companyId },
    order: [["occurredAt", "DESC"]],
    raw: true
  }) as any[];

  const historyByContact = groupHistoryByContact(historyRows, 50);

  // Guard de pacote ativo (Tier 2): mesma exclusão do listDormant — o sumário
  // alimenta o mesmo painel "para reativar", então clientes com pacote ativo não
  // devem inflar as contagens de atrasado/adormecido/perdido.
  const activePackageContacts = await loadActivePackageContactIds(companyId);

  const classified: Array<{ status: DormantStatusType }> = [];

  for (const [contactId, history] of historyByContact) {
    if (activePackageContacts.has(contactId)) continue;

    const result = classify(history);
    classified.push({ status: result.status });
  }

  return res.json(buildDormantSummary(classified));
};

/**
 * GET /contacts/:contactId/retention
 *
 * Retorna perfil completo de retenção do contato:
 *   - Classificação atual (DormantDetectionService)
 *   - Histórico de serviços (ServiceHistory)
 *   - Cupons ativos/histórico (Coupon)
 */
export const getContactRetention = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) {
    throw new AppError("ERR_CONTACT_NOT_FOUND", 404);
  }

  const [history, summary, coupons] = await Promise.all([
    listForContact({ contactId, companyId, limit: 50 }),
    getSummaryForContact(contactId, companyId),
    listCoupons(contactId, companyId)
  ]);

  const classification = classify(history);

  return res.json({
    contact,
    classification: {
      ...classification,
      statusLabel: STATUS_LABELS[classification.status]
    },
    summary,
    history,
    coupons: coupons.map(c => ({ ...c.toJSON(), status: c.status }))
  });
};

/**
 * GET /retention/birthday-stats
 *
 * Estatísticas do fluxo de aniversário para o dashboard.
 *
 * Retorna:
 *   - upcomingBirthdays  — contatos com aniversário nos próximos 7 dias
 *   - recentBirthdays    — contatos com aniversário nos últimos 7 dias (janela D+7)
 *   - touchStats         — quantos toques de cada tipo foram enviados no ano corrente
 *   - couponStats        — cupons de aniversário gerados + taxa de resgate
 *
 * Query params:
 *   year — ano de referência (default: ano corrente)
 */
export const getBirthdayStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const now = new Date();
  const year = Number(req.query.year) || now.getUTCFullYear();

  // ── 1. Toques enviados no ano ─────────────────────────────────────
  const touches = await BirthdayTouch.findAll({
    where: { companyId, year },
    include: ["coupon"]
  });

  const touchStats = {
    dm3: touches.filter(t => t.touchType === "dm3").length,
    d0: touches.filter(t => t.touchType === "d0").length,
    dp7: touches.filter(t => t.touchType === "dp7").length,
    year
  };

  // ── 2. Cupons de aniversário gerados no ano ───────────────────────
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const birthdayCoupons = await Coupon.findAll({
    where: {
      companyId,
      reason: "birthday",
      createdAt: { [Op.gte]: yearStart, [Op.lt]: yearEnd }
    }
  });

  const redeemedCount = birthdayCoupons.filter(c => c.redeemedAt !== null).length;
  const couponStats = {
    generated: birthdayCoupons.length,
    redeemed: redeemedCount,
    redemptionRate: birthdayCoupons.length > 0
      ? Math.round((redeemedCount / birthdayCoupons.length) * 100)
      : 0
  };

  // ── 3. Aniversários próximos e recentes ───────────────────────────
  const contacts = await Contact.findAll({
    where: {
      companyId,
      birthday: { [Op.not]: null },
      active: true,
      isGroup: false
    },
    attributes: ["id", "name", "number", "birthday", "marketingOptOut"]
  });

  type BirthdayEntry = {
    contact: { id: number; name: string; number: string; marketingOptOut: boolean };
    daysUntil: number;
    touchesSent: string[];
  };

  const upcoming: BirthdayEntry[] = [];
  const recent: BirthdayEntry[] = [];

  // Busca todos os toques do ano para estes contatos de uma vez (evita N+1)
  const contactIds = contacts.map(c => c.id);
  const yearTouches = contactIds.length > 0
    ? await BirthdayTouch.findAll({ where: { companyId, year, contactId: contactIds } })
    : [];

  const touchesByContact = new Map<number, string[]>();
  for (const t of yearTouches) {
    const list = touchesByContact.get(t.contactId) || [];
    list.push(t.touchType);
    touchesByContact.set(t.contactId, list);
  }

  for (const contact of contacts) {
    const birthdayRaw = contact.getDataValue("birthday") as Date | string | null;
    const monthDay = extractMonthDay(birthdayRaw);
    if (!monthDay) continue;

    const offset = getDayOffsetFromBirthday(monthDay, now);
    const touchesSent = touchesByContact.get(contact.id) || [];

    const entry: BirthdayEntry = {
      contact: {
        id: contact.id,
        name: contact.name,
        number: contact.number,
        marketingOptOut: contact.marketingOptOut
      },
      daysUntil: -offset, // negativo → positivo = dias que faltam
      touchesSent
    };

    // Próximos 7 dias: offset entre -7 e -1
    if (offset >= -7 && offset <= -1) {
      upcoming.push(entry);
    }
    // Últimos 7 dias (janela dp7): offset entre 0 e 7
    if (offset >= 0 && offset <= 7) {
      recent.push({ ...entry, daysUntil: offset }); // daysUntil = dias desde o aniversário
    }
  }

  // Ordena por proximidade
  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
  recent.sort((a, b) => a.daysUntil - b.daysUntil);

  return res.json({
    year,
    touchStats,
    couponStats,
    upcomingBirthdays: upcoming,
    recentBirthdays: recent
  });
};

/**
 * GET /retention/rfm/:contactId
 *
 * Análise RFM individual de um contato (Fase 4A).
 * Retorna scores R/F/M, segmento e métricas brutas.
 */
export const getContactRFM = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) throw new AppError("ERR_CONTACT_NOT_FOUND", 404);

  const history = await listForContact({ contactId, companyId, limit: 200 });
  const rfm = analyzeRFM({ history });

  return res.json({
    contact: { id: contact.id, name: contact.name, number: contact.number },
    rfm
  });
};

/**
 * GET /retention/rfm-segments
 *
 * Distribuição da base de clientes por segmento RFM (Fase 4A).
 * Útil para dashboard estratégico.
 */
export const getRFMSegments = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  // Busca contactIds com histórico
  const rows = await ServiceHistory.findAll({
    attributes: ["contactId"],
    where: { companyId },
    group: ["contactId"],
    raw: true
  }) as any[];

  const contactIds: number[] = rows.map((r: any) => r.contactId).filter(Boolean);

  // Inicializa contadores
  const distribution: Record<RFMSegment, number> = {
    champions: 0, loyal: 0, potential: 0, at_risk: 0,
    hibernating: 0, new: 0, others: 0
  };

  // Classifica cada contato
  for (const contactId of contactIds) {
    const history = await listForContact({ contactId, companyId, limit: 200 });
    const rfm = analyzeRFM({ history });
    distribution[rfm.segment]++;
  }

  const total = contactIds.length;
  const detailedDistribution = (Object.keys(distribution) as RFMSegment[]).map(
    (segment) => ({
      segment,
      label: SEGMENT_LABELS[segment],
      count: distribution[segment],
      percentage: total > 0
        ? Math.round((distribution[segment] / total) * 100)
        : 0
    })
  );

  return res.json({
    total,
    distribution: detailedDistribution
  });
};

/**
 * GET /retention/cross-sell/pairs
 *
 * Pares de serviços mais frequentemente consumidos juntos (Fase 4B).
 * Útil para identificar oportunidades de combo/upsell de pacote.
 *
 * Query params:
 *   minSupport — mínimo de clientes que consumiram ambos (default: 2)
 *   limit      — máximo de pares retornados (default: 20)
 */
export const getCrossSellPairs = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const minSupport = Math.max(1, parseInt(String(req.query.minSupport || "2"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));

  // BUG-FIX B4: cap defensivo para proteger contra OOM em empresas grandes.
  // Cross-sell pairs é um cálculo O(n × tipos²) por cliente — para volumes
  // maiores que MAX_CROSS_SELL_ROWS, esta análise deveria rodar offline
  // (cron de hidratação para Redis). Por enquanto, capamos com warning.
  const MAX_CROSS_SELL_ROWS = 50000;
  const records = await ServiceHistory.findAll({
    where: { companyId, serviceType: { [Op.not]: null } },
    attributes: ["contactId", "occurredAt", "serviceType"],
    order: [["occurredAt", "DESC"]],
    limit: MAX_CROSS_SELL_ROWS,
    raw: true
  }) as any[];

  if (records.length === MAX_CROSS_SELL_ROWS) {
    // Sinaliza que a análise pode estar incompleta — cliente decide o que fazer
    res.setHeader("X-Cross-Sell-Capped", "true");
  }

  const typed: ServiceRecord[] = records.map((r: any) => ({
    contactId: r.contactId,
    occurredAt: r.occurredAt,
    serviceType: r.serviceType
  }));

  const pairs = findServicePairs(typed, minSupport).slice(0, limit);

  return res.json({
    totalRecords: typed.length,
    capped: records.length === MAX_CROSS_SELL_ROWS,
    totalPairs: pairs.length,
    pairs
  });
};

/**
 * GET /retention/cross-sell/:contactId
 *
 * Sugestões de serviços para um contato específico (Fase 4B).
 * Baseado em pares calculados sobre toda a base da empresa.
 *
 * Query params:
 *   minConfidence — confidence mínimo % (default: 30)
 *   limit         — máximo de sugestões (default: 5)
 */
export const getContactCrossSell = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);
  const minConfidence = Math.max(1, parseInt(String(req.query.minConfidence || "30"), 10));
  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || "5"), 10)));

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) throw new AppError("ERR_CONTACT_NOT_FOUND", 404);

  // BUG-FIX B4: mesmo cap defensivo do getCrossSellPairs.
  const MAX_CROSS_SELL_ROWS = 50000;
  const allRecords = await ServiceHistory.findAll({
    where: { companyId, serviceType: { [Op.not]: null } },
    attributes: ["contactId", "occurredAt", "serviceType"],
    order: [["occurredAt", "DESC"]],
    limit: MAX_CROSS_SELL_ROWS,
    raw: true
  }) as any[];

  const typed: ServiceRecord[] = allRecords.map((r: any) => ({
    contactId: r.contactId,
    occurredAt: r.occurredAt,
    serviceType: r.serviceType
  }));

  // Pares globais
  const pairs = findServicePairs(typed);

  // Serviços já consumidos pelo contato
  const contactServices = new Set(
    typed
      .filter(r => r.contactId === contactId)
      .map(r => r.serviceType!)
      .filter(Boolean)
  );

  const suggestions = suggestServicesForContact(
    contactServices,
    pairs,
    minConfidence,
    limit
  );

  return res.json({
    contact: { id: contact.id, name: contact.name, number: contact.number },
    consumedServices: Array.from(contactServices),
    suggestions
  });
};

/**
 * GET /retention/preventive-stats
 *
 * Estatísticas do lembrete preventivo (Fase 3A).
 * Retorna: total enviados (período), distribuição por ratio, taxa de retorno.
 *
 * Query params:
 *   days — janela de análise (default: 30)
 */
export const getPreventiveStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const days = Math.max(1, parseInt(String(req.query.days || "30"), 10));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const touches = await PreventiveTouch.findAll({
    where: { companyId, sentAt: { [Op.gte]: since } },
    order: [["sentAt", "DESC"]]
  });

  // Taxa de retorno: dos contatos que receberam toque, quantos voltaram
  // (geraram novo ServiceHistory após o toque)?
  let returned = 0;
  for (const touch of touches) {
    const newHistory = await ServiceHistory.count({
      where: {
        contactId: touch.contactId,
        companyId,
        occurredAt: { [Op.gt]: touch.sentAt }
      }
    });
    if (newHistory > 0) returned++;
  }

  return res.json({
    windowDays: days,
    totalSent: touches.length,
    returnedCount: returned,
    returnRate: touches.length > 0
      ? Math.round((returned / touches.length) * 100)
      : 0
  });
};

/**
 * GET /retention/loyalty-stats
 *
 * Estatísticas do programa de fidelidade (Fase 3B).
 * Retorna: distribuição de recompensas por marco, taxa de resgate.
 */
export const getLoyaltyStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  const rewards = await LoyaltyReward.findAll({
    where: { companyId },
    include: ["coupon"]
  });

  // Distribuição por marco
  const byMilestone: Record<number, number> = {};
  let totalRedeemed = 0;
  for (const r of rewards) {
    byMilestone[r.milestone] = (byMilestone[r.milestone] || 0) + 1;
    if ((r as any).coupon?.redeemedAt) totalRedeemed++;
  }

  return res.json({
    totalAwarded: rewards.length,
    totalRedeemed,
    redemptionRate: rewards.length > 0
      ? Math.round((totalRedeemed / rewards.length) * 100)
      : 0,
    byMilestone
  });
};

/**
 * GET /retention/winback-stats
 *
 * Estatísticas do win-back (Fase 3C).
 * Retorna: tentativas enviadas, conversões, taxa de conversão.
 *
 * Query params:
 *   days — janela de análise (default: 180)
 */
export const getWinbackStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const days = Math.max(1, parseInt(String(req.query.days || "180"), 10));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const attempts = await WinbackAttempt.findAll({
    where: { companyId, sentAt: { [Op.gte]: since } }
  });

  const converted = attempts.filter(a => a.outcome === "converted").length;
  const pending = attempts.filter(a => a.outcome === "pending").length;
  const noResponse = attempts.filter(a => a.outcome === "no_response").length;

  return res.json({
    windowDays: days,
    totalSent: attempts.length,
    converted,
    pending,
    noResponse,
    conversionRate: attempts.length > 0
      ? Math.round((converted / attempts.length) * 100)
      : 0
  });
};

/**
 * GET /retention/referral/:contactId/code
 *
 * Entrega (ou gera preguiçosamente) o código de indicação do contato (Fase 4C).
 */
export const getReferralCode = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);
  const code = await getOrCreateReferralCode(contactId, companyId);
  return res.json({ contactId, referralCode: code });
};

/**
 * POST /retention/referral/register
 *
 * Registra uma nova indicação (Fase 4C). Body: { referralCode, referredContactId }
 */
export const postRegisterReferral = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { referralCode, referredContactId } = req.body;

  if (!referralCode || !referredContactId) {
    throw new AppError("ERR_REFERRAL_MISSING_DATA", 400);
  }

  const referral = await registerReferral({
    referralCode: String(referralCode),
    referredContactId: Number(referredContactId),
    companyId
  });

  return res.status(201).json(referral);
};

/**
 * GET /retention/referral/:contactId/list
 *
 * Lista indicações feitas pelo contato + sumário.
 */
export const getReferralsList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);

  const [referrals, summary] = await Promise.all([
    listReferralsByReferrer(contactId, companyId),
    getReferralSummary(contactId, companyId)
  ]);

  return res.json({ referrals, summary });
};

/**
 * GET /retention/referral-stats
 *
 * Estatísticas agregadas do programa de indicação por empresa.
 */
export const getReferralStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;

  const all = await Referral.findAll({ where: { companyId } });
  const converted = all.filter(r => r.outcome === "converted").length;
  const pending = all.filter(r => r.outcome === "pending").length;
  const expired = all.filter(r => r.outcome === "expired").length;

  return res.json({
    total: all.length,
    converted,
    pending,
    expired,
    conversionRate: all.length > 0
      ? Math.round((converted / all.length) * 100)
      : 0
  });
};

/**
 * POST /retention/:contactId/coupon
 *
 * Gera um cupom de reativação para um contato dormente.
 * Requer perfil admin.
 *
 * Body: { discountType, discountValue, validDays? }
 */
export const generateReactivationCoupon = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);

  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) {
    throw new AppError("ERR_CONTACT_NOT_FOUND", 404);
  }

  const { discountType = "percent", discountValue = 10, validDays = 30 } = req.body;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + Number(validDays));

  const coupon = await createCoupon({
    contactId,
    companyId,
    reason: "reactivation",
    discountType,
    discountValue: Number(discountValue),
    codePrefix: "REATIVAR",
    validUntil
  });

  return res.status(201).json({
    ...coupon.toJSON(),
    status: coupon.status
  });
};
