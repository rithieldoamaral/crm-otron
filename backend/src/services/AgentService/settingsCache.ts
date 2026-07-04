/**
 * settingsCache — cache em memória de Settings por empresa.
 *
 * Escalabilidade P0: loadProviderConfig e loadAgentSettings (knowledgeBuilder)
 * chamavam Setting.findAll({ where: { companyId } }) INDEPENDENTEMENTE em cada
 * handleClientAgent. Com 20 clientes da mesma empresa = 40 queries idênticas/turno.
 *
 * Este módulo centraliza e deduplica essas leituras com TTL de 30s.
 * A invalidação acontece automaticamente por expiração; admins que alteram
 * settings veem a mudança em até 30s (aceitável para configuração estática).
 *
 * clearSettingsCache() é exportada para uso em beforeEach nos testes,
 * garantindo isolamento entre casos de teste que mocam Setting.findAll.
 */

import Setting from "../../models/Setting";
import GlobalSetting from "../../models/GlobalSetting";

/** TTL em milissegundos — 30s equilibra freshness e redução de queries */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  rows: Array<{ key: string; value: string }>;
  expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

// Cache separado para settings globais (plataforma)
let globalCacheEntry: CacheEntry | null = null;

/**
 * Limpa todo o cache de settings (empresa + global).
 * Deve ser chamado em `beforeEach` nos testes que mocam Setting.findAll,
 * para garantir que cada teste parte de um cache vazio.
 */
export function clearSettingsCache(): void {
  cache.clear();
  globalCacheEntry = null;
}

/**
 * Retorna todas as Settings de uma empresa, usando cache com TTL de 30s.
 *
 * @param companyId - ID da empresa
 * @returns Array de { key, value } — mesma forma que Setting.findAll retorna
 *
 * @example
 * const rows = await getSettingsByCompany(2);
 * const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
 */
export async function getSettingsByCompany(
  companyId: number
): Promise<Array<{ key: string; value: string }>> {
  const entry = cache.get(companyId);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.rows;
  }

  const dbRows = await Setting.findAll({ where: { companyId } });
  const rows = dbRows.map((r: any) => ({ key: r.key, value: r.value }));

  cache.set(companyId, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

/**
 * Retorna todas as GlobalSettings da plataforma, usando cache com TTL de 30s.
 *
 * GlobalSettings são definidas pelo super admin e aplicadas a todas as empresas.
 * Chaves esperadas: globalAgentProvider, globalAgentApiKey, globalAgentModel,
 *                   globalSecretaryProvider, globalSecretaryApiKey, globalSecretaryModel.
 *
 * @returns Array de { key, value }
 *
 * @example
 * const rows = await getGlobalSettings();
 * const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
 * const model = map.globalAgentModel ?? "claude-haiku-4-5-20251001";
 */
export async function getGlobalSettings(): Promise<Array<{ key: string; value: string }>> {
  if (globalCacheEntry && Date.now() < globalCacheEntry.expiresAt) {
    return globalCacheEntry.rows;
  }

  const dbRows = await GlobalSetting.findAll();
  const rows = dbRows.map((r: any) => ({ key: r.key, value: r.value }));

  globalCacheEntry = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return rows;
}

/**
 * Invalida o cache de settings de uma empresa imediatamente.
 * Deve ser chamado após PUT /settings/:key para efeito imediato.
 *
 * Sem esta chamada, o agente serviria o nome/personalidade antigo por até 30s
 * após o admin salvar novas configurações (ex: trocar "Sofia" → "Amanda").
 *
 * @param companyId - ID da empresa cujo cache deve ser descartado
 */
export function invalidateCompanyCache(companyId: number): void {
  cache.delete(companyId);
}

/**
 * Invalida o cache global imediatamente.
 * Deve ser chamado após PUT /global-settings para efeito imediato.
 */
export function invalidateGlobalCache(): void {
  globalCacheEntry = null;
}
