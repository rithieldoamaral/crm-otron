import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as ChannelWebhookController from "../controllers/ChannelWebhookController";

const channelWebhookRoutes = Router();

/**
 * Rate limit da rota de webhook.
 *
 * CLAUDE.md XV.5 classifica rate limiting como controle de SEGURANÇA em rotas
 * públicas e em rotas que consomem API paga — esta é as duas coisas. Sem teto,
 * uma inundação de requisições forjadas obrigaria o servidor a calcular HMAC
 * para cada uma e a consultar o banco a cada tentativa.
 *
 * O limite é generoso porque tráfego legítimo de webhook é volumoso: cada
 * mensagem de cada cliente de cada empresa passa por aqui. O objetivo é conter
 * abuso, não estrangular operação normal.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "ERR_TOO_MANY_WEBHOOK_REQUESTS" }
});

/**
 * Rotas de webhook dos canais oficiais.
 *
 * NÃO LEVAM `isAuth` DE PROPÓSITO: a Meta e a Twilio chamam de fora, sem JWT —
 * exigir sessão aqui tornaria o recebimento impossível. A autenticação é feita
 * por ASSINATURA dentro do controller, e é ela que substitui o middleware.
 *
 * Isto NÃO é exceção à regra XV.1 ("ocultação não é proteção"): a rota não
 * depende de estar escondida. O endereço é entregue ao provedor de propósito, e
 * quem não souber assinar com o segredo da conexão recebe 403.
 */
channelWebhookRoutes.get(
  "/webhook/whatsapp/:whatsappId",
  webhookLimiter,
  ChannelWebhookController.verify
);

channelWebhookRoutes.post(
  "/webhook/whatsapp/:whatsappId",
  webhookLimiter,
  ChannelWebhookController.receive
);

export default channelWebhookRoutes;
