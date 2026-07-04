/**
 * ServiceCatalogService — CRUD de serviços do catálogo da empresa.
 *
 * Responsabilidades:
 *   - `listServices`        — Lista serviços da empresa (com profissionais)
 *   - `findServiceById`     — Busca um serviço pelo ID (com profissionais)
 *   - `createService`       — Cria novo serviço + associa profissionais
 *   - `updateService`       — Atualiza campos + substitui profissionais se enviado
 *   - `removeService`       — Remove (fisicamente) um serviço
 *
 * Multi-tenancy: todas as operações filtram por `companyId` do JWT.
 * Profissionais: gerenciados via tabela `ServiceProfessional` (N:N com User).
 * Transações: create/update com professionalIds usam sequelize.transaction para
 *   garantir atomicidade entre Service e ServiceProfessional.
 *
 * Lógica pura: `ServiceCatalogService.utils.ts` (testável sem Sequelize).
 *
 * Decisão: Unificação UX 2026-05-24 — `ServiceCatalog` é a única fonte de
 *   verdade para serviços. `GoogleCalendarController` mantém suas rotas para
 *   leitura dos serviços com profissionais (consumidas pelo agente de calendário),
 *   mas o CRUD de serviços passa a ser exclusivo deste serviço.
 *   Ref: decisions_log.md — 2026-05-24.
 */

import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Service from "../../models/Service";
import ServiceProfessional from "../../models/ServiceProfessional";
import User from "../../models/User";
import sequelize from "../../database";
import { normalizePrice } from "./ServiceCatalogService.utils";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ListServicesParams {
  companyId: number;
  searchParam?: string;
  /** Inclui serviços inativos. Default: false (retorna apenas ativos) */
  includeInactive?: boolean;
}

export interface CreateServiceParams {
  companyId: number;
  name: string;
  durationMinutes?: number;
  description?: string;
  /** Preço em Reais (ex: 40.00). null = sem preço cadastrado */
  price?: number | null;
  /** Categoria livre (ex: "Depilação", "Coloração") */
  category?: string;
  /**
   * IDs dos usuários (profissionais) que realizam este serviço.
   * undefined = sem associações (não cria ServiceProfessional).
   * [] = sem profissionais explicitamente.
   */
  professionalIds?: number[];
}

export interface UpdateServiceParams {
  name?: string;
  durationMinutes?: number;
  description?: string;
  price?: number | null;
  category?: string;
  isActive?: boolean;
  /**
   * Se definido, substitui completamente a lista de profissionais.
   * [] = remove todos os profissionais.
   * undefined = não altera profissionais existentes.
   */
  professionalIds?: number[];
}

// ── Helpers internos ────────────────────────────────────────────────────────

/**
 * Valida que todos os userIds pertencem à empresa do requisitante.
 * Lança AppError 403 se algum userId for de outra empresa.
 * Impede o admin de associar profissionais de outras empresas ao serviço.
 *
 * @param userIds   - IDs a validar
 * @param companyId - Empresa do JWT
 * @throws AppError 403 se algum userId não pertencer à empresa
 */
async function assertUsersInCompany(userIds: number[], companyId: number): Promise<void> {
  if (!userIds.length) return;
  const count = await User.count({ where: { id: { [Op.in]: userIds }, companyId } });
  if (count !== userIds.length) {
    throw new AppError("Um ou mais profissionais não pertencem a esta empresa", 403);
  }
}

/**
 * Opções de include padrão para carregar profissionais junto ao serviço.
 * Reutilizado em listServices e findServiceById para consistência.
 */
const INCLUDE_PROFESSIONALS = [
  {
    model: ServiceProfessional,
    as: "serviceProfessionals",
    include: [{ model: User, as: "user", attributes: ["id", "name"] }],
  },
];

// ── Funções de I/O ──────────────────────────────────────────────────────────

/**
 * Lista todos os serviços da empresa, com profissionais vinculados.
 *
 * @param params - { companyId, searchParam, includeInactive }
 * @returns Lista de serviços ordenada por nome ASC, com serviceProfessionals
 *
 * @example
 *   const services = await listServices({ companyId: 1 });
 *   // [{ id: 1, name: "Corte", price: "40.00", serviceProfessionals: [...] }]
 */
export async function listServices({
  companyId,
  searchParam,
  includeInactive = false,
}: ListServicesParams): Promise<Service[]> {
  const where: Record<string, unknown> = { companyId };

  if (!includeInactive) {
    where.isActive = true;
  }

  if (searchParam) {
    where.name = { [Op.iLike]: `%${searchParam}%` };
  }

  return Service.findAll({
    where,
    include: INCLUDE_PROFESSIONALS,
    order: [["name", "ASC"]],
  });
}

/**
 * Busca um serviço pelo ID com guard de companyId (multi-tenancy).
 *
 * @param serviceId - ID do serviço
 * @param companyId - ID da empresa (do JWT)
 * @returns Service (com serviceProfessionals) ou null se não encontrado
 */
export async function findServiceById(
  serviceId: number,
  companyId: number
): Promise<Service | null> {
  return Service.findOne({
    where: { id: serviceId, companyId },
    include: INCLUDE_PROFESSIONALS,
  });
}

/**
 * Cria um novo serviço no catálogo, opcionalmente com profissionais associados.
 * Se `professionalIds` for passado, a criação e a associação ocorrem em transação.
 *
 * @param params - Dados do serviço (name obrigatório)
 * @returns Service criado
 * @throws AppError 400 se name for vazio
 * @throws AppError 403 se algum professionalId não pertencer à empresa
 */
export async function createService(
  params: CreateServiceParams
): Promise<Service> {
  const { companyId, name, durationMinutes, description, price, category, professionalIds } =
    params;

  if (!name || !name.trim()) {
    throw new AppError("ERR_SERVICE_NAME_REQUIRED", 400);
  }

  // Valida cross-company antes de abrir transação — falha rápida
  if (professionalIds?.length) {
    await assertUsersInCompany(professionalIds, companyId);
  }

  const normalizedPrice = normalizePrice(price);

  return sequelize.transaction(async (t) => {
    const service = await Service.create(
      {
        companyId,
        name: name.trim(),
        durationMinutes: durationMinutes ?? null,
        description: description?.trim() ?? null,
        price: normalizedPrice,
        category: category?.trim() ?? null,
        isActive: true,
      } as any,
      { transaction: t }
    );

    if (professionalIds?.length) {
      await ServiceProfessional.bulkCreate(
        professionalIds.map((userId) => ({
          serviceId: (service as any).id,
          userId,
          companyId,
        })),
        { transaction: t }
      );
    }

    return service;
  });
}

/**
 * Atualiza campos de um serviço existente.
 * Se `professionalIds` for definido (inclusive []), substitui completamente os profissionais.
 * Se for `undefined`, os profissionais existentes não são tocados.
 *
 * @param serviceId - ID do serviço a atualizar
 * @param data      - Campos a atualizar (apenas os presentes são modificados)
 * @param companyId - ID da empresa (guard multi-tenancy)
 * @returns Service atualizado (recarregado com profissionais)
 * @throws AppError 404 se não encontrado ou pertencer a outra empresa
 * @throws AppError 403 se algum professionalId não pertencer à empresa
 */
export async function updateService(
  serviceId: number,
  data: UpdateServiceParams,
  companyId: number
): Promise<Service> {
  const service = await findServiceById(serviceId, companyId);

  if (!service) {
    throw new AppError("ERR_SERVICE_NOT_FOUND", 404);
  }

  // Valida cross-company antes de abrir transação — falha rápida
  if (data.professionalIds?.length) {
    await assertUsersInCompany(data.professionalIds, companyId);
  }

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.durationMinutes !== undefined) updates.durationMinutes = data.durationMinutes;
  if (data.description !== undefined) updates.description = data.description;
  if (data.category !== undefined) updates.category = data.category?.trim();
  if (data.isActive !== undefined) updates.isActive = data.isActive;

  // Preço: permite null explícito (admin removendo preço do catálogo)
  if ("price" in data) {
    updates.price = data.price !== null ? normalizePrice(data.price) : null;
  }

  await sequelize.transaction(async (t) => {
    await service.update(updates, { transaction: t });

    // Substitui profissionais somente se professionalIds foi explicitamente passado
    if (data.professionalIds !== undefined) {
      await ServiceProfessional.destroy({
        where: { serviceId, companyId },
        transaction: t,
      });
      if (data.professionalIds.length) {
        await ServiceProfessional.bulkCreate(
          data.professionalIds.map((userId) => ({ serviceId, userId, companyId })),
          { transaction: t }
        );
      }
    }
  });

  // Recarrega para retornar dados atualizados com profissionais
  return (await findServiceById(serviceId, companyId))!;
}

/**
 * Remove um serviço do catálogo (exclusão física).
 * ServiceProfessionals vinculados são removidos em cascata via FK constraint.
 *
 * Aviso: ServiceHistories vinculados continuam existindo como registro histórico.
 * Apenas serviços sem agendamentos futuros devem ser removidos
 * (verificação de responsabilidade do chamador).
 *
 * @param serviceId - ID do serviço
 * @param companyId - ID da empresa (guard multi-tenancy)
 * @throws AppError 404 se não encontrado
 */
export async function removeService(
  serviceId: number,
  companyId: number
): Promise<void> {
  // Busca simples sem include — não precisa dos profissionais para remover
  const service = await Service.findOne({ where: { id: serviceId, companyId } });

  if (!service) {
    throw new AppError("ERR_SERVICE_NOT_FOUND", 404);
  }

  await service.destroy();
}

export default {
  listServices,
  findServiceById,
  createService,
  updateService,
  removeService,
};
