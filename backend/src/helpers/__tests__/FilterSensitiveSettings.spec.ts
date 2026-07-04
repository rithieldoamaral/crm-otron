/**
 * Testes TDD para FilterSensitiveSettings — impede que usuários NÃO-admin recebam
 * chaves sensíveis (API keys de LLM/Whisper, tokens) no GET /settings.
 *
 * Vetor (security review 2026-06-28): SettingController.index tinha o check de
 * admin COMENTADO e retornava TODAS as settings da empresa para qualquer usuário
 * autenticado — incluindo agentApiKey/agentWhisperApiKey. Um atendente comum podia
 * ler as credenciais pagas da empresa.
 */

import { filterSensitiveSettings } from "../FilterSensitiveSettings";

const SETTINGS = [
  { key: "agentName", value: "Amanda" },
  { key: "agentApiKey", value: "sk-proj-SEGREDO" },
  { key: "agentWhisperApiKey", value: "gsk_SEGREDO" },
  { key: "userCreation", value: "enabled" },
  { key: "secretaryAdminNumbers", value: "5548988368758" },
  { key: "apiToken", value: "tok_SEGREDO" }
];

describe("filterSensitiveSettings", () => {
  it("ADMIN recebe todas as settings, incluindo as sensíveis", () => {
    const out = filterSensitiveSettings(SETTINGS as any, true);
    expect(out).toHaveLength(SETTINGS.length);
    expect(out.map((s: any) => s.key)).toContain("agentApiKey");
  });

  it("NÃO-admin não recebe chaves com apiKey/token/secret no nome", () => {
    const out = filterSensitiveSettings(SETTINGS as any, false);
    const keys = out.map((s: any) => s.key);
    expect(keys).not.toContain("agentApiKey");
    expect(keys).not.toContain("agentWhisperApiKey");
    expect(keys).not.toContain("apiToken");
  });

  it("NÃO-admin continua recebendo settings operacionais não-sensíveis", () => {
    const out = filterSensitiveSettings(SETTINGS as any, false);
    const keys = out.map((s: any) => s.key);
    expect(keys).toContain("agentName");
    expect(keys).toContain("userCreation");
  });

  it("lista vazia retorna vazia sem lançar", () => {
    expect(filterSensitiveSettings([], false)).toEqual([]);
    expect(filterSensitiveSettings(null as any, false)).toEqual([]);
  });
});
