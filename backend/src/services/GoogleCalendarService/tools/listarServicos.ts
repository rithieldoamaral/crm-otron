/**
 * Tool: listar_servicos
 * Lista serviços ativos da empresa com duração e profissionais habilitados.
 */

import Service from "../../../models/Service";
import ServiceProfessional from "../../../models/ServiceProfessional";
import User from "../../../models/User";

interface ListarServicosResult {
  servicos: { id: number; nome: string; duracaoMinutos: number; profissionais: string[] }[];
  total: number;
}

export async function listarServicos(
  _args: Record<string, unknown>,
  companyId: number
): Promise<ListarServicosResult> {
  const servicos = await Service.findAll({
    where: { companyId, isActive: true },
    include: [{
      model: ServiceProfessional,
      as: "serviceProfessionals",
      include: [{ model: User, as: "user", attributes: ["name"] }]
    }],
    order: [["name", "ASC"]]
  });

  const result = (servicos as any[]).map(s => ({
    id: s.id,
    nome: s.name,
    duracaoMinutos: s.durationMinutes,
    profissionais: s.serviceProfessionals?.map((sp: any) => sp.user?.name).filter(Boolean) ?? []
  }));

  return { servicos: result, total: result.length };
}

export const listarServicosDefinition = {
  name: "listar_servicos",
  // Bug #34 (2026-05-24): descrição anterior não deixava claro que a lista é
  // EXAUSTIVA. LLM chamava a tool, recebia 3 serviços reais, e adicionava outros
  // típicos do segmento (Coloração, Progressiva, Hidratação) que não existiam.
  // Nova descrição: lista é COMPLETA — proibido adicionar do conhecimento próprio.
  description: "Lista TODOS os serviços disponíveis da empresa (lista COMPLETA e EXCLUSIVA). " +
    "Apresente ao cliente SOMENTE os serviços retornados por esta tool — " +
    "JAMAIS adicione serviços da sua memória, mesmo que típicos do segmento. " +
    "Use sempre antes de apresentar opções ao cliente.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};
