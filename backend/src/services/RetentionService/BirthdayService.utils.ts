/**
 * BirthdayService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para testes unitários sem Sequelize, WhatsApp ou cron.
 * A orquestração I/O vive em `BirthdayIntelligentService.ts`.
 *
 * Responsabilidades:
 *   - `extractMonthDay`        — parsing limpo e robusto de datas de aniversário
 *   - `getDayOffsetFromBirthday` — quantos dias faltam/passaram em relação ao aniversário
 *   - `whichTouchToFire`       — qual dos 3 toques disparar dado o offset
 *   - `buildTouchMessage`      — monta a mensagem para cada toque
 */

import { BirthdayTouchType } from "../../models/BirthdayTouch";

// ── Types ──────────────────────────────────────────────────────────

export interface TouchMessageParams {
  touchType: BirthdayTouchType;
  contactName: string;
  /** Template configurado pelo admin para o toque D-0 (corpo principal) */
  birthdayMessageTemplate: string;
  /** Código do cupom gerado (apenas no D-0) */
  couponCode?: string;
  /** Dias de validade restantes do cupom (apenas D+7) */
  couponDaysLeft?: number;
}

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Offsets (dias em relação ao aniversário) que acionam cada toque.
 * Positivo = dias antes; negativo = dias depois.
 */
export const TOUCH_OFFSETS: Record<BirthdayTouchType, number> = {
  dm3: -3,   // 3 dias ANTES (negativo = futuro)
  d0: 0,    // no dia
  dp7: 7    // 7 dias DEPOIS (positivo = passado)
};

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Extrai "MM-DD" de um valor de data de aniversário do banco.
 *
 * Trata os formatos reais encontrados no Sequelize:
 *   - string "YYYY-MM-DD"
 *   - string "YYYY-MM-DD HH:mm:ss" (com parte de hora)
 *   - objeto Date nativo
 *
 * Usa extração de string direta quando possível para evitar problemas
 * de timezone que afetam `Date.getMonth()` / `Date.getDate()`.
 *
 * @param birthday Valor bruto do campo `contact.birthday`
 * @returns "MM-DD" (ex: "05-19") ou null se inválido
 *
 * @example
 *   extractMonthDay("1990-05-19")           // → "05-19"
 *   extractMonthDay("1990-05-19 00:00:00")  // → "05-19"
 *   extractMonthDay(new Date("1990-05-19")) // → "05-19"
 *   extractMonthDay(null)                   // → null
 */
export function extractMonthDay(birthday: Date | string | null | undefined): string | null {
  if (!birthday) return null;

  // String no formato YYYY-MM-DD (com ou sem parte de hora)
  if (typeof birthday === "string") {
    const dateOnly = birthday.trim().split(" ")[0].split("T")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      const parts = dateOnly.split("-");
      return `${parts[1]}-${parts[2]}`; // MM-DD
    }
    // Fallback: tenta construir Date a partir da string
    const d = new Date(birthday);
    if (isNaN(d.getTime())) return null;
    // Usa UTC para evitar offset de timezone
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${month}-${day}`;
  }

  // Date object
  if (birthday instanceof Date) {
    if (isNaN(birthday.getTime())) return null;
    const month = String(birthday.getUTCMonth() + 1).padStart(2, "0");
    const day = String(birthday.getUTCDate()).padStart(2, "0");
    return `${month}-${day}`;
  }

  return null;
}

/**
 * Calcula o offset em dias entre `now` e o aniversário deste ano.
 *
 * Semântica:
 *   - Negativo → aniversário está no FUTURO (ex: -3 = daqui 3 dias)
 *   - Zero     → aniversário é HOJE
 *   - Positivo → aniversário PASSOU há X dias (ex: 7 = foi há 7 dias)
 *
 * Considera o aniversário no ANO CORRENTE de `now`.
 * Se a data resultante fosse em ano diferente (ex: 29/fev em ano não-bissexto),
 * usa o último dia de fevereiro (28/fev).
 *
 * @param birthdayMonthDay "MM-DD" extraído por `extractMonthDay`
 * @param now Data de referência (default: hoje)
 * @returns Número de dias de diferença (pode ser negativo, zero ou positivo)
 *
 * @example
 *   // Birthday = 19/05, hoje = 16/05 → faltam 3 dias → offset = -3
 *   getDayOffsetFromBirthday("05-19", new Date("2026-05-16")) // → -3
 *
 *   // Birthday = 19/05, hoje = 19/05 → é hoje → offset = 0
 *   getDayOffsetFromBirthday("05-19", new Date("2026-05-19")) // → 0
 *
 *   // Birthday = 19/05, hoje = 26/05 → passou 7 dias → offset = 7
 *   getDayOffsetFromBirthday("05-19", new Date("2026-05-26")) // → 7
 */
export function getDayOffsetFromBirthday(
  birthdayMonthDay: string,
  now: Date = new Date()
): number {
  const [monthStr, dayStr] = birthdayMonthDay.split("-");
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const year = now.getUTCFullYear();

  // Constrói a data do aniversário neste ano (UTC para evitar timezone)
  const bday = new Date(Date.UTC(year, month - 1, day));

  // Normaliza 'now' para meia-noite UTC
  const nowMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  // positivo = bday passou (passado), negativo = bday ainda vem (futuro)
  return Math.round((nowMidnight.getTime() - bday.getTime()) / MS_PER_DAY);
}

/**
 * Determina qual toque deve ser disparado dado o offset calculado.
 *
 * | Offset | Toque |
 * |--------|-------|
 * | -3     | dm3   |
 * | 0      | d0    |
 * | 7      | dp7   |
 * | outro  | null  |
 *
 * @param offset Resultado de `getDayOffsetFromBirthday`
 * @returns BirthdayTouchType ou null se nenhum toque deve ser disparado
 *
 * @example
 *   whichTouchToFire(-3) // → "dm3"
 *   whichTouchToFire(0)  // → "d0"
 *   whichTouchToFire(7)  // → "dp7"
 *   whichTouchToFire(1)  // → null
 */
export function whichTouchToFire(offset: number): BirthdayTouchType | null {
  if (offset === -3) return "dm3";
  if (offset === 0) return "d0";
  if (offset === 7) return "dp7";
  return null;
}

/**
 * Monta a mensagem para cada um dos 3 toques.
 *
 * Suporta variáveis no template D-0:
 *   {{name}}  — nome do contato
 *   {{coupon}} — código do cupom gerado
 *
 * @param params TouchMessageParams
 * @returns Texto final pronto para envio via WhatsApp
 *
 * @example
 *   buildTouchMessage({
 *     touchType: "d0",
 *     contactName: "Maria",
 *     birthdayMessageTemplate: "Parabéns {{name}}! Seu presente: {{coupon}} 🎁",
 *     couponCode: "ANIVER-AB12-CD34"
 *   })
 *   // → "Parabéns Maria! Seu presente: ANIVER-AB12-CD34 🎁"
 */
export function buildTouchMessage(params: TouchMessageParams): string {
  const {
    touchType,
    contactName,
    birthdayMessageTemplate,
    couponCode,
    couponDaysLeft
  } = params;

  const name = contactName || "Cliente";

  switch (touchType) {
    case "dm3":
      return (
        `Olá, ${name}! 🎉 Seu aniversário está chegando em 3 dias. ` +
        `Temos uma surpresa especial preparada para você. Aguarde! 🎁`
      );

    case "d0": {
      // Usa o template configurado pelo admin, substituindo variáveis
      let msg = birthdayMessageTemplate
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{nome\}\}/g, name);
      if (couponCode) {
        msg = msg.replace(/\{\{coupon\}\}/g, couponCode);
        msg = msg.replace(/\{\{cupom\}\}/g, couponCode);
        // Se o template não tem placeholder de cupom, adiciona ao final
        if (!msg.includes(couponCode)) {
          msg += `\n\n🎁 Presente especial de aniversário: *${couponCode}*\nVálido por 30 dias!`;
        }
      }
      return msg;
    }

    case "dp7": {
      const daysText = couponDaysLeft && couponDaysLeft > 0
        ? `Ainda ${couponDaysLeft} dias`
        : "Seu cupom ainda está disponível";
      const couponText = couponCode
        ? `\n🎁 Código: *${couponCode}* — ${daysText}!`
        : "";
      return (
        `Olá, ${name}! 😊 Esperamos que tenha aproveitado muito seu aniversário!` +
        `${couponText}\n\nAguardamos sua visita! ❤️`
      );
    }

    default:
      return "";
  }
}
