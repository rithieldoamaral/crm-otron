import WhatsappTemplate from "../../../models/WhatsappTemplate";

/**
 * Escolhe o template a usar quando a janela de 24h está fechada.
 *
 * POR QUE ESTA LÓGICA É SEPARADA DA QUERY: a escolha é a parte que carrega o
 * risco. Se ela devolver um template com status errado ou com número de
 * parâmetros incompatível, a Meta rejeita o envio — e sem tratamento o sistema
 * marca como enviado e o cliente nunca recebe. Query quebrada falha alto;
 * escolha errada falha em silêncio. Só a parte pura é testável a fundo, e é ela
 * que precisa ser.
 */

/** Forma mínima que a escolha consome — permite testar sem banco. */
export interface TemplateCandidato {
  name: string;
  language: string;
  status: string;
  variableCount: number;
}

/**
 * Seleciona um template compatível com a quantidade de parâmetros disponível.
 *
 * @param candidatos - Templates da conexão.
 * @param params - Parâmetros que se pretende enviar.
 * @param idiomaPreferido - Idioma desejado; se não houver, aceita outro.
 * @returns O template escolhido, ou null se nenhum servir.
 *
 * @example
 * const t = escolherTemplate(templates, ["João"], "pt_BR");
 * if (!t) throw new AppError("ERR_OUTSIDE_SERVICE_WINDOW");
 */
export const escolherTemplate = <T extends TemplateCandidato>(
  candidatos: T[],
  params: string[],
  idiomaPreferido = "pt_BR"
): T | null => {
  if (!candidatos?.length) return null;

  const aptos = candidatos.filter(
    t =>
      // Só APPROVED pode ser enviado. Template PENDING ou REJECTED seria
      // recusado pela Meta na hora do envio.
      t.status === "APPROVED" &&
      // O número de parâmetros precisa bater EXATAMENTE. A Meta rejeita tanto
      // parâmetro a mais quanto a menos.
      t.variableCount === params.length
  );

  if (!aptos.length) return null;

  // Idioma preferido primeiro; qualquer outro serve como alternativa, porque
  // mandar no idioma "errado" é melhor que não mandar.
  return aptos.find(t => t.language === idiomaPreferido) ?? aptos[0];
};

/**
 * Busca no banco os templates aprovados de uma conexão e escolhe um.
 *
 * @param whatsappId - Conexão de origem.
 * @param companyId - Empresa dona (isolamento multi-tenant, XV.3).
 * @param params - Parâmetros pretendidos.
 * @param idiomaPreferido - Idioma desejado.
 */
export const pickTemplate = async (
  whatsappId: number,
  companyId: number,
  params: string[],
  idiomaPreferido = "pt_BR"
): Promise<WhatsappTemplate | null> => {
  const candidatos = await WhatsappTemplate.findAll({
    // companyId no WHERE, não só whatsappId: defesa em profundidade contra
    // um id de conexão de outra empresa chegar aqui por engano (XV.3).
    where: { whatsappId, companyId, status: "APPROVED" }
  });

  return escolherTemplate(candidatos, params, idiomaPreferido);
};
