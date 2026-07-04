/**
 * CouponController — endpoints REST para gestão de cupons de retenção.
 *
 * Endpoints:
 *   POST   /coupons             — cria cupom (admin)
 *   GET    /coupons/:code       — busca por código (qualquer atendente)
 *   POST   /coupons/:code/redeem — resgata cupom (qualquer atendente)
 *   GET    /contacts/:contactId/coupons — lista cupons de um contato
 *
 * Geração de cupons para campanhas específicas (ex: aniversariante dormant)
 * é feita pelo RetentionController (Chunk 4).
 */

import { Request, Response } from "express";
import {
  createCoupon,
  redeemCoupon,
  getByCode,
  listForContact
} from "../services/RetentionService/CouponService";
import AppError from "../errors/AppError";

/**
 * POST /coupons
 *
 * Body: { contactId?, reason, discountType, discountValue, validFrom?, validUntil?, codePrefix? }
 * Requer perfil admin.
 */
export const store = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  const { companyId } = req.user;
  const {
    contactId,
    reason,
    discountType,
    discountValue,
    validFrom,
    validUntil,
    codePrefix
  } = req.body;

  if (!reason || !discountType || discountValue === undefined) {
    throw new AppError("ERR_COUPON_MISSING_FIELDS", 400);
  }

  const coupon = await createCoupon({
    contactId: contactId ? Number(contactId) : undefined,
    companyId,
    reason,
    discountType,
    discountValue: Number(discountValue),
    validFrom: validFrom ? new Date(validFrom) : undefined,
    validUntil: validUntil ? new Date(validUntil) : undefined,
    codePrefix
  });

  return res.status(201).json(coupon);
};

/**
 * GET /coupons/:code
 *
 * Retorna dados do cupom incluindo status (active/redeemed/expired/scheduled).
 */
export const show = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { code } = req.params;

  const coupon = await getByCode(code.toUpperCase(), companyId);

  return res.json({
    ...coupon.toJSON(),
    status: coupon.status   // getter do model
  });
};

/**
 * POST /coupons/:code/redeem
 *
 * Resgata um cupom. Operação idempotente: já resgatado → erro 422.
 */
export const redeem = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { code } = req.params;

  const coupon = await redeemCoupon({
    code: code.toUpperCase(),
    companyId,
    redeemedByUserId: Number(userId)
  });

  return res.json({
    ...coupon.toJSON(),
    status: coupon.status
  });
};

/**
 * GET /contacts/:contactId/coupons
 *
 * Lista histórico de cupons de um contato específico.
 */
export const listByContact = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { contactId } = req.params;

  const coupons = await listForContact(
    Number(contactId),
    companyId
  );

  return res.json(coupons.map(c => ({ ...c.toJSON(), status: c.status })));
};
