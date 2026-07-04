/**
 * Helpers PUROS compartilhados pelos serviços do Módulo de Retenção.
 *
 * SEM dependências de I/O — testáveis isoladamente sem Sequelize, sem
 * baileys, sem rede. Funções com I/O ficam em `_shared.ts`.
 *
 * Inclui o fix do BUG B3 (timezone-aware fire window).
 */

import moment from "moment-timezone";
import { CouponDiscountType } from "../../models/Coupon";

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Janela de tolerância em minutos após o horário configurado.
 * Garante que um cron de 1-minuto não perca o disparo se houver
 * pequeno atraso de processamento (~30-60s).
 */
export const FIRE_WINDOW_MINUTES = 2;

/** Timezone default quando empresa não configurou. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

// ── Date helpers ───────────────────────────────────────────────────

/**
 * Adiciona dias a uma data. Imutável (retorna nova Date).
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Verifica se o "agora" está dentro da janela de disparo configurada,
 * respeitando o timezone da empresa.
 *
 * @param configuredTime String "HH:mm" definida pelo admin (no fuso da empresa)
 * @param timezone IANA timezone (ex: "America/Sao_Paulo"). Default: BR.
 * @param now Data de referência. Default: agora.
 * @param windowMinutes Tolerância pós-horário. Default: 2.
 * @returns true se está na janela
 *
 * @example
 *   // Admin configurou 09:00, servidor está UTC, agora é 12:00Z = 09:00 BR
 *   isWithinFireWindow("09:00", "America/Sao_Paulo") // → true
 */
export function isWithinFireWindow(
  configuredTime: string,
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
  windowMinutes: number = FIRE_WINDOW_MINUTES
): boolean {
  const [hStr, mStr] = configuredTime.split(":");
  const targetH = parseInt(hStr || "0", 10);
  const targetM = parseInt(mStr || "0", 10);
  const configuredMinutes = targetH * 60 + targetM;

  // Converte 'now' para o timezone da empresa e extrai HH:mm
  const inTz = moment(now).tz(timezone);
  const currentMinutes = inTz.hours() * 60 + inTz.minutes();

  const diff = currentMinutes - configuredMinutes;
  return diff >= 0 && diff <= windowMinutes;
}

// ── Coupon discount helpers ────────────────────────────────────────

/**
 * Formata uma label amigável para o tipo + valor de desconto.
 */
export function formatDiscountLabel(
  type: CouponDiscountType,
  value: number
): string {
  switch (type) {
    case "percent":
      return `${value}% OFF`;
    case "fixed":
      return `R$ ${value.toFixed(2)} OFF`;
    case "free_service":
      return "SERVIÇO GRÁTIS";
    default:
      return `${value}% OFF`;
  }
}

/**
 * Valida e normaliza um CouponDiscountType vindo de Setting.
 * Retorna o default se inválido.
 */
export function safeCouponDiscountType(
  raw: string | undefined,
  fallback: CouponDiscountType = "percent"
): CouponDiscountType {
  const validTypes: CouponDiscountType[] = ["percent", "fixed", "free_service"];
  if (raw && validTypes.includes(raw as CouponDiscountType)) {
    return raw as CouponDiscountType;
  }
  return fallback;
}

/**
 * Valida um timezone IANA. Retorna o default se inválido ou ausente.
 */
export function safeTimezone(raw: string | undefined): string {
  if (raw && moment.tz.zone(raw)) return raw;
  return DEFAULT_TIMEZONE;
}
