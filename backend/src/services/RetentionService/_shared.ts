/**
 * Helpers de I/O compartilhados pelos serviços do Módulo de Retenção.
 *
 * Para helpers PUROS (sem I/O), ver `_shared.utils.ts` — separação
 * permite testar lógica isolada sem carregar baileys/wbot.
 */

import Whatsapp from "../../models/Whatsapp";
import Setting from "../../models/Setting";
import { logger } from "../../utils/logger";
import { getWbot } from "../../libs/wbot";
import { safeTimezone, DEFAULT_TIMEZONE } from "./_shared.utils";

// ── Re-exports pure helpers (manter API antiga) ────────────────────

export {
  addDays,
  isWithinFireWindow,
  formatDiscountLabel,
  safeCouponDiscountType,
  safeTimezone,
  FIRE_WINDOW_MINUTES,
  DEFAULT_TIMEZONE
} from "./_shared.utils";

// ── WhatsApp helpers ───────────────────────────────────────────────

export interface ActiveWhatsappResult {
  whatsapp: Whatsapp | null;
  wbotAvailable: boolean;
}

/**
 * Busca o WhatsApp padrão da empresa e verifica se a sessão está ativa.
 *
 * @returns { whatsapp, wbotAvailable } — null/false se não há WhatsApp utilizável
 *
 * @example
 *   const { whatsapp, wbotAvailable } = await getActiveWhatsapp(companyId);
 *   if (!wbotAvailable) return;
 */
export async function getActiveWhatsapp(
  companyId: number,
  logPrefix: string = "[Retention]"
): Promise<ActiveWhatsappResult> {
  const whatsapp = await Whatsapp.findOne({
    where: { companyId, isDefault: true, status: "CONNECTED" }
  });
  if (!whatsapp) return { whatsapp: null, wbotAvailable: false };

  try {
    getWbot(whatsapp.id!);
    return { whatsapp, wbotAvailable: true };
  } catch {
    logger.warn(`${logPrefix} WhatsApp ${whatsapp.id} sem sessão ativa (empresa ${companyId})`);
    return { whatsapp, wbotAvailable: false };
  }
}

// ── Setting helpers ────────────────────────────────────────────────

/**
 * Lê um Setting de uma empresa retornando seu value ou um default.
 */
export async function getSetting(
  key: string,
  companyId: number,
  defaultValue?: string
): Promise<string | undefined> {
  const row = await Setting.findOne({ where: { key, companyId } });
  return row?.value ?? defaultValue;
}

/**
 * Retorna o timezone configurado para a empresa (Setting "timezone")
 * ou o default `America/Sao_Paulo`.
 */
export async function getCompanyTimezone(companyId: number): Promise<string> {
  const tz = await getSetting("timezone", companyId, DEFAULT_TIMEZONE);
  return safeTimezone(tz);
}
