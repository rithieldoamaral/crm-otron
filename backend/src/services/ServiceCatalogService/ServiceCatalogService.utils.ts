/**
 * ServiceCatalogService.utils — Funções puras do catálogo de serviços.
 *
 * Estas funções NÃO importam Sequelize, wbot, Ticket, nem qualquer I/O.
 * São testáveis isoladamente via Jest sem mocks de banco de dados.
 *
 * Responsabilidades:
 *   - `formatPrice`          — Formata valor decimal como Real Brasileiro
 *   - `resolveHistoryValue`  — Determina o valor a gravar no ServiceHistory
 *   - `normalizePrice`       — Valida e normaliza entrada de preço do usuário
 *
 * Diretiva: referenciada em `docs/DEPLOY_DOCKER_CONTABO.md` §11 (Fase 5).
 */

// ── formatPrice ──────────────────────────────────────────────────────────────

/**
 * Formata um valor decimal como preço em Real Brasileiro (R$).
 *
 * Usa formatação manual (não toLocaleString) para garantir comportamento
 * determinístico em ambientes de CI/CD sem locale pt-BR configurado.
 *
 * @param value - Valor numérico positivo
 * @returns String no formato "R$ X.XXX,XX"
 *
 * @example
 *   formatPrice(40)       // "R$ 40,00"
 *   formatPrice(1234.99)  // "R$ 1.234,99"
 */
export function formatPrice(value: number): string {
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  // Insere ponto como separador de milhar a cada 3 dígitos
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFormatted},${decPart}`;
}

// ── resolveHistoryValue ───────────────────────────────────────────────────────

/**
 * Determina o valor monetário a gravar em um registro de ServiceHistory.
 *
 * Regras de prioridade:
 *   1. Se `explicitValue` foi informado (inclusive 0, que representa serviço gratuito) → usa ele.
 *   2. Se `explicitValue` é undefined ou null → usa `servicePrice` do catálogo.
 *   3. Se ambos são ausentes → null (ServiceHistory sem valor financeiro).
 *
 * @param explicitValue - Valor explícito passado pelo chamador (override manual)
 * @param servicePrice  - Preço cadastrado no catálogo (pode vir como string do Sequelize DECIMAL)
 * @returns Valor numérico a gravar, ou null se nenhum disponível
 *
 * @example
 *   resolveHistoryValue(50, 40)         // 50  (override explícito)
 *   resolveHistoryValue(0, 40)          // 0   (serviço gratuito override)
 *   resolveHistoryValue(undefined, 40)  // 40  (fallback para catálogo)
 *   resolveHistoryValue(null, null)     // null (sem valor)
 */
export function resolveHistoryValue(
  explicitValue: number | undefined | null,
  servicePrice: number | string | undefined | null
): number | null {
  // Valor explícito (incluindo 0) tem prioridade sobre o catálogo
  if (explicitValue !== undefined && explicitValue !== null) {
    return explicitValue;
  }

  // Fallback: preço do catálogo de serviços
  // Sequelize retorna DECIMAL como string → converter para number
  if (servicePrice !== undefined && servicePrice !== null) {
    const asNumber = Number(servicePrice);
    return isNaN(asNumber) ? null : asNumber;
  }

  return null;
}

// ── normalizePrice ────────────────────────────────────────────────────────────

/**
 * Valida e normaliza o preço de um serviço recebido do formulário.
 *
 * Aceita: number, string numérica com ponto decimal.
 * Rejeita: valores negativos, NaN, strings não-numéricas, null, undefined, "".
 *
 * Nota: strings com vírgula (pt-BR) retornam apenas a parte inteira
 * (parseFloat para no primeiro caractere não-numérico). O frontend deve
 * enviar preços com ponto como separador decimal.
 *
 * @param raw - Valor bruto recebido do usuário (campo de formulário)
 * @returns Preço normalizado com 2 casas decimais, ou null se inválido
 *
 * @example
 *   normalizePrice(40)       // 40
 *   normalizePrice("40.50") // 40.5
 *   normalizePrice(-5)      // null
 *   normalizePrice("abc")   // null
 *   normalizePrice(null)    // null
 */
export function normalizePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;

  const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));

  if (isNaN(parsed) || parsed < 0) return null;

  // Arredonda para 2 casas decimais (evita problemas de ponto flutuante)
  return Math.round(parsed * 100) / 100;
}
