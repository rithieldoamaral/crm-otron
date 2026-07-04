/**
 * GlobalSettingsService — CRUD de configurações globais da plataforma.
 *
 * Estas configurações se aplicam a TODAS as empresas da plataforma.
 * Somente super admins podem ler/escrever. Nunca filtra por companyId.
 *
 * Responsabilidades:
 *   - `getAll`   — Retorna todos os pares key-value globais
 *   - `upsertMany` — Atualiza/cria múltiplos pares de uma vez
 *
 * Após qualquer escrita, invalida o cache do settingsCache para que
 * AgentService e SecretaryService vejam o novo valor em até 1 request.
 */

import GlobalSetting from "../../models/GlobalSetting";
import { invalidateGlobalCache } from "../AgentService/settingsCache";

export type GlobalSettingsMap = Record<string, string>;

/**
 * Retorna todos os settings globais da plataforma como objeto key→value.
 *
 * @returns Objeto com todos os pares globais cadastrados
 *
 * @example
 *   const map = await getAll();
 *   // { globalAgentProvider: "anthropic", globalAgentModel: "claude-haiku-4-5-20251001", ... }
 */
export async function getAll(): Promise<GlobalSettingsMap> {
  const rows = await GlobalSetting.findAll();
  return Object.fromEntries(rows.map(r => [r.key, r.value ?? ""]));
}

/**
 * Atualiza ou cria múltiplos settings globais atomicamente.
 *
 * Usa upsert para que keys já existentes sejam atualizadas e
 * novas keys sejam criadas — idempotente e seguro para retry.
 *
 * Invalida o cache imediatamente após salvar para efeito sem delay.
 *
 * @param data - Objeto com pares key→value a persistir
 *
 * @example
 *   await upsertMany({
 *     globalAgentProvider: "anthropic",
 *     globalAgentModel: "claude-sonnet-4-6",
 *   });
 */
export async function upsertMany(data: GlobalSettingsMap): Promise<void> {
  await Promise.all(
    Object.entries(data).map(([key, value]) =>
      GlobalSetting.upsert({ key, value })
    )
  );
  // Invalida cache imediatamente — próximo request já usa novos valores
  invalidateGlobalCache();
}
