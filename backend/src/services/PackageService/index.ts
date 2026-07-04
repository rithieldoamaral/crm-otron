/**
 * PackageService — CRUD de pacotes e gestão de saldo de sessões.
 *
 * Responsabilidades:
 *   - `listPackages`         — Lista templates de pacotes da empresa
 *   - `findPackageById`      — Busca um template por ID
 *   - `createPackage`        — Cria novo template de pacote
 *   - `updatePackage`        — Atualiza campos de um template
 *   - `removePackage`        — Inativa um template (soft-delete)
 *   - `purchasePackage`      — Registra venda de pacote para um cliente
 *   - `consumeSession`       — Consome uma sessão do pacote comprado
 *   - `listClientPurchases`  — Lista compras de um cliente
 *   - `findPurchaseById`     — Busca uma compra por ID
 *
 * Multi-tenancy: todas as operações filtram por `companyId` do JWT.
 * Lógica pura: `PackageService.utils.ts` (testável sem Sequelize).
 * WhatsApp: fire-and-forget em try/catch — falha não bloqueia fluxo principal.
 *
 * Receita (Fase 6): cash basis — um ServiceHistory com source='package_purchase'
 * é criado na compra; consumos de sessão NÃO geram ServiceHistory adicional.
 *
 * Diretiva: Fase 6 do Módulo Financeiro — Pacotes de Sessões.
 */

import { Op } from "sequelize";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import Package from "../../models/Package";
import ClientPackagePurchase from "../../models/ClientPackagePurchase";
import PackageConsumption from "../../models/PackageConsumption";
import Contact from "../../models/Contact";
import Service from "../../models/Service";
import ServiceHistory from "../../models/ServiceHistory";
import { logger } from "../../utils/logger";
import {
  calculateSessionsRemaining,
  derivePackageStatus,
  shouldSendLowBalanceAlert,
  buildSessionBalanceMessage,
  buildCompletionMessage,
  buildLowBalanceAlertMessage,
} from "./PackageService.utils";
import { getActiveWhatsapp } from "../RetentionService/_shared";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import formatBody from "../../helpers/Mustache";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreatePackageDTO {
  serviceId?: number | null;
  name: string;
  description?: string | null;
  totalSessions: number;
  totalPrice: number;
}

export interface UpdatePackageDTO {
  serviceId?: number | null;
  name?: string;
  description?: string | null;
  totalSessions?: number;
  totalPrice?: number;
  isActive?: boolean;
}

export interface PurchasePackageOptions {
  /** Data da compra. Default: agora. */
  purchasedAt?: Date;
  /** Data de expiração opcional. Null = sem expiração. */
  expiresAt?: Date | null;
}

export interface ConsumeSessionOptions {
  /** Notas do atendente (ex: "região: pernas"). */
  notes?: string;
  /** ID do ServiceHistory associado (nullable). */
  serviceHistoryId?: number | null;
  /** Data/hora do consumo. Default: agora. */
  consumedAt?: Date;
}

// ── Helpers privados ──────────────────────────────────────────────────────

/**
 * Envia mensagem WhatsApp ao cliente de forma fire-and-forget.
 * Falhas são logadas mas nunca propagadas — não bloqueia o fluxo principal.
 */
async function sendPackageWhatsApp(
  contact: Contact,
  companyId: number,
  message: string
): Promise<void> {
  try {
    const { whatsapp, wbotAvailable } = await getActiveWhatsapp(
      companyId,
      "[Package]"
    );
    if (!wbotAvailable || !whatsapp) return;

    const ticket = await FindOrCreateTicketService(
      contact,
      whatsapp.id!,
      0,
      companyId
    );
    await SendWhatsAppMessage({ body: formatBody(message, contact), ticket });
  } catch (err) {
    logger.warn(
      `[Package] Falha ao enviar WhatsApp para contato #${contact.id} (empresa ${companyId}):`,
      err
    );
  }
}

// ── CRUD de templates (Package) ───────────────────────────────────────────

/**
 * Lista os templates de pacotes de uma empresa.
 *
 * @param companyId     - ID da empresa (JWT)
 * @param searchParam   - Filtro de busca opcional (nome ou serviço)
 * @param includeInactive - Inclui pacotes inativos. Default: false
 * @returns Array de Package com Service incluído
 */
export async function listPackages(
  companyId: number,
  searchParam?: string,
  includeInactive = false
): Promise<Package[]> {
  const where: Record<string, unknown> = { companyId };

  if (!includeInactive) where.isActive = true;

  if (searchParam) {
    where.name = { [Op.like]: `%${searchParam}%` };
  }

  return Package.findAll({
    where,
    include: [{ model: Service, attributes: ["id", "name", "price"] }],
    order: [["name", "ASC"]],
  });
}

/**
 * Busca um template de pacote pelo ID com guard de companyId.
 *
 * @throws AppError("ERR_PACKAGE_NOT_FOUND", 404) se não encontrado
 */
export async function findPackageById(
  companyId: number,
  packageId: number
): Promise<Package> {
  const pkg = await Package.findOne({
    where: { id: packageId, companyId },
    include: [{ model: Service, attributes: ["id", "name", "price"] }],
  });
  if (!pkg) throw new AppError("ERR_PACKAGE_NOT_FOUND", 404);
  return pkg;
}

/**
 * Cria um novo template de pacote.
 *
 * @throws AppError("ERR_PACKAGE_NAME_REQUIRED", 400) se nome vazio
 * @throws AppError("ERR_PACKAGE_INVALID_SESSIONS", 400) se totalSessions < 1
 * @throws AppError("ERR_PACKAGE_INVALID_PRICE", 400) se totalPrice < 0
 */
export async function createPackage(
  companyId: number,
  data: CreatePackageDTO
): Promise<Package> {
  if (!data.name?.trim()) throw new AppError("ERR_PACKAGE_NAME_REQUIRED", 400);
  if (!data.totalSessions || data.totalSessions < 1)
    throw new AppError("ERR_PACKAGE_INVALID_SESSIONS", 400);
  if (data.totalPrice < 0) throw new AppError("ERR_PACKAGE_INVALID_PRICE", 400);

  return Package.create({
    companyId,
    serviceId: data.serviceId ?? null,
    name: data.name.trim(),
    description: data.description ?? null,
    totalSessions: data.totalSessions,
    totalPrice: data.totalPrice,
    isActive: true,
  });
}

/**
 * Atualiza campos de um template de pacote existente.
 *
 * @throws AppError("ERR_PACKAGE_NOT_FOUND", 404) se não encontrado
 */
export async function updatePackage(
  companyId: number,
  packageId: number,
  data: UpdatePackageDTO
): Promise<Package> {
  const pkg = await findPackageById(companyId, packageId);

  await pkg.update({
    ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
    ...(data.name !== undefined && { name: data.name.trim() }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.totalSessions !== undefined && {
      totalSessions: data.totalSessions,
    }),
    ...(data.totalPrice !== undefined && { totalPrice: data.totalPrice }),
    ...(data.isActive !== undefined && { isActive: data.isActive }),
  });

  return pkg;
}

/**
 * Inativa um template de pacote (soft-delete).
 * Compras existentes não são afetadas.
 *
 * @throws AppError("ERR_PACKAGE_NOT_FOUND", 404) se não encontrado
 */
export async function removePackage(
  companyId: number,
  packageId: number
): Promise<void> {
  const pkg = await findPackageById(companyId, packageId);
  await pkg.update({ isActive: false });
}

// ── Gestão de compras (ClientPackagePurchase) ─────────────────────────────

/**
 * Registra a venda de um pacote para um cliente.
 *
 * Cria:
 *   1. ClientPackagePurchase com snapshots de totalSessions/totalPrice
 *   2. ServiceHistory com source='package_purchase' (receita cash basis)
 *   3. Fire-and-forget: mensagem WhatsApp de confirmação de compra
 *
 * @param companyId  - ID da empresa (JWT)
 * @param contactId  - ID do cliente comprador
 * @param packageId  - ID do template de pacote
 * @param options    - purchasedAt, expiresAt opcionais
 * @returns          ClientPackagePurchase criado
 *
 * @throws AppError("ERR_PACKAGE_NOT_FOUND", 404) se pacote não encontrado/inativo
 * @throws AppError("ERR_CONTACT_NOT_FOUND", 404) se contato não encontrado
 */
export async function purchasePackage(
  companyId: number,
  contactId: number,
  packageId: number,
  options: PurchasePackageOptions = {}
): Promise<ClientPackagePurchase> {
  // 1. Validar pacote (deve existir e estar ativo)
  const pkg = await Package.findOne({
    where: { id: packageId, companyId, isActive: true },
    include: [{ model: Service, attributes: ["id", "name"] }],
  });
  if (!pkg) throw new AppError("ERR_PACKAGE_NOT_FOUND", 404);

  // 2. Validar contato
  const contact = await Contact.findOne({ where: { id: contactId, companyId } });
  if (!contact) throw new AppError("ERR_CONTACT_NOT_FOUND", 404);

  const now = new Date();
  const purchasedAt = options.purchasedAt ?? now;

  // Snapshot do nome do serviço (imutabilidade histórica)
  const serviceName = (pkg as any).service?.name ?? pkg.name;

  // ── Transação: compra + receita são atômicas (consistência fiscal) ────────
  // Se ServiceHistory.create falhar (DB indisponível, validação, etc), a compra
  // também não é registrada — evita o cenário "cliente pagou mas receita sumiu".
  // Auditoria 2026-05-22: substituiu o try/catch silencioso anterior.
  const purchase = await sequelize.transaction(async (t) => {
    const created = await ClientPackagePurchase.create(
      {
        companyId,
        contactId,
        packageId: pkg.id,
        serviceName,
        totalSessions: pkg.totalSessions,
        sessionsUsed: 0,
        totalPrice: pkg.totalPrice,
        status: "active",
        expiresAt: options.expiresAt ?? null,
        purchasedAt,
      },
      { transaction: t }
    );

    await ServiceHistory.create(
      {
        companyId,
        contactId,
        source: "package_purchase",
        serviceType: serviceName,
        value: Number(pkg.totalPrice),
        occurredAt: purchasedAt,
      },
      { transaction: t }
    );

    return created;
  });

  // 5. Notificação WhatsApp (fire-and-forget, pós-commit)
  const confirmMsg =
    `Olá, ${contact.name}! 🎉 Seu pacote de *${serviceName}* foi ativado com sucesso!\n` +
    `Você tem *${pkg.totalSessions} sessões* disponíveis. ` +
    `Agende sua primeira sessão quando quiser! 😊`;

  setImmediate(() =>
    sendPackageWhatsApp(contact, companyId, confirmMsg).catch(() => undefined)
  );

  return purchase;
}

/**
 * Consome uma sessão de uma compra de pacote.
 *
 * Cria:
 *   1. PackageConsumption (log da sessão)
 *   2. Incrementa sessionsUsed na ClientPackagePurchase
 *   3. Deriva e atualiza status (active/completed)
 *   4. Fire-and-forget: mensagem WhatsApp (saldo/conclusão/alerta)
 *
 * NÃO cria ServiceHistory adicional — a receita já foi reconhecida na compra.
 *
 * @param companyId  - ID da empresa (JWT)
 * @param purchaseId - ID da ClientPackagePurchase
 * @param options    - notes, serviceHistoryId, consumedAt opcionais
 * @returns          ClientPackagePurchase atualizado com sessionsUsed/status
 *
 * @throws AppError("ERR_PURCHASE_NOT_FOUND", 404) se compra não encontrada
 * @throws AppError("ERR_PURCHASE_NOT_ACTIVE", 422) se status ≠ 'active'
 */
export async function consumeSession(
  companyId: number,
  purchaseId: number,
  options: ConsumeSessionOptions = {}
): Promise<ClientPackagePurchase> {
  const consumedAt = options.consumedAt ?? new Date();

  // ── Transação com row lock ────────────────────────────────────────────────
  // Bloqueia a linha da compra para que requisições concorrentes esperem.
  // Sem o lock, duas chamadas paralelas leem o mesmo `sessionsUsed`, ambas
  // incrementam para o mesmo valor → over-consumption silenciosa.
  // Lock só dentro da transação; Contact e WhatsApp são tratados fora.
  const purchase = await sequelize.transaction(async (t) => {
    const p = await ClientPackagePurchase.findOne({
      where: { id: purchaseId, companyId },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!p) throw new AppError("ERR_PURCHASE_NOT_FOUND", 404);

    if (p.status !== "active") {
      throw new AppError("ERR_PURCHASE_NOT_ACTIVE", 422);
    }

    // Registrar consumo dentro da transação
    await PackageConsumption.create(
      {
        companyId,
        clientPackagePurchaseId: p.id,
        contactId: p.contactId,
        serviceHistoryId: options.serviceHistoryId ?? null,
        notes: options.notes ?? null,
        consumedAt,
      },
      { transaction: t }
    );

    // Incrementar sessionsUsed e derivar novo status — atômico dentro do lock
    const newSessionsUsed = p.sessionsUsed + 1;
    const newStatus = derivePackageStatus(
      newSessionsUsed,
      p.totalSessions,
      p.expiresAt ?? null
    );

    await p.update(
      { sessionsUsed: newSessionsUsed, status: newStatus },
      { transaction: t }
    );

    return p;
  });

  // ── Pós-commit: WhatsApp fire-and-forget ──────────────────────────────────
  // Fora da transação para não segurar o lock durante I/O externo.
  const remaining = calculateSessionsRemaining(
    purchase.totalSessions,
    purchase.sessionsUsed
  );

  const serviceName = purchase.serviceName ?? "serviço";

  setImmediate(async () => {
    try {
      const contact = await Contact.findOne({
        where: { id: purchase.contactId, companyId },
      });
      if (!contact) return;

      const clientName = contact.name ?? "cliente";
      let message: string;

      if (remaining === 0) {
        message = buildCompletionMessage(clientName, serviceName);
      } else if (shouldSendLowBalanceAlert(remaining, purchase.totalSessions)) {
        message = buildLowBalanceAlertMessage(clientName, serviceName, remaining);
      } else {
        message = buildSessionBalanceMessage(
          clientName,
          serviceName,
          purchase.sessionsUsed,
          purchase.totalSessions
        );
      }

      await sendPackageWhatsApp(contact, companyId, message);
    } catch (err) {
      logger.warn(
        `[Package] Falha no hook de WhatsApp pós-sessão (compra #${purchase.id}):`,
        err
      );
    }
  });

  return purchase;
}

// ── Consultas de compras ──────────────────────────────────────────────────

/**
 * Lista todas as compras de pacotes de um cliente.
 *
 * @param companyId - ID da empresa (JWT)
 * @param contactId - ID do cliente
 * @returns Array de ClientPackagePurchase com Package incluído
 */
export async function listClientPurchases(
  companyId: number,
  contactId: number
): Promise<ClientPackagePurchase[]> {
  return ClientPackagePurchase.findAll({
    where: { companyId, contactId },
    include: [
      {
        model: Package,
        attributes: ["id", "name", "totalSessions", "totalPrice"],
        required: false,
      },
    ],
    order: [["purchasedAt", "DESC"]],
  });
}

/**
 * Busca uma compra de pacote por ID com guard de companyId.
 *
 * @throws AppError("ERR_PURCHASE_NOT_FOUND", 404) se não encontrada
 */
export async function findPurchaseById(
  companyId: number,
  purchaseId: number
): Promise<ClientPackagePurchase> {
  const purchase = await ClientPackagePurchase.findOne({
    where: { id: purchaseId, companyId },
    include: [
      { model: Package, required: false },
      { model: Contact, attributes: ["id", "name", "number"] },
    ],
  });
  if (!purchase) throw new AppError("ERR_PURCHASE_NOT_FOUND", 404);
  return purchase;
}
