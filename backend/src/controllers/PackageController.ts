/**
 * PackageController — Endpoints REST para pacotes de sessões.
 *
 * Rotas expostas (via packageRoutes.ts):
 *   GET    /packages                                → index         (lista templates)
 *   POST   /packages                                → store         (cria template — admin)
 *   GET    /packages/:packageId                     → show          (busca template)
 *   PUT    /packages/:packageId                     → update        (atualiza — admin)
 *   DELETE /packages/:packageId                     → remove        (inativa — admin)
 *   POST   /packages/:packageId/purchase/:contactId → purchase      (vende para cliente)
 *   POST   /packages/purchases/:purchaseId/consume  → consumeSession (consome sessão)
 *   GET    /packages/purchases/contact/:contactId   → listPurchases (compras do cliente)
 *   GET    /packages/purchases/:purchaseId          → showPurchase  (detalhe da compra)
 *
 * Segurança:
 *   - Todas as rotas requerem `isAuth` (JWT válido)
 *   - Escrita de templates (store, update, remove) requer perfil `admin`
 *   - Multi-tenancy: companyId sempre extraído do JWT, nunca do body
 */

import { Request, Response } from "express";
import AppError from "../errors/AppError";
import {
  listPackages,
  findPackageById,
  createPackage,
  updatePackage,
  removePackage,
  purchasePackage,
  consumeSession,
  listClientPurchases,
  findPurchaseById,
  UpdatePackageDTO,
} from "../services/PackageService";
import { parseOptionalDate } from "../services/PackageService/PackageService.utils";

// ── Helper local ──────────────────────────────────────────────────────────────

/**
 * Wrapper que converte `Error` lançado por `parseOptionalDate` em `AppError(400)`,
 * gerando uma resposta HTTP clara em vez do 500 genérico do middleware default.
 */
function parseDateField(raw: unknown, fieldName: string): Date | undefined {
  try {
    return parseOptionalDate(raw, fieldName);
  } catch (err) {
    throw new AppError(
      `ERR_INVALID_DATE_${fieldName.toUpperCase()}`,
      400
    );
  }
}

// ── Templates CRUD ────────────────────────────────────────────────────────

/**
 * Lista templates de pacotes da empresa.
 *
 * Query: searchParam?, includeInactive?
 */
export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { searchParam, includeInactive } = req.query as {
    searchParam?: string;
    includeInactive?: string;
  };

  const packages = await listPackages(
    companyId,
    searchParam,
    includeInactive === "true"
  );

  return res.json(packages);
};

/**
 * Busca um template de pacote pelo ID.
 *
 * Path: packageId
 */
export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const packageId = Number(req.params.packageId);

  const pkg = await findPackageById(companyId, packageId);
  return res.json(pkg);
};

/**
 * Cria um novo template de pacote.
 *
 * Body: { name, totalSessions, totalPrice, serviceId?, description? }
 * Requer perfil admin.
 */
export const store = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const { name, totalSessions, totalPrice, serviceId, description } = req.body;

  // Serviço vinculado é obrigatório: sem ele o agente não sabe qual
  // procedimento o pacote cobre e não consegue oferecer ao cliente corretamente.
  if (!serviceId) {
    throw new AppError("ERR_PACKAGE_SERVICE_REQUIRED", 400);
  }

  const pkg = await createPackage(companyId, {
    name,
    totalSessions: Number(totalSessions),
    totalPrice: Number(totalPrice),
    serviceId: Number(serviceId),
    description: description ?? null,
  });

  return res.status(201).json(pkg);
};

/**
 * Atualiza um template de pacote existente.
 *
 * Path: packageId
 * Body: campos opcionais do template
 * Requer perfil admin.
 */
export const update = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const packageId = Number(req.params.packageId);
  const { name, totalSessions, totalPrice, serviceId, description, isActive } =
    req.body;

  // Type-safe (sem `as any`): tipo DTO importado do service.
  const updates: UpdatePackageDTO = {};
  if (name !== undefined) updates.name = name;
  if (totalSessions !== undefined) updates.totalSessions = Number(totalSessions);
  if (totalPrice !== undefined) updates.totalPrice = Number(totalPrice);
  if (serviceId !== undefined)
    updates.serviceId = serviceId ? Number(serviceId) : null;
  if (description !== undefined) updates.description = description;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);

  const pkg = await updatePackage(companyId, packageId, updates);
  return res.json(pkg);
};

/**
 * Inativa um template de pacote (soft-delete).
 *
 * Path: packageId
 * Requer perfil admin.
 */
export const remove = async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const packageId = Number(req.params.packageId);

  await removePackage(companyId, packageId);
  return res.json({ message: "Package deactivated" });
};

// ── Gestão de compras ─────────────────────────────────────────────────────

/**
 * Registra a venda de um pacote para um cliente.
 *
 * Path: packageId, contactId
 * Body: { purchasedAt?, expiresAt? }
 */
export const purchase = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const packageId = Number(req.params.packageId);
  const contactId = Number(req.params.contactId);
  const { purchasedAt, expiresAt } = req.body;

  const result = await purchasePackage(companyId, contactId, packageId, {
    purchasedAt: parseDateField(purchasedAt, "purchasedAt"),
    expiresAt: parseDateField(expiresAt, "expiresAt") ?? null,
  });

  return res.status(201).json(result);
};

/**
 * Consome uma sessão de uma compra de pacote.
 *
 * Path: purchaseId
 * Body: { notes?, serviceHistoryId?, consumedAt? }
 */
export const consumeOne = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const purchaseId = Number(req.params.purchaseId);
  const { notes, serviceHistoryId, consumedAt } = req.body;

  const updated = await consumeSession(companyId, purchaseId, {
    notes,
    serviceHistoryId: serviceHistoryId ? Number(serviceHistoryId) : null,
    consumedAt: parseDateField(consumedAt, "consumedAt"),
  });

  return res.json(updated);
};

/**
 * Lista compras de pacotes de um cliente específico.
 *
 * Path: contactId
 */
export const listPurchases = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const contactId = Number(req.params.contactId);

  const purchases = await listClientPurchases(companyId, contactId);
  return res.json(purchases);
};

/**
 * Detalhe de uma compra de pacote.
 *
 * Path: purchaseId
 */
export const showPurchase = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const purchaseId = Number(req.params.purchaseId);

  const purchase = await findPurchaseById(companyId, purchaseId);
  return res.json(purchase);
};
