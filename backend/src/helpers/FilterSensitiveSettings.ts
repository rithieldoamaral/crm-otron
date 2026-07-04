/**
 * FilterSensitiveSettings — remove chaves sensíveis (API keys, tokens, secrets)
 * das Settings retornadas a usuários NÃO-admin.
 *
 * Vetor (security review 2026-06-28): o GET /settings devolvia TODAS as settings
 * da empresa a qualquer usuário autenticado (o gate de admin estava comentado no
 * SettingController.index) — expondo `agentApiKey`/`agentWhisperApiKey` (credenciais
 * pagas de LLM/Whisper) a atendentes comuns. Bloquear o endpoint inteiro quebraria o
 * frontend (usuários comuns dependem de settings operacionais como `userCreation`).
 * A solução é filtrar por PADRÃO de nome: admin vê tudo; não-admin vê tudo MENOS o
 * que casa com apikey/token/secret/password.
 */

interface SettingRow {
  key: string;
  value: string;
}

/** Padrão de nomes de chave considerados sensíveis (case-insensitive). */
const SENSITIVE_KEY_PATTERN = /apikey|api_key|token|secret|password/i;

/**
 * Filtra settings sensíveis conforme o perfil do solicitante.
 *
 * @param settings - linhas de Settings da empresa ({ key, value })
 * @param isAdmin - true se o usuário autenticado tem profile "admin"
 * @returns todas as settings (admin) ou apenas as não-sensíveis (não-admin)
 *
 * @example
 *   filterSensitiveSettings(rows, false) // sem agentApiKey/apiToken/...
 */
export function filterSensitiveSettings<T extends SettingRow>(
  settings: T[] | null | undefined,
  isAdmin: boolean
): T[] {
  if (!Array.isArray(settings)) return [];
  if (isAdmin) return settings;
  return settings.filter(s => !SENSITIVE_KEY_PATTERN.test(s.key));
}
