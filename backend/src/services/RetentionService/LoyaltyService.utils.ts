/**
 * LoyaltyService — lógica PURA, sem dependências de I/O.
 *
 * Isolada para testes unitários sem Sequelize.
 *
 * Responsabilidades:
 *   - `parseMilestones`           — parseia string de marcos (ex: "5,10,20,50")
 *   - `getNewlyReachedMilestones` — quais marcos foram atingidos com este serviço
 *   - `buildLoyaltyMessage`       — monta mensagem de parabéns + cupom
 */

// ── Constantes ─────────────────────────────────────────────────────

/**
 * Marcos default do programa de fidelidade.
 * Espaçamento intencional: marcos próximos no início (motivar engajamento),
 * mais espaçados depois (manter exclusividade).
 */
export const DEFAULT_MILESTONES = [5, 10, 20, 50, 100];

// ── Types ──────────────────────────────────────────────────────────

export interface LoyaltyMessageParams {
  contactName: string;
  milestone: number;
  /** Código do cupom de recompensa */
  couponCode?: string;
  /** Template configurado pelo admin (suporta {{name}}, {{milestone}}, {{coupon}}) */
  template?: string;
}

// ── Funções Puras ──────────────────────────────────────────────────

/**
 * Parseia string de marcos vinda de Setting (ex: "5,10,20,50").
 * Retorna array ordenado de inteiros positivos únicos.
 *
 * Tolerante a entradas inválidas:
 *   - espaços, vírgulas extras, valores não-numéricos são ignorados
 *   - valores zero ou negativos são descartados
 *   - duplicatas são removidas
 *
 * @example
 *   parseMilestones("5, 10, 20")     // → [5, 10, 20]
 *   parseMilestones("10,5,5,20")      // → [5, 10, 20]
 *   parseMilestones("abc,10,-1,5")   // → [5, 10]
 *   parseMilestones("")              // → [] (chamador deve usar DEFAULT_MILESTONES)
 */
export function parseMilestones(raw: string | undefined | null): number[] {
  if (!raw || typeof raw !== "string") return [];
  const parts = raw.split(",").map(s => s.trim());
  const numbers = new Set<number>();
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!isNaN(n) && n > 0) numbers.add(n);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Determina quais marcos foram NEWLY atingidos por este serviço.
 *
 * Lógica:
 *   - Considera marcos cujo valor é EXATAMENTE igual a totalServices.
 *   - Se múltiplos marcos foram pulados (ex: cliente foi de 4 para 7 sem
 *     processamento intermediário), retorna todos os marcos atingidos
 *     que ainda não foram recompensados.
 *
 * @param totalServices Total atual de serviços do cliente (após este novo)
 * @param previousTotal Total ANTES deste serviço (para detectar marcos pulados)
 * @param milestones Lista de marcos configurados (ordenada)
 * @param alreadyRewarded Marcos já recompensados anteriormente
 * @returns Marcos NOVOS atingidos (ordenados ascendente)
 *
 * @example
 *   // Cliente foi de 4 para 5 serviços
 *   getNewlyReachedMilestones(5, 4, [5, 10, 20], [])  // → [5]
 *
 *   // Cliente foi de 9 para 10 serviços
 *   getNewlyReachedMilestones(10, 9, [5, 10, 20], [5])  // → [10]
 *
 *   // Pulo: foi de 8 para 11 (caso raro)
 *   getNewlyReachedMilestones(11, 8, [5, 10, 20], [5])  // → [10]
 *
 *   // Já recompensado
 *   getNewlyReachedMilestones(10, 9, [5, 10], [5, 10])  // → []
 */
export function getNewlyReachedMilestones(
  totalServices: number,
  previousTotal: number,
  milestones: number[],
  alreadyRewarded: number[]
): number[] {
  const rewardedSet = new Set(alreadyRewarded);
  // Sort defensivamente: garante contrato de retorno ordenado mesmo se o
  // chamador passar `milestones` desordenado (parseMilestones já ordena,
  // mas outros chamadores podem não).
  return milestones
    .filter(m => m > previousTotal && m <= totalServices && !rewardedSet.has(m))
    .sort((a, b) => a - b);
}

/**
 * Monta a mensagem de parabéns com o cupom de fidelidade.
 *
 * @example
 *   buildLoyaltyMessage({
 *     contactName: "Maria",
 *     milestone: 10,
 *     couponCode: "FIEL-AB12-CD34"
 *   })
 */
export function buildLoyaltyMessage(params: LoyaltyMessageParams): string {
  const name = params.contactName || "Cliente";
  const milestone = params.milestone;
  const coupon = params.couponCode || "";

  if (params.template && params.template.trim().length > 0) {
    let msg = params.template
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{nome\}\}/g, name)
      .replace(/\{\{milestone\}\}/g, String(milestone))
      .replace(/\{\{marco\}\}/g, String(milestone))
      .replace(/\{\{coupon\}\}/g, coupon)
      .replace(/\{\{cupom\}\}/g, coupon);

    // Garante que o cupom apareça (se o template não tem placeholder)
    if (coupon && !msg.includes(coupon)) {
      msg += `\n\n🎁 Seu cupom de fidelidade: *${coupon}*`;
    }
    return msg;
  }

  // Mensagem padrão
  const couponPart = coupon
    ? `\n\n🎁 Seu cupom de fidelidade: *${coupon}*\nVálido por 60 dias!`
    : "";
  return (
    `Parabéns, ${name}! 🎉 Você acabou de completar seu serviço de número ${milestone} ` +
    `conosco! Sua fidelidade é muito especial para a gente.${couponPart}`
  );
}
