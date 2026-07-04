/**
 * Tool: consultar_usuarios
 * Lista agentes/usuários disponíveis para transferência de tickets.
 */

import User from "../../../models/User";

// Whitelist explícita — fonte da verdade duplicada do schema do banco para
// rejeitar alucinações do LLM como "administrador", "ADMIN", "operator", "root".
// Sem isso o where roda com lixo e devolve [] silenciosamente — confundindo o admin.
const PERFIS_VALIDOS = ["admin", "user"] as const;

interface ConsultarUsuariosArgs {
  perfil?: string;
}

interface UsuarioItem {
  id: number;
  nome: string;
  email: string;
  perfil: string;
}

interface ConsultarUsuariosResult {
  usuarios: UsuarioItem[];
  total: number;
  /** Presente quando args.perfil foi rejeitado pela whitelist. */
  erro?: string;
}

/**
 * Lista usuários da empresa, excluindo campos sensíveis.
 *
 * Valida `args.perfil` contra whitelist ANTES de chamar o BD para evitar
 * resultados vazios silenciosos por valor inválido (Bug #20 do AgentService).
 */
export async function consultarUsuarios(
  args: ConsultarUsuariosArgs,
  companyId: number
): Promise<ConsultarUsuariosResult> {
  if (args.perfil !== undefined && !PERFIS_VALIDOS.includes(args.perfil as any)) {
    return {
      usuarios: [],
      total: 0,
      erro: `Perfil inválido "${args.perfil}". Valores aceitos: ${PERFIS_VALIDOS.join(", ")}.`
    };
  }

  const where: Record<string, unknown> = { companyId };
  if (args.perfil) where.profile = args.perfil;

  const users = await User.findAll({
    where,
    attributes: ["id", "name", "email", "profile"],
    order: [["name", "ASC"]]
  });

  const usuarios: UsuarioItem[] = users.map((u: any) => ({
    id: u.id,
    nome: u.name,
    email: u.email,
    perfil: u.profile
  }));

  return { usuarios, total: usuarios.length };
}

export const consultarUsuariosDefinition = {
  name: "consultar_usuarios",
  description: "Lista usuários/agentes da empresa. Use para obter o ID correto antes de transferir um ticket para um agente específico.",
  parameters: {
    type: "object",
    properties: {
      perfil: { type: "string", enum: ["admin", "user"], description: "Filtrar por perfil (admin ou user)" }
    },
    required: []
  }
};
