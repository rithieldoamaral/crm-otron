/**
 * Contador de mensagens em memória por-companyId para disparo periódico
 * da unificação de contatos duplicados.
 *
 * PORQUÊ: `handleMessage` disparava a dedup "a cada 1000 mensagens" usando
 * `Message.count({ where: { companyId } })` — uma query que varre uma tabela
 * crescente A CADA mensagem recebida. Em produção com alto volume isso é caro
 * e piora com o tempo. Substituímos a contagem no banco por um contador em
 * memória incrementado por mensagem: a mesma cadência (a cada N mensagens)
 * sem tocar o banco no caminho quente.
 *
 * LIMITAÇÃO CONHECIDA (tech debt aceito): o contador é por-instância e reseta
 * em restart. Isso é aceitável porque a dedup é apenas uma limpeza periódica
 * best-effort (não afeta correção de dados), e o comportamento anterior baseado
 * em `Message.count` já não garantia exatamente "a cada 1000" sob concorrência.
 * Para robustez multi-instância, migrar para `cacheLayer` (Redis INCR) no futuro.
 */

/** Cadência padrão: dispara a dedup a cada N mensagens por empresa. */
export const DEDUP_INTERVAL = 1000;

/** Contador em memória por companyId. */
const messageCounters = new Map<number, number>();

/**
 * Incrementa o contador da empresa e decide se a dedup deve rodar agora.
 *
 * A decisão é determinística dado o estado interno: retorna `true` exatamente
 * quando o contador cruza um múltiplo de `interval`.
 *
 * @param companyId - ID da empresa cuja mensagem foi recebida.
 * @param interval - Cadência do disparo (padrão `DEDUP_INTERVAL`). Deve ser > 0.
 * @returns `true` se a unificação de contatos deve ser executada nesta mensagem.
 *
 * @example
 * // Com interval=3, retorna true na 3ª, 6ª, 9ª... chamada.
 * shouldRunDedup(1, 3); // false (count=1)
 * shouldRunDedup(1, 3); // false (count=2)
 * shouldRunDedup(1, 3); // true  (count=3)
 */
export const shouldRunDedup = (
  companyId: number,
  interval: number = DEDUP_INTERVAL
): boolean => {
  if (interval <= 0) {
    // Cadência inválida desabilita o disparo em vez de dividir por zero.
    return false;
  }

  const next = (messageCounters.get(companyId) || 0) + 1;
  messageCounters.set(companyId, next);

  return next % interval === 0;
};

/**
 * Reseta o contador de uma empresa (ou de todas). Usado em testes e disponível
 * para eventual limpeza de memória de empresas inativas.
 *
 * @param companyId - Se informado, reseta apenas essa empresa; senão, todas.
 */
export const resetDedupCounter = (companyId?: number): void => {
  if (companyId === undefined) {
    messageCounters.clear();
    return;
  }
  messageCounters.delete(companyId);
};
