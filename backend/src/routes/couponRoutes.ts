import express from "express";
import isAuth from "../middleware/isAuth";
import * as CouponController from "../controllers/CouponController";

const couponRoutes = express.Router();

/** Cria cupom manualmente (admin) */
couponRoutes.post("/coupons", isAuth, CouponController.store);

/** Busca cupom por código */
couponRoutes.get("/coupons/:code", isAuth, CouponController.show);

/** Resgata cupom */
couponRoutes.post("/coupons/:code/redeem", isAuth, CouponController.redeem);

/** Lista cupons de um contato */
couponRoutes.get("/contacts/:contactId/coupons", isAuth, CouponController.listByContact);

export default couponRoutes;
