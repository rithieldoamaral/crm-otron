/**
 * ServiceHistoryService — camada de I/O para registros de visitas/serviços.
 *
 * Responsabilidades:
 *   1. `recordHistory`         — cria um registro genérico de serviço concluído
 *   2. `recordKanbanCompletion`— hook chamado pelo SyncTagsService quando uma
 *                                tag de conclusão é aplicada a um ticket Kanban
 *   3. `listForContact`        — busca histórico paginado de um contato
 *   4. `getSummaryForContact`  — retorna resumo (total, última visita) para o
 *                                DormantDetectionService
 *
 * Lógica pura (hasCompletionTag) está em `ServiceHistoryService.utils.ts`.
 * A separação garante testes unitários sem depender de Sequelize ou Socket.
 *
 * Diretiva: `directives/retencao_modulo.md` seção 5 (Kanban Completion Hook).
 */

import { Op } from "sequelize";
import { logger } from "../../utils/logger";
import ServiceHistory, {
  ServiceHistorySource
} from "../../models/ServiceHistory";
import Service from "../../models/Service";
import Ticket from "../../models/Ticket";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import { checkAndAwardLoyalty } from "./LoyaltyService";
import { markWinbackConverted } from "./WinbackService";
import { convertReferralIfPending } from "./ReferralService";
import { resolveHistoryValue } from "../ServiceCatalogService/ServiceCatalogService.utils";

// ── Types ──────────────────────────────────────────────────────────

export interface RecordHistoryParams {
  /** ID do contato atendido */
  contactId: number;
  /** ID do ticket vinculado (opcional) */
  ticketId?: number;
  /** ID da empresa */
  companyId: number;
  /** ID do agendamento vinculado (opcional) */
  scheduleId?: number;
  /**
   * ID do serviço do catálogo (opcional — Fase 5).
   * Quando fornecido e `value` não é informado, o preço do catálogo
   * é buscado automaticamente e gravado em ServiceHistory.value.
   * Permite rastreamento financeiro automático sem poluir chamadas legadas.
   */
  serviceId?: number;
  /** Origem do registro */
  source: ServiceHistorySource;
  /** Tipo de serviço realizado (ex: "corte", "barba") — opcional */
  serviceType?: string;
  /**
   * Valor monetário do serviço — opcional.
   * Se omitido e `serviceId` for fornecido, o preço do catálogo é usado.
   * 0 é um valor válido (serviço gratuito) e NÃO é sobrescrito pelo catálogo.
   */
  value?: number;
  /**
   * Quando o serviço ocorreu. Default: agora.
   * Permitir valor passado para backfill de histórico (source='migration').
   */
  occurredAt?: Date;
}

export interface HistorySummary {
  totalServices: number;
  lastServiceAt: Date | null;
  lastServiceSource: ServiceHistorySource | null;
}

export interface ListForContactParams {
  contactId: number;
  companyId: number;
  /** Máximo de registros retornados. Default: 50 */
  limit?: number;
}

// ── Funções de I/O ─────────────────────────────────────────────────

/**
 * Cria um registro de serviço concluído.
 *
 * Não realiza verificação de idempotência — chamadores específicos
 * (ex: recordKanbanCompletion) devem verificar duplicidade antes de chamar.
 *
 * @param params Dados do serviço
 * @returns ServiceHistory criado
 *
 * @example
 *   await recordHistory({
 *     contactId: 42,
 *     ticketId: 99,
 *     companyId: 1,
 *     source: "manual",
 *     serviceType: "corte",
 *     value: 35.00
 *   });
 */
export async function recordHistory(
  params: RecordHistoryParams
): Promise<ServiceHistory> {
  const {
    contactId,
    ticketId,
    companyId,
    scheduleId,
    serviceId,
    source,
    serviceType,
    value,
    occurredAt = new Date()
  } = params;

  // ── Fase 5: auto-populate value from service catalog ──────────────────────
  // Se serviceId foi fornecido e value não foi explicitado, busca o preço do
  // catálogo. Usa resolveHistoryValue (pura, testada) para determinar o valor final.
  let resolvedValue: number | null = value ?? null;
  if (serviceId !== undefined && value === undefined) {
    try {
      const svc = await Service.findOne({
        where: { id: serviceId, companyId },
        attributes: ["price"]
      });
      resolvedValue = resolveHistoryValue(undefined, svc?.price ?? null);
    } catch (err) {
      // Falha ao buscar preço é não-bloqueante: grava sem valor monetário
      logger.warn(
        `[ServiceHistory] Falha ao buscar preço do serviço #${serviceId} (continuando sem valor):`,
        err
      );
    }
  }

  const history = await ServiceHistory.create({
    contactId,
    ticketId: ticketId ?? null,
    companyId,
    scheduleId: scheduleId ?? null,
    source,
    serviceType: serviceType ?? null,
    value: resolvedValue,
    occurredAt
  } as any);

  // ── Hooks pós-criação (Fases 3B + 3C + 4C) ───────────────────────
  // Isolados em try/catch para garantir que falhas em features laterais
  // NÃO bloqueiem o fluxo principal de registro de serviço.
  // Source='migration' não dispara hooks (backfill histórico).
  //
  // BUG-FIX (revisão sênior 2026-05-20): tanto loyalty quanto referral
  // contavam TODOS os ServiceHistory (incluindo source='migration'),
  // o que disparava recompensas erradas para clientes recém-importados.
  // Agora `realServicesCount` exclui migrações.
  if (source !== "migration") {
    try {
      // Conta APENAS serviços reais (exclui backfill histórico)
      const realServicesCount = await ServiceHistory.count({
        where: { contactId, companyId, source: { [Op.ne]: "migration" } }
      });

      // Fase 3B — Programa de fidelidade (cupom em marcos: 5, 10, 20...)
      // Fire-and-forget: erros tratados internamente.
      checkAndAwardLoyalty({
        contactId,
        companyId,
        previousTotal: realServicesCount - 1,
        totalServices: realServicesCount
      }).catch(err => {
        logger.error("[ServiceHistory] Hook loyalty falhou (silencioso):", err);
      });

      // Fase 3C — Marca tentativa de win-back como convertida (cliente voltou)
      markWinbackConverted(contactId, companyId).catch(err => {
        logger.error("[ServiceHistory] Hook winback falhou (silencioso):", err);
      });

      // Fase 4C — Conversão de indicação no PRIMEIRO serviço REAL do indicado
      // (realServicesCount === 1 → este é o 1º registro NÃO-migration)
      if (realServicesCount === 1) {
        convertReferralIfPending(contactId, companyId).catch(err => {
          logger.error("[ServiceHistory] Hook referral falhou (silencioso):", err);
        });
      }
    } catch (err) {
      logger.error("[ServiceHistory] Falha ao executar hooks pós-criação:", err);
    }
  }

  return history;
}

/**
 * Hook do Kanban: chamado quando uma tag de conclusão (isCompletionTag=true)
 * é aplicada a um ticket.
 *
 * Fluxo:
 *   1. Idempotência — se já existe ServiceHistory com source='kanban_completion'
 *      para este ticket, pula (evita duplicatas em re-syncs acidentais).
 *   2. Fecha o ticket via UpdateTicketService (emite socket para o frontend).
 *   3. Cria ServiceHistory com source='kanban_completion'.
 *
 * @param ticket Ticket completo do Sequelize
 * @param companyId ID da empresa
 * @returns ServiceHistory criado, ou null se ticket já foi processado
 *
 * @example
 *   // Chamado internamente pelo SyncTagsService
 *   await recordKanbanCompletion({ ticket, companyId: 1 });
 */
export async function recordKanbanCompletion({
  ticket,
  companyId
}: {
  ticket: Ticket;
  companyId: number;
}): Promise<ServiceHistory | null> {
  // Idempotência: não duplicar se já processado
  const existing = await ServiceHistory.findOne({
    where: {
      ticketId: ticket.id,
      source: "kanban_completion"
    }
  });

  if (existing) {
    logger.info(
      `[KanbanCompletion] Ticket #${ticket.id} já registrado — idempotência aplicada`
    );
    return null;
  }

  // Fecha o ticket (emite evento socket via UpdateTicketService)
  if (ticket.status !== "closed") {
    await UpdateTicketService({
      ticketData: { status: "closed" },
      ticketId: ticket.id,
      companyId
    });
  }

  // Registra ServiceHistory
  const history = await recordHistory({
    contactId: ticket.contactId,
    ticketId: ticket.id,
    companyId,
    source: "kanban_completion",
    occurredAt: new Date()
  });

  logger.info(
    `[KanbanCompletion] Ticket #${ticket.id} concluído via Kanban — ServiceHistory #${history.id} criado`
  );

  return history;
}

/**
 * Retorna o histórico de serviços de um contato, ordenado por data decrescente.
 *
 * Usado pelo DormantDetectionService para calcular o status do cliente.
 *
 * @param params { contactId, companyId, limit = 50 }
 * @returns Lista de ServiceHistory ordenada por occurredAt DESC
 */
export async function listForContact({
  contactId,
  companyId,
  limit = 50
}: ListForContactParams): Promise<ServiceHistory[]> {
  return ServiceHistory.findAll({
    where: { contactId, companyId },
    order: [["occurredAt", "DESC"]],
    limit
  });
}

/**
 * Retorna um resumo do histórico de serviços de um contato.
 *
 * Projetado para ser eficiente: usa COUNT + ORDER BY + LIMIT 1 em vez de
 * buscar todos os registros.
 *
 * @param contactId ID do contato
 * @param companyId ID da empresa
 * @returns HistorySummary com total, última visita e fonte do último registro
 */
export async function getSummaryForContact(
  contactId: number,
  companyId: number
): Promise<HistorySummary> {
  const where = { contactId, companyId };

  const [totalServices, lastRecord] = await Promise.all([
    ServiceHistory.count({ where }),
    ServiceHistory.findOne({
      where,
      order: [["occurredAt", "DESC"]]
    })
  ]);

  return {
    totalServices,
    lastServiceAt: lastRecord?.occurredAt ?? null,
    lastServiceSource: lastRecord?.source ?? null
  };
}

export default {
  recordHistory,
  recordKanbanCompletion,
  listForContact,
  getSummaryForContact
};
