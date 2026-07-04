/**
 * ServiceCatalogController — Endpoints REST para o catálogo de serviços.
 *
 * Rotas expostas (via serviceCatalogRoutes.ts):
 *   GET    /service-catalog              → index  (lista serviços da empresa)
 *   POST   /service-catalog              → store  (cria serviço — admin only)
 *   GET    /service-catalog/:serviceId   → show   (busca serviço por ID)
 *   PUT    /service-catalog/:serviceId   → update (atualiza — admin only)
 *   DELETE /service-catalog/:serviceId   → remove (exclui — admin only)
 *
 * Segurança:
 *   - Todas as rotas requerem `isAuth` (JWT válido)
 *   - Operações de escrita (store, update, remove) requerem perfil `admin`
 *   - Multi-tenancy: companyId sempre extraído do JWT, nunca do body
 *
 * Profissionais: `store` e `update` aceitam `professionalIds?: number[]`.
 *   A validação cross-company (user pertence à empresa) é feita no service.
 *   Fonte única da verdade para CRUD de serviços — ref: decisions_log 2026-05-24.
 */

import { Request, Response } from "express";
import AppError from "../errors/AppError";
import {
  listServices,
  findServiceById,
  createService,
  updateService,
  removeService,
} from "../services/ServiceCatalogService";

// ── index ──────────────────────────────────────────────────────────────────

/**
 * Lista serviços da empresa.
 *
 * Query params:
 *   - searchParam?    : filtro por nome (iLike)
 *   - includeInactive?: "true" para incluir inativos (default: apenas ativos)
 */
export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { searchParam, includeInactive } = req.query as {
    searchParam?: string;
    includeInactive?: string;
  };

  const services = await listServices({
    companyId,
    searchParam,
    includeInactive: includeInactive === "true",
  });

  return res.json(services);
};

// ── show ───────────────────────────────────────────────────────────────────

/**
 * Busca um serviço pelo ID.
 *
 * Path param: serviceId
 */
export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const serviceId = Number(req.params.serviceId);

  const service = await findServiceById(serviceId, companyId);

  if (!service) {
    throw new AppError("ERR_SERVICE_NOT_FOUND", 404);
  }

  return res.json(service);
};

// ── store ──────────────────────────────────────────────────────────────────

/**
 * Cria um novo serviço no catálogo.
 *
 * Body: { name, durationMinutes?, description?, price?, category?, professionalIds? }
 * Requer perfil admin.
 */
export const store = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const { name, durationMinutes, description, price, category, professionalIds } = req.body;

  const service = await createService({
    companyId,
    name,
    durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
    description,
    price: price !== undefined ? Number(price) : undefined,
    category,
    // Garante que é array de números — defensive parse do body
    professionalIds: Array.isArray(professionalIds)
      ? professionalIds.map(Number).filter((n) => !isNaN(n) && n > 0)
      : undefined,
  });

  return res.status(201).json(service);
};

// ── update ─────────────────────────────────────────────────────────────────

/**
 * Atualiza campos de um serviço existente.
 *
 * Path param: serviceId
 * Body: { name?, durationMinutes?, description?, price?, category?, isActive?, professionalIds? }
 *   professionalIds: se presente, substitui completamente os profissionais.
 *   professionalIds ausente: não altera profissionais existentes.
 * Requer perfil admin.
 */
export const update = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const serviceId = Number(req.params.serviceId);
  const { name, durationMinutes, description, price, category, isActive, professionalIds } =
    req.body;

  // Constrói objeto de updates apenas com campos presentes no body
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (durationMinutes !== undefined) updates.durationMinutes = Number(durationMinutes);
  if (description !== undefined) updates.description = description;
  if ("price" in req.body) updates.price = price !== null ? Number(price) : null;
  if (category !== undefined) updates.category = category;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  // professionalIds: undefined = não toca. Array (inclusive []) = substitui.
  if ("professionalIds" in req.body) {
    updates.professionalIds = Array.isArray(professionalIds)
      ? professionalIds.map(Number).filter((n: number) => !isNaN(n) && n > 0)
      : [];
  }

  const service = await updateService(serviceId, updates as any, companyId);

  return res.json(service);
};

// ── remove ─────────────────────────────────────────────────────────────────

/**
 * Remove um serviço do catálogo (exclusão física).
 *
 * Path param: serviceId
 * Requer perfil admin.
 *
 * Nota: ServiceHistories vinculados são mantidos como registro histórico.
 */
export const remove = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const serviceId = Number(req.params.serviceId);

  await removeService(serviceId, companyId);

  return res.json({ message: "Service removed" });
};
