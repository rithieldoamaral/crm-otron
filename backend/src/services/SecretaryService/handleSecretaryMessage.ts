/**
 * handleSecretaryMessage — ponto de entrada do Agente Secretária.
 * Verifica autenticação do admin, executa o loop e envia a resposta.
 * Retorna { handled: false } para mensagens de não-admins (silencioso).
 */

import { getSettingsByCompany } from "../AgentService/settingsCache";
import { runSecretaryLoop } from "./secretaryLoop";
import { phonesMatch } from "./phoneMatch";

export interface SecretaryMessageContext {
  companyId: number;
  senderNumber: string;
  userMessage: string;
  whatsappId: number;
}

export interface SecretaryMessageResult {
  handled: boolean;
  error?: string;
}

async function getSecretarySettings(companyId: number): Promise<{
  adminNumbers: string[];
}> {
  const rows = await getSettingsByCompany(companyId);
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  // Mantém os números crus (apenas trim). A canonicalização — incluindo a
  // tolerância ao 9º dígito brasileiro — é feita em `phonesMatch` no momento da
  // comparação, para não perder informação nem assumir um formato único aqui.
  const raw: string = map.secretaryAdminNumbers ?? "";
  const adminNumbers = raw.trim()
    ? raw.split(",").map(n => n.trim()).filter(Boolean)
    : [];

  return { adminNumbers };
}

/**
 * Verifica se um número de telefone pertence a um admin da Secretária da empresa.
 * Comparação tolerante a formato (9º dígito BR, código de país, máscara, JID) via
 * `phonesMatch`. Fonte única de verdade para "este contato é admin?" — usada tanto
 * no roteamento do listener (decidir se a conversa vai para o ticket de Secretária)
 * quanto no `handleSecretaryMessage` (autenticação do canal).
 *
 * @param companyId - empresa (multi-tenant)
 * @param number - número/JID a verificar
 * @returns true se o número é admin da Secretária
 */
export async function isSecretaryAdmin(
  companyId: number,
  number: string
): Promise<boolean> {
  const { adminNumbers } = await getSecretarySettings(companyId);
  return adminNumbers.some(n => phonesMatch(n, number));
}

/**
 * Processa mensagem recebida no canal secretária.
 * Retorna handled:false para mensagens de não-admins sem processar.
 */
export async function handleSecretaryMessage(
  ctx: SecretaryMessageContext,
  sendFn: (message: string) => Promise<void>
): Promise<SecretaryMessageResult> {
  const { companyId, senderNumber, userMessage } = ctx;

  // Comparação tolerante a formato (9º dígito BR, código de país, máscara, JID).
  // Causa-raiz do ticket #22: WhatsApp entrega `554888368758` (sem o 9) enquanto
  // o admin cadastrou `5548988368758` (com o 9). Ver phoneMatch.ts / isSecretaryAdmin.
  if (!(await isSecretaryAdmin(companyId, senderNumber))) {
    // Não-admin: silencioso (não vaza que existe um canal de secretária).
    return { handled: false };
  }

  // Admin tem prioridade sobre qualquer canal — secretária responde independente
  // de qual whatsapp o admin usou (inclusive canal agente, com ticket aberto).

  try {
    const { reply } = await runSecretaryLoop({ companyId, senderNumber, userMessage });
    await sendFn(reply);
    return { handled: true };
  } catch (error) {
    const errorMessage = (error as Error).message;
    try {
      await sendFn("❌ Tive um erro ao processar seu pedido. Tente novamente.");
    } catch {
      // sendFn failure is secondary
    }
    return { handled: true, error: errorMessage };
  }
}
