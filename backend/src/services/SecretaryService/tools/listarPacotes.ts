/**
 * Tool: listar_pacotes
 *
 * Permite ao agente secretária (AI) listar os pacotes de sessões disponíveis
 * com preços e descrições, para responder clientes via WhatsApp.
 *
 * Exemplos de uso pelo agente:
 *   - "Quais pacotes de depilação vocês têm?"
 *   - "Quanto custa o pacote de 10 sessões?"
 *   - "Tem promoção de pacote?"
 *
 * Fase 6 — Pacotes de Sessões.
 */

import { Op } from "sequelize";
import Package from "../../../models/Package";
import Service from "../../../models/Service";
import { formatPrice } from "../../ServiceCatalogService/ServiceCatalogService.utils";
import { calculatePackageDiscount } from "../../PackageService/PackageService.utils";

interface ListarPacotesArgs {
  /** Filtro opcional por nome do pacote ou serviço */
  busca?: string;
}

interface PacoteItem {
  id: number;
  nome: string;
  servico: string | null;
  totalSessoes: number;
  preco: string;
  precoNumerico: number;
  descontoPercent: number | null;
  descricao: string | null;
}

interface ListarPacotesResult {
  pacotes: PacoteItem[];
  total: number;
  /** Resumo formatado pronto para enviar ao cliente via WhatsApp */
  resumo: string;
}

/**
 * Lista os pacotes de sessões ativos da empresa.
 *
 * @param args      - { busca?: string } — filtro opcional
 * @param companyId - ID da empresa (JWT do agente)
 * @returns Lista de pacotes com preços e resumo em texto
 */
export async function listarPacotes(
  args: ListarPacotesArgs,
  companyId: number
): Promise<ListarPacotesResult> {
  const { busca } = args;

  const where: Record<string, unknown> = { companyId, isActive: true };

  if (busca) {
    where.name = { [Op.like]: `%${busca}%` };
  }

  const packages = await Package.findAll({
    where,
    include: [{ model: Service, attributes: ["id", "name", "price"] }],
    order: [["name", "ASC"]],
  });

  const pacotes: PacoteItem[] = packages.map((pkg: any) => {
    const servicePrice = pkg.service?.price != null ? Number(pkg.service.price) : null;
    const totalPrice = Number(pkg.totalPrice);
    const discount = calculatePackageDiscount(servicePrice, pkg.totalSessions, totalPrice);

    return {
      id: pkg.id,
      nome: pkg.name,
      servico: pkg.service?.name ?? null,
      totalSessoes: pkg.totalSessions,
      preco: formatPrice(totalPrice),
      precoNumerico: totalPrice,
      descontoPercent: discount,
      descricao: pkg.description ?? null,
    };
  });

  let resumo = "";

  if (pacotes.length === 0) {
    resumo = busca
      ? `Não encontrei pacotes para "${busca}". Posso verificar com a equipe se você me descrever o que procura!`
      : "Ainda não temos pacotes cadastrados. Entre em contato para mais informações!";
  } else {
    const linhas = pacotes.map((p) => {
      const servico = p.servico ? ` de ${p.servico}` : "";
      const desconto =
        p.descontoPercent && p.descontoPercent > 0
          ? ` *(${p.descontoPercent}% de desconto!)*`
          : "";
      const descricao = p.descricao ? `\n  _${p.descricao}_` : "";
      return `• *${p.nome}*${servico} — ${p.totalSessoes} sessões por *${p.preco}*${desconto}${descricao}`;
    });

    resumo =
      `Nossos pacotes disponíveis:\n\n${linhas.join("\n\n")}\n\n` +
      `Para adquirir um pacote, fale com nossa equipe! 😊`;
  }

  return { pacotes, total: pacotes.length, resumo };
}

export const listarPacotesDefinition = {
  name: "listar_pacotes",
  description:
    "Lista os pacotes de sessões disponíveis para venda com preços e descontos. Use quando o cliente perguntar sobre pacotes, promoções ou combos de sessões.",
  parameters: {
    type: "object",
    properties: {
      busca: {
        type: "string",
        description:
          "Filtro opcional por nome do pacote ou serviço (ex: 'laser', 'depilação', '10 sessões')",
      },
    },
    required: [],
  },
};
