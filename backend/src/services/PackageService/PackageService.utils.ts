/**
 * PackageService.utils — Funções puras para o módulo de pacotes de sessões.
 *
 * Zero I/O. Sem imports de Sequelize, wbot ou baileys.
 * Todas as funções são determinísticas e testáveis isoladamente.
 *
 * Responsabilidades:
 *   - `calculateSessionsRemaining` — quanto falta no pacote
 *   - `derivePackageStatus`        — status calculado (active/completed/expired)
 *   - `shouldSendLowBalanceAlert`  — quando alertar sobre saldo baixo
 *   - `buildSessionBalanceMessage` — mensagem WhatsApp pós-sessão
 *   - `buildCompletionMessage`     — mensagem ao completar o pacote
 *   - `buildLowBalanceAlertMessage`— mensagem de alerta de saldo baixo
 *   - `calculatePackageDiscount`   — desconto percentual vs preço avulso
 *
 * Diretiva: Fase 6 — Pacotes de Sessões.
 */

export type PackageStatus = "active" | "completed" | "expired" | "cancelled";

// ── calculateSessionsRemaining ────────────────────────────────────────────────

/**
 * Calcula o número de sessões restantes em um pacote.
 * Nunca retorna negativo — guard contra sessões over-consumidas.
 *
 * @param totalSessions - Total de sessões contratadas no pacote
 * @param sessionsUsed  - Sessões já consumidas
 * @returns Sessões restantes (≥ 0)
 *
 * @example
 *   calculateSessionsRemaining(10, 3)  // 7
 *   calculateSessionsRemaining(10, 10) // 0
 */
export function calculateSessionsRemaining(
  totalSessions: number,
  sessionsUsed: number
): number {
  return Math.max(0, totalSessions - sessionsUsed);
}

// ── derivePackageStatus ───────────────────────────────────────────────────────

/**
 * Determina o status calculado de um pacote de compra.
 *
 * Prioridade:
 *   1. Expirado (data de validade ultrapassada)
 *   2. Concluído (todas as sessões utilizadas)
 *   3. Ativo (ainda há sessões restantes e não expirou)
 *
 * Nota: o status "cancelled" é definido por ação explícita do admin,
 * nunca calculado automaticamente por esta função.
 *
 * @param sessionsUsed    - Sessões já consumidas
 * @param totalSessions   - Total de sessões do pacote
 * @param expiresAt       - Data de expiração (nullable)
 * @param referenceDate   - Data de referência (default: agora). Para testes.
 * @returns Status derivado: "active" | "completed" | "expired"
 *
 * @example
 *   derivePackageStatus(3, 10)  // "active"
 *   derivePackageStatus(10, 10) // "completed"
 *   derivePackageStatus(3, 10, new Date("2020-01-01")) // "expired"
 */
export function derivePackageStatus(
  sessionsUsed: number,
  totalSessions: number,
  expiresAt?: Date | null,
  referenceDate?: Date
): Exclude<PackageStatus, "cancelled"> {
  const now = referenceDate ?? new Date();

  if (expiresAt && now > expiresAt) return "expired";
  if (sessionsUsed >= totalSessions) return "completed";
  return "active";
}

// ── hasActivePackage ──────────────────────────────────────────────────────────

/**
 * Subconjunto mínimo de ClientPackagePurchase necessário para decidir se um
 * pacote está ativo. Mantido estrutural (não importa o model) para preservar a
 * pureza deste arquivo — testável sem Sequelize.
 */
export interface PackagePurchaseLike {
  sessionsUsed: number;
  totalSessions: number;
  expiresAt?: Date | null;
  /** Status persistido. Só usado para excluir 'cancelled' (decisão manual do admin). */
  status?: PackageStatus | string;
}

/**
 * Indica se o cliente tem AO MENOS UM pacote de sessões ativo.
 *
 * Um pacote é "ativo" quando ainda há sessões restantes e não expirou —
 * derivado via `derivePackageStatus`, NÃO pelo campo `status` persistido (que
 * pode estar desatualizado se o pacote expirou sem um recálculo). O único uso do
 * `status` persistido é excluir compras 'cancelled', pois o cancelamento é uma
 * ação manual do admin que `derivePackageStatus` nunca produz automaticamente.
 *
 * Guard de retenção (Tier 2): clientes com pacote ativo estão engajados
 * (compraram e estão consumindo) e NÃO devem ser classificados como
 * adormecidos/perdidos nem receber campanha de winback com desconto.
 *
 * @param purchases     - Compras de pacote do cliente (de listClientPurchases)
 * @param referenceDate - Data de referência para "hoje" (default: agora). Para testes.
 * @returns true se houver pelo menos um pacote ativo na data de referência
 *
 * @example
 *   hasActivePackage([{ sessionsUsed: 3, totalSessions: 10, expiresAt: null }]) // true
 *   hasActivePackage([{ sessionsUsed: 10, totalSessions: 10, expiresAt: null }]) // false
 */
export function hasActivePackage(
  purchases: PackagePurchaseLike[] | null | undefined,
  referenceDate?: Date
): boolean {
  if (!purchases || purchases.length === 0) return false;

  return purchases.some((p) => {
    // Cancelamento é decisão explícita do admin — nunca é "ativo".
    if (p.status === "cancelled") return false;

    const derived = derivePackageStatus(
      p.sessionsUsed,
      p.totalSessions,
      p.expiresAt ?? null,
      referenceDate
    );
    return derived === "active";
  });
}

// ── shouldSendLowBalanceAlert ─────────────────────────────────────────────────

/**
 * Decide se deve enviar alerta de saldo baixo após consumo de sessão.
 *
 * Limiar adaptativo: alerta quando restam ≤ min(2, 20% do pacote), mínimo 1.
 * Não alerta quando remaining = 0 (usa buildCompletionMessage nesse caso).
 *
 * Exemplos de limiar:
 *   10 sessões → alerta em ≤ 2 restantes (20% = 2)
 *   5  sessões → alerta em ≤ 1 restante  (20% = 1)
 *   3  sessões → alerta em ≤ 1 restante  (20% = 0 → mínimo 1)
 *
 * @param sessionsRemaining - Sessões restantes APÓS o consumo
 * @param totalSessions     - Total de sessões do pacote
 * @returns true se deve disparar alerta de saldo baixo
 */
export function shouldSendLowBalanceAlert(
  sessionsRemaining: number,
  totalSessions: number
): boolean {
  if (sessionsRemaining <= 0) return false; // 0 usa buildCompletionMessage

  const threshold = Math.min(
    2,
    Math.max(1, Math.floor(totalSessions * 0.2))
  );

  return sessionsRemaining <= threshold;
}

// ── buildSessionBalanceMessage ────────────────────────────────────────────────

/**
 * Monta a mensagem WhatsApp enviada ao cliente após cada sessão consumida.
 *
 * Se não há sessões restantes (pacote completo), delega para buildCompletionMessage.
 *
 * @param clientName    - Nome do cliente
 * @param serviceName   - Nome do serviço (ex: "Depilação a Laser")
 * @param sessionsUsed  - Sessões usadas APÓS o consumo atual (inclui a atual)
 * @param totalSessions - Total de sessões do pacote
 * @returns Mensagem formatada para WhatsApp
 *
 * @example
 *   buildSessionBalanceMessage("Ana", "Depilação", 3, 10)
 *   // "Olá, Ana! ✅ Registramos sua sessão de *Depilação* (3/10).\n
 *   //  Você ainda tem *7 sessões* disponíveis."
 */
export function buildSessionBalanceMessage(
  clientName: string,
  serviceName: string,
  sessionsUsed: number,
  totalSessions: number
): string {
  const remaining = calculateSessionsRemaining(totalSessions, sessionsUsed);

  if (remaining === 0) {
    return buildCompletionMessage(clientName, serviceName);
  }

  const sessionWord = remaining === 1 ? "sessão" : "sessões";
  return (
    `Olá, ${clientName}! ✅ Registramos sua sessão de *${serviceName}* ` +
    `(${sessionsUsed}/${totalSessions}).\n` +
    `Você ainda tem *${remaining} ${sessionWord}* disponível.`
  );
}

// ── buildCompletionMessage ────────────────────────────────────────────────────

/**
 * Monta a mensagem enviada ao concluir todas as sessões do pacote.
 *
 * @param clientName  - Nome do cliente
 * @param serviceName - Nome do serviço
 * @returns Mensagem de parabéns + CTA para renovação
 *
 * @example
 *   buildCompletionMessage("Ana", "Depilação a Laser")
 *   // "Parabéns, Ana! 🎉 Você concluiu seu pacote de *Depilação a Laser*. ..."
 */
export function buildCompletionMessage(
  clientName: string,
  serviceName: string
): string {
  return (
    `Parabéns, ${clientName}! 🎉 Você concluiu seu pacote de *${serviceName}*.\n` +
    `Que tal renovar? Entre em contato conosco para aproveitar nossas ofertas! 😊`
  );
}

// ── buildLowBalanceAlertMessage ───────────────────────────────────────────────

/**
 * Monta o alerta de saldo baixo (poucas sessões restantes).
 *
 * @param clientName         - Nome do cliente
 * @param serviceName        - Nome do serviço
 * @param sessionsRemaining  - Sessões restantes (> 0)
 * @returns Mensagem de alerta formatada para WhatsApp
 *
 * @example
 *   buildLowBalanceAlertMessage("Ana", "Depilação", 2)
 *   // "Olá, Ana! Lembrete: você tem apenas *2 sessões* restante(s) ..."
 */
export function buildLowBalanceAlertMessage(
  clientName: string,
  serviceName: string,
  sessionsRemaining: number
): string {
  const sessionWord = sessionsRemaining === 1 ? "sessão" : "sessões";
  return (
    `Olá, ${clientName}! Lembrete: você tem apenas *${sessionsRemaining} ${sessionWord}* ` +
    `restante(s) do seu pacote de *${serviceName}*. 💡 ` +
    `Renove agora para não perder a continuidade do tratamento!`
  );
}

// ── calculatePackageDiscount ──────────────────────────────────────────────────

/**
 * Calcula o desconto percentual de um pacote em relação ao preço avulso.
 *
 * @param unitPrice     - Preço de uma sessão avulsa (do catálogo) — pode ser null
 * @param totalSessions - Número de sessões do pacote
 * @param packagePrice  - Preço total cobrado pelo pacote
 * @returns Desconto em % (inteiro, 0-100), ou null se unitPrice não disponível
 *
 * @example
 *   calculatePackageDiscount(40, 10, 300)  // 25  (seria R$400 avulso → 25% off)
 *   calculatePackageDiscount(40, 10, 400)  // 0   (sem desconto)
 *   calculatePackageDiscount(null, 10, 300) // null
 */
export function calculatePackageDiscount(
  unitPrice: number | null,
  totalSessions: number,
  packagePrice: number
): number | null {
  if (unitPrice == null || unitPrice === 0) return null;

  const regularTotal = unitPrice * totalSessions;

  if (packagePrice >= regularTotal) return 0;

  return Math.round(((regularTotal - packagePrice) / regularTotal) * 100);
}

// ── parseOptionalDate ─────────────────────────────────────────────────────────

/**
 * Parseia uma string opcional para `Date`, lançando erro descritivo se inválida.
 *
 * Comportamento:
 *   - undefined/null/string vazia → retorna `undefined` (campo opcional)
 *   - string ISO válida → retorna `Date`
 *   - string inválida → lança `Error` com `fieldName` (controller vira 400, não 500)
 *
 * Usado nos controllers para defender contra `new Date("xyz")` que silenciosamente
 * produz `Invalid Date` e quebra Sequelize com erro genérico 500 (CLAUDE.md §II.5).
 *
 * @param raw       - Valor bruto do body/query (qualquer tipo)
 * @param fieldName - Nome do campo (usado na mensagem de erro)
 * @returns Date válido ou undefined
 * @throws Error("Invalid date for field 'X'") se string não parseável
 *
 * @example
 *   parseOptionalDate("2026-05-22", "purchasedAt")  // Date válido
 *   parseOptionalDate(undefined, "purchasedAt")      // undefined
 *   parseOptionalDate("xyz", "purchasedAt")          // throws Error
 */
export function parseOptionalDate(
  raw: unknown,
  fieldName: string
): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" && !(raw instanceof Date)) {
    throw new Error(`Invalid date type for field '${fieldName}'`);
  }
  const d = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date for field '${fieldName}'`);
  }
  return d;
}
