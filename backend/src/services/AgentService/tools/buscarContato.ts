/**
 * Tool: buscar_contato
 * Busca um contato pelo nome ou número dentro da empresa.
 * Usada pelo agente para encontrar o destinatário antes de enviar mensagem.
 */

import { Op } from "sequelize";
import Contact from "../../../models/Contact";

interface BuscarContatoArgs {
  nome_ou_numero: string;
}

interface ContatoEncontrado {
  id: number;
  nome: string;
  numero: string;
  ultimoContato?: string;
}

interface BuscarContatoResult {
  encontrados: ContatoEncontrado[];
  mensagem: string;
  erro?: string;
}

/**
 * Busca contatos por nome (ILIKE) ou número exato dentro da empresa.
 *
 * @param args - { nome_ou_numero } — texto livre para busca
 * @param companyId - ID da empresa para isolamento multi-tenant
 * @returns Lista de contatos encontrados com id, nome e número
 */
export async function buscarContato(
  args: BuscarContatoArgs,
  companyId: number
): Promise<BuscarContatoResult> {
  try {
    const { nome_ou_numero } = args;
    const termo = nome_ou_numero.trim();

    const contatos = await Contact.findAll({
      where: {
        companyId,
        isGroup: false,
        [Op.or]: [
          { name: { [Op.iLike]: `%${termo}%` } },
          { number: { [Op.like]: `%${termo}%` } }
        ]
      },
      attributes: ["id", "name", "number", "createdAt"],
      limit: 5,
      order: [["name", "ASC"]]
    });

    if (contatos.length === 0) {
      return {
        encontrados: [],
        mensagem: `Nenhum contato encontrado para "${termo}".`
      };
    }

    const encontrados: ContatoEncontrado[] = contatos.map(c => ({
      id: c.id,
      nome: c.name,
      numero: c.number,
      ultimoContato: c.createdAt?.toISOString().split("T")[0]
    }));

    return {
      encontrados,
      mensagem: `${encontrados.length} contato(s) encontrado(s).`
    };
  } catch (error) {
    return {
      encontrados: [],
      mensagem: "Erro ao buscar contato.",
      erro: (error as Error).message
    };
  }
}

/** Definição JSON Schema da tool para o provider de IA */
export const buscarContatoDefinition = {
  name: "buscar_contato",
  description:
    "Busca um cliente/contato pelo nome ou número de telefone. Use antes de enviar mensagens para obter o ID correto do contato.",
  parameters: {
    type: "object",
    properties: {
      nome_ou_numero: {
        type: "string",
        description:
          "Nome (parcial ou completo) ou número de telefone do contato a buscar"
      }
    },
    required: ["nome_ou_numero"]
  }
};
