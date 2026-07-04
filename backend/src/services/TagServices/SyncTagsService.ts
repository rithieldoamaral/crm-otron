/**
 * SyncTagsService — sincroniza as tags de um ticket (destrói e recria).
 *
 * Hook de retenção (Chunk 2 — Módulo de Retenção):
 *   Após o sync, verifica se alguma tag nova tem `isCompletionTag = true`.
 *   Se sim, aciona `recordKanbanCompletion` que:
 *     1. Fecha o ticket
 *     2. Registra ServiceHistory com source='kanban_completion'
 *
 * O motivo de buscar os tags completos do banco (ao invés de usar os passados
 * pelo frontend) é garantir que `isCompletionTag` esteja presente —
 * o cliente pode enviar apenas `{ id }` sem todos os campos.
 */

import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import { logger } from "../../utils/logger";
import { hasCompletionTag } from "../RetentionService/ServiceHistoryService.utils";
import { recordKanbanCompletion } from "../RetentionService/ServiceHistoryService";

interface Request {
  tags: Tag[];
  ticketId: number;
  /** Necessário para o hook de conclusão Kanban */
  companyId?: number;
}

const SyncTags = async ({
  tags,
  ticketId,
  companyId
}: Request): Promise<Ticket | null> => {
  const ticket = await Ticket.findByPk(ticketId, { include: [Tag] });

  const tagList = tags.map(t => ({ tagId: t.id, ticketId }));

  await TicketTag.destroy({ where: { ticketId } });
  await TicketTag.bulkCreate(tagList);

  await ticket?.reload();

  // ── Kanban Completion Hook ─────────────────────────────────────────
  // Busca as tags completas do banco para garantir que isCompletionTag está
  // presente (o frontend pode enviar stubs apenas com { id }).
  if (ticket && companyId && tags.length > 0) {
    try {
      const tagIds = tags.map(t => t.id).filter(Boolean);
      const fullTags = tagIds.length > 0
        ? await Tag.findAll({ where: { id: tagIds } })
        : [];

      if (hasCompletionTag(fullTags)) {
        await recordKanbanCompletion({ ticket, companyId });
      }
    } catch (err: any) {
      // Hook não deve quebrar o fluxo principal de sincronização de tags
      logger.error(
        `[SyncTags] Erro no hook de conclusão Kanban (ticket #${ticketId}): ${err.message}`
      );
    }
  }

  return ticket;
};

export default SyncTags;
