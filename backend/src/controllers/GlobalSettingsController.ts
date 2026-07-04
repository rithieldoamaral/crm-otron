/**
 * GlobalSettingsController — endpoints REST para configurações globais de plataforma.
 *
 * Rotas (via globalSettingsRoutes.ts):
 *   GET  /global-settings  → index  (lê todos os settings globais)
 *   PUT  /global-settings  → update (salva/atualiza settings globais)
 *
 * Segurança:
 *   - Ambas as rotas requerem `isAuth` + `isSuper` (middleware de rota)
 *   - API key nunca é retornada no GET (substituída por "••••" se existir)
 *   - Multi-tenancy: GlobalSettings são plataforma-level, sem companyId
 */

import { Request, Response } from "express";
import { getAll, upsertMany } from "../services/GlobalSettingsService";

/** Chaves sensíveis que nunca devem ser retornadas em texto claro */
const SENSITIVE_KEYS = ["globalAgentApiKey", "globalSecretaryApiKey", "globalWhisperApiKey"];

/**
 * Retorna todos os settings globais.
 * Chaves de API são mascaradas ("••••") se existirem — nunca vazam em texto claro.
 * Guard de super admin já foi aplicado pelo middleware isSuper na rota.
 */
export const index = async (req: Request, res: Response): Promise<Response> => {

  const map = await getAll();

  // Mascarar keys sensíveis: retorna "••••" se o valor estiver salvo, "" se vazio
  for (const key of SENSITIVE_KEYS) {
    if (map[key]) map[key] = "••••";
  }

  return res.json(map);
};

/**
 * Salva/atualiza settings globais.
 * Se o frontend enviar "••••" em uma API key, o valor não é sobrescrito
 * (significa "não mudou"). Apenas strings não-sentinel são persistidas.
 *
 * Body: objeto key→value com qualquer subconjunto dos settings globais.
 */
export const update = async (req: Request, res: Response): Promise<Response> => {
  // Guard de super admin já aplicado pelo middleware isSuper na rota — não replicar aqui.
  const payload: Record<string, string> = req.body;

  // Remover sentinel de API keys — "••••" significa "não alterada"
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string") continue;
    if (SENSITIVE_KEYS.includes(key) && value === "••••") continue;
    filtered[key] = value;
  }

  if (Object.keys(filtered).length === 0) {
    return res.json({ message: "Nenhuma alteração aplicada." });
  }

  await upsertMany(filtered);
  return res.json({ message: "Configurações globais salvas com sucesso." });
};
