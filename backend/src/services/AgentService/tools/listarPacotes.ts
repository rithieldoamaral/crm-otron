/**
 * Tool: listar_pacotes
 *
 * Lista pacotes de serviços ativos da empresa para o agente de atendimento.
 * Pacotes são produtos de múltiplas sessões com preço especial (ex: "10 sessões de laser").
 *
 * Por que existe: listar_servicos retorna apenas serviços avulsos.
 * Clientes que pediam "Depilação a Laser" recebiam "Esse serviço não está disponível"
 * porque o serviço existia EXCLUSIVAMENTE como pacote — o agente não tinha visibilidade.
 * Esta tool complementa listar_servicos com os pacotes disponíveis.
 */

import Package from "../../../models/Package";
import Service from "../../../models/Service";

interface PacoteItem {
  id: number;
  /** Nome comercial do pacote (ex: "Pacote 10 Sessões Laser") */
  nome: string;
  /** Nome do serviço vinculado (ex: "Depilação a Laser"), ou null se não vinculado */
  servico: string | null;
  /** Número de sessões incluídas */
  sessoes: number;
  /** Preço total do pacote em Reais */
  preco: number;
  /** Percentual de desconto vs sessões avulsas, ou null se serviço sem preço */
  descontoPercent: number | null;
  /** Descrição exibida ao cliente */
  descricao: string | null;
}

interface ListarPacotesResult {
  pacotes: PacoteItem[];
  total: number;
}

/**
 * Lista todos os pacotes ativos da empresa com informações do serviço vinculado.
 *
 * @param _args - Sem parâmetros (retorna todos os pacotes ativos)
 * @param companyId - ID da empresa (multi-tenant — sempre do JWT)
 * @returns Lista de pacotes com nome, serviço, sessões, preço e desconto calculado
 */
export async function listarPacotes(
  _args: Record<string, unknown>,
  companyId: number
): Promise<ListarPacotesResult> {
  const packages = await Package.findAll({
    where: { companyId, isActive: true },
    include: [{ model: Service, as: "service", attributes: ["name", "price"] }],
    order: [["name", "ASC"]]
  });

  const pacotes: PacoteItem[] = (packages as any[]).map(pkg => {
    const serviceName: string | null = pkg.service?.name ?? null;
    const servicePrice: number | null = pkg.service?.price != null ? Number(pkg.service.price) : null;
    const pkgPrice = Number(pkg.totalPrice);

    // Desconto = economia vs comprar as sessões avulsas (se serviço tem preço cadastrado)
    let descontoPercent: number | null = null;
    if (servicePrice != null) {
      const precoAvulsoTotal = servicePrice * pkg.totalSessions;
      if (pkgPrice < precoAvulsoTotal) {
        descontoPercent = Math.round(((precoAvulsoTotal - pkgPrice) / precoAvulsoTotal) * 100);
      }
    }

    return {
      id: pkg.id,
      nome: pkg.name,
      servico: serviceName,
      sessoes: pkg.totalSessions,
      preco: pkgPrice,
      descontoPercent,
      descricao: pkg.description ?? null
    };
  });

  return { pacotes, total: pacotes.length };
}

export const listarPacotesDefinition = {
  name: "listar_pacotes",
  description:
    "Lista TODOS os pacotes de serviços disponíveis da empresa (múltiplas sessões com preço especial). " +
    "Use JUNTO com listar_servicos para ter visão completa da oferta. " +
    "Se o cliente perguntar por um serviço disponível apenas como pacote (ex: 'Depilação a Laser'), " +
    "apresente o pacote como opção disponível — não diga 'não temos'. " +
    "Mencione o desconto percentual quando disponível para destacar o benefício.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
};
