/**
 * Janela de atendimento de 24 horas dos canais oficiais.
 *
 * REGRA DA META: mensagem de formato livre só pode ser enviada dentro de 24h
 * contadas a partir da última mensagem DO CLIENTE. Fora disso, apenas template
 * previamente aprovado.
 *
 * POR QUE ISTO É PERIGOSO SE ERRAR: tentar enviar livre fora da janela faz a
 * Meta rejeitar a chamada. Sem tratamento, o sistema marcaria a mensagem como
 * enviada e o cliente nunca receberia — falha invisível, do tipo que só aparece
 * quando alguém reclama. Por isso a função é conservadora: na dúvida, considera
 * a janela FECHADA e força o uso de template.
 *
 * NÃO SE APLICA AO BAILEYS, que não tem esse conceito e envia a qualquer
 * momento (ao custo do risco de banimento).
 */

/** 24 horas em milissegundos. */
export const JANELA_MS = 24 * 60 * 60 * 1000;

/** Forma mínima de mensagem que o cálculo consome. */
export interface MensagemDaJanela {
  /** true = enviada por nós; false = recebida do cliente. */
  fromMe: boolean;
  createdAt: Date | string | null | undefined;
}

/**
 * Diz se a janela de atendimento está aberta.
 *
 * @param mensagens - Mensagens do ticket, em qualquer ordem.
 * @param agora - Instante de referência (injetável para teste determinístico).
 * @returns true se ainda é possível enviar mensagem de formato livre.
 *
 * @example
 * if (!estaNaJanelaDeAtendimento(ticket.messages)) {
 *   // precisa de template aprovado
 * }
 */
export const estaNaJanelaDeAtendimento = (
  mensagens: MensagemDaJanela[],
  agora: Date = new Date()
): boolean => {
  if (!mensagens?.length) return false;

  const ultimaDoCliente = mensagens
    // Só mensagem RECEBIDA reabre a janela. Se a nossa contasse, o sistema
    // manteria a janela viva falando sozinho — e a Meta rejeitaria assim
    // mesmo, porque quem conta para ela é o cliente.
    .filter(m => !m.fromMe)
    .map(m => (m.createdAt ? new Date(m.createdAt).getTime() : NaN))
    // Data inválida vira NaN e é descartada: uma linha corrompida não pode
    // derrubar o cálculo nem, pior, ser interpretada como recente.
    .filter(t => !Number.isNaN(t))
    .reduce((maior, t) => (t > maior ? t : maior), -Infinity);

  if (ultimaDoCliente === -Infinity) return false;

  return agora.getTime() - ultimaDoCliente < JANELA_MS;
};
