/**
 * Tool: consultar_catalogo
 *
 * Permite ao agente secretária (AI) consultar os serviços disponíveis e seus
 * preços, para responder clientes via WhatsApp com informações atualizadas
 * do catálogo da empresa.
 *
 * Exemplos de uso pelo agente:
 *   - "Quanto custa uma sessão de depilação a laser?"
 *   - "Quais serviços vocês oferecem?"
 *   - "Me passa os preços dos pacotes"
 *
 * Fase 5 — Catálogo de Serviços com Preço.
 */

import Service from "../../../models/Service";
import { formatPrice } from "../../ServiceCatalogService/ServiceCatalogService.utils";

interface ConsultarCatalogoArgs {
  /** Filtro opcional por nome ou categoria do serviço */
  busca?: string;
}

interface ServicoItem {
  id: number;
  nome: string;
  categoria: string | null;
  duracaoMinutos: number | null;
  preco: string;
  precoNumerico: number | null;
}

interface ConsultarCatalogoResult {
  servicos: ServicoItem[];
  total: number;
  /** Mensagem formatada pronta para enviar ao cliente */
  resumo: string;
}

/**
 * Consulta o catálogo de serviços da empresa com preços.
 *
 * @param args     - { busca?: string } — filtro opcional por nome/categoria
 * @param companyId - ID da empresa (do JWT do agente)
 * @returns Lista de serviços com preços formatados e resumo em texto
 */
export async function consultarCatalogo(
  args: ConsultarCatalogoArgs,
  companyId: number
): Promise<ConsultarCatalogoResult> {
  const { busca } = args;

  // Busca serviços ativos da empresa
  const where: Record<string, unknown> = { companyId, isActive: true };

  const services = await Service.findAll({
    where,
    order: [
      ["category", "ASC"],
      ["name", "ASC"],
    ],
    attributes: ["id", "name", "category", "durationMinutes", "price"],
  });

  // Filtra por busca textual se fornecida (nome ou categoria)
  const filtered = busca
    ? services.filter((s: any) => {
        const term = busca.toLowerCase();
        return (
          s.name?.toLowerCase().includes(term) ||
          s.category?.toLowerCase().includes(term)
        );
      })
    : services;

  const servicos: ServicoItem[] = filtered.map((s: any) => ({
    id: s.id,
    nome: s.name,
    categoria: s.category ?? null,
    duracaoMinutos: s.durationMinutes ?? null,
    preco: s.price != null ? formatPrice(Number(s.price)) : "A combinar",
    precoNumerico: s.price != null ? Number(s.price) : null,
  }));

  // Monta resumo legível para o agente enviar ao cliente
  let resumo = "";
  if (servicos.length === 0) {
    resumo = busca
      ? `Não encontrei serviços para "${busca}". Posso verificar com a equipe se você descrever melhor o que procura.`
      : "Ainda não há serviços cadastrados no catálogo. Por favor, entre em contato para mais informações.";
  } else {
    const linhas = servicos.map((s) => {
      const duracao = s.duracaoMinutos
        ? ` (${s.duracaoMinutos} min)`
        : "";
      const cat = s.categoria ? ` [${s.categoria}]` : "";
      return `• ${s.nome}${cat}${duracao}: *${s.preco}*`;
    });
    resumo = `Nossos serviços disponíveis:\n\n${linhas.join("\n")}`;
  }

  return { servicos, total: servicos.length, resumo };
}

export const consultarCatalogoDefinition = {
  name: "consultar_catalogo",
  description:
    "Consulta os serviços disponíveis na empresa com seus preços. Use quando o cliente perguntar sobre preços, serviços oferecidos ou quiser saber o que está disponível.",
  parameters: {
    type: "object",
    properties: {
      busca: {
        type: "string",
        description:
          "Termo de busca opcional para filtrar serviços por nome ou categoria (ex: 'depilação', 'corte', 'laser')",
      },
    },
    required: [],
  },
};
