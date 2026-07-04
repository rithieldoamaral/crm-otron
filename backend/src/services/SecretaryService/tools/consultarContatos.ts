/**
 * Tool: consultar_contatos (Secretária)
 * Dá à Secretária acesso à LISTA DE CONTATOS do CRM — não só quem tem ticket aberto.
 *
 * Motivação (2026-06-28): a Secretária era centrada em ticket (buscar_ticket só acha
 * quem tem atendimento). Ao pedir "avise a Amanda", ela não encontrava o contato.
 * Esta tool busca no CRM inteiro (contatos de WhatsApp + importados + criados por ticket),
 * retornando múltiplos resultados para o admin desambiguar ("encontrei 3 Amandas, qual?").
 *
 * Reutiliza a busca do Agente (`buscarContato`) — DRY, mesma lógica e isolamento
 * multi-tenant por companyId.
 */

import { buscarContato } from "../../AgentService/tools/buscarContato";

interface ConsultarContatosArgs {
  nome_ou_numero: string;
}

/**
 * Busca contatos do CRM por nome (ILIKE) ou número, escopado por empresa.
 *
 * @param args - { nome_ou_numero } texto livre
 * @param companyId - empresa (multi-tenant)
 * @returns { encontrados: [{id, nome, numero, ultimoContato}], mensagem }
 */
export async function consultarContatos(
  args: ConsultarContatosArgs,
  companyId: number
): Promise<Record<string, unknown>> {
  const result = await buscarContato(args, companyId);
  return result as unknown as Record<string, unknown>;
}

export const consultarContatosDefinition = {
  name: "consultar_contatos",
  description:
    "Busca contatos/clientes do CRM pelo nome ou número de telefone (lista completa, " +
    "não só quem tem ticket aberto). Use quando o admin pedir para encontrar, listar ou " +
    "enviar mensagem a um cliente. Se retornar VÁRIOS contatos (ex: 3 'Amanda'), NÃO " +
    "assuma — apresente a lista ao admin e pergunte qual ele quer.",
  parameters: {
    type: "object",
    properties: {
      nome_ou_numero: {
        type: "string",
        description: "Nome (parcial ou completo) ou número de telefone do contato a buscar"
      }
    },
    required: ["nome_ou_numero"]
  }
};
