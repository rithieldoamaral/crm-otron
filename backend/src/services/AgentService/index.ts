/**
 * AgentService — serviço principal do agente de atendimento IA.
 * Implementa o loop agêntico: recebe mensagem → chama AI → executa tools → responde.
 * Máximo de 5 iterações por turno para evitar loops infinitos.
 */

import AgentAction from "../../models/AgentAction";
import { getSettingsByCompany, getGlobalSettings } from "./settingsCache";
import { logger } from "../../utils/logger";
import { AIProviderFactory } from "./providers/AIProviderFactory";
import { AIMessage, AIToolCall, ProviderConfig } from "./providers/interfaces";
import { loadContext, saveContext } from "./contextManager";
import {
  shouldCompact,
  buildCompactionContext,
  applyCompaction
} from "./contextCompactor";
import { buildSystemPrompt, getTemperatureForPersonality } from "./knowledgeBuilder";
import { ALL_AGENT_TOOLS, executeAgentTool } from "./tools";
import { parsePseudoXmlToolCalls } from "./pseudoXmlParser";
import {
  sanitizeUserMessage,
  wrapUserMessage,
  checkOutputSafety,
  buildSecurityBlock
} from "./securityGuards";
import {
  extractLastDiscussedService,
  extractTimeFromMessage,
  extractLastDiscussedDate,
  extractDateFromMessage,
  buildCurrentDateTimeBlock,
  looksLikePromise
} from "./agentUtils";
import { normalizePeriod, formatDateWithWeekdayBRT } from "../GoogleCalendarService/availabilityEngine";

// 8 = headroom para fluxos com 3-4 tool calls + síntese final.
// 5 era o original mas modelos open-source (GPT-OSS-120b, Llama) frequentemente
// gastam turnos extras "pensando" antes de responder em texto.
const MAX_ITERATIONS = 8;
const FALLBACK_REPLY =
  "Desculpe, estou com dificuldades técnicas no momento. Por favor, aguarde e tente novamente em instantes.";
const PROCESSING_REPLY =
  "Estou processando sua solicitação, um momento por favor.";
// Resposta de segurança enviada quando o guardrail de output detecta jailbreak ou vazamento.
// Neutra e útil — direciona o cliente ao escopo correto sem expor o motivo do bloqueio.
const SECURITY_FALLBACK_REPLY =
  "Desculpe, não consigo ajudar com essa solicitação. Posso auxiliar com informações sobre nossos serviços ou agendamentos.";

export interface HandleClientAgentInput {
  companyId: number;
  ticketId: number;
  contactId: number;
  contactName?: string;
  contactNumber?: string;
  userMessage: string;
  whatsappId: number;
}

export interface HandleClientAgentOutput {
  reply: string;
}

interface ProviderConfigWithPersonality extends ProviderConfig {
  personality: string;
}

async function loadProviderConfig(companyId: number): Promise<ProviderConfigWithPersonality> {
  // Prioridade de configuração do LLM:
  //   1. GlobalSettings (super admin) — agentProvider/Key/Model globais
  //   2. Settings da empresa — fallback se não houver configuração global
  //   3. Defaults hardcoded — último recurso
  //
  // GlobalSettings tomam precedência porque o super admin controla o LLM
  // de toda a plataforma. A aba Provedor está oculta para empresas comuns.
  const [globalRows, companyRows] = await Promise.all([
    getGlobalSettings(),
    getSettingsByCompany(companyId),
  ]);

  const global = Object.fromEntries(globalRows.map((r: any) => [r.key, r.value]));
  const company = Object.fromEntries(companyRows.map((r: any) => [r.key, r.value]));

  return {
    provider: (
      global.globalAgentProvider ??
      company.agentProvider ??
      "anthropic"
    ) as ProviderConfig["provider"],
    apiKey: global.globalAgentApiKey ?? company.agentApiKey ?? "",
    model: global.globalAgentModel ?? company.agentModel ?? "claude-haiku-4-5-20251001",
    personality: company.agentPersonality ?? "híbrido",
  };
}

// Bloco operacional anexado ao system prompt da empresa. Sem isso o LLM
// pergunta dados que ele já tem ("qual seu telefone?") e tenta escalar
// pelo desconhecimento do estado do ticket.
function buildContactContextBlock(
  contactName: string | undefined,
  contactNumber: string | undefined,
  ticketId: number,
  contactId?: number
): string | null {
  if (!contactName && !contactNumber) return null;
  const lines: string[] = ["**Contexto do atendimento atual (NÃO peça esses dados ao cliente, você já os tem):**"];
  if (contactName) lines.push(`- Nome do cliente: ${contactName}`);
  if (contactNumber) lines.push(`- Número do cliente: ${contactNumber}`);
  if (contactId) lines.push(`- ID do contato: ${contactId}`);
  lines.push(`- ID do ticket atual: ${ticketId}`);
  lines.push(
    "Use estes dados diretamente nas tools (ex: ao chamar transferir_para_humano use o ticketId acima; " +
    "ao notificar o proprietário inclua nome e telefone do cliente). Nunca pergunte 'qual seu nome' " +
    "ou 'qual seu telefone' — você já está conversando com este cliente."
  );
  return lines.join("\n");
}

// `isoLocalDate` e `buildCurrentDateTimeBlock` foram movidos para `agentUtils.ts`
// (2026-06-28) para reuso pela Secretária IA — ela tinha o mesmo problema do
// Bug #11 (assumia "janeiro de 2025"). Ver agentUtils.ts.

/**
 * Bloco de execução agêntica — exige que o LLM EXECUTE antes de RESPONDER.
 *
 * Bug #20 (Round 7): com `gpt-4o-mini`, observado padrão "promete-e-para":
 *   Cliente: "Pode ser às 9h?"
 *   Bot: "Perfeito! Vou confirmar o agendamento, um momento por favor."
 *   [LLM termina o turn aqui — NUNCA chama criar_evento]
 *   Cliente: "Certo, pode fazer"
 *   [Só agora o LLM finalmente chama criar_evento]
 *
 * Causa: modelos OpenAI baratos têm bias para responder antes de agir,
 * gerando texto de "vou fazer X" e parando sem executar a tool. O cliente
 * acaba esperando, achando que o sistema travou.
 *
 * Fix probabilístico (Round 7): instrução explícita no system prompt.
 * Fix determinístico (Round 8): `looksLikePromise()` + re-iteração forçada
 * no loop — se o LLM ignorar o prompt e emitir promise-text sem tool_calls,
 * o loop injeta correção e força outra iteração. Ver `handleClientAgent`.
 */
function buildExecutionFlowBlock(): string {
  return [
    "**Regra DURA — EXECUTE antes de RESPONDER (cumpra sempre):**",
    "1. NUNCA prometa ação sem executar. Frases como 'vou verificar', 'vou listar', 'vou confirmar', 'um momento por favor' isoladas — sem chamar tool no mesmo turno — quebram a experiência do cliente.",
    "2. Quando o cliente confirmar um horário ou pedir uma ação, no MESMO turno: (a) chame as tools necessárias, (b) só DEPOIS de receber o resultado escreva a resposta final.",
    "3. Sua resposta de texto ao cliente deve refletir o que JÁ foi feito (não o que vai ser feito). Exemplo correto: 'Pronto! Agendei para amanhã às 9h.' (após criar_evento retornar sucesso). Exemplo errado: 'Vou agendar agora, um momento.' (sem chamar tool).",
    "4. Se você precisa de várias tools em sequência (ex: verificar_disponibilidade → criar_evento), encadeie todas no mesmo turn antes de responder. NUNCA divida em múltiplos turns que dependem do cliente dizer 'ok' para continuar.",
    "5. Se uma tool falhar, repasse o problema real ao cliente em UMA mensagem (sem prometer 'vou tentar de novo' sem tentar).",
    "6. Quando o cliente descreve um problema ou pede informação (ex: 'quebrei o dente', 'quais serviços vocês têm?'), CHAME a tool relevante AGORA mesmo — não diga 'vou listar' sem chamar listar_servicos, não diga 'vou verificar disponibilidade' sem chamar verificar_disponibilidade."
  ].join("\n");
}

/**
 * Detecta "promise-text" — resposta do LLM que promete executar uma ação
 * mas não chama nenhuma tool no mesmo turno.
 *
 * Bug #20 Round 8: o `buildExecutionFlowBlock()` (instrução probabilística)
 * não foi suficiente para impedir que o gpt-4o-mini emitisse frases como
 * "Vou listar os serviços que temos" sem chamar `listar_servicos`.
 *
 * Esta função é usada no loop de `handleClientAgent` para detectar o padrão
 * e forçar re-iteração determinística — sem depender de o LLM obedecer ao prompt.
 *
 * Critérios:
 *   - Contém padrão "vou [verbo de ação]" ou similar (promessa de ação futura)
 *   - NÃO termina em "?" (perguntas legítimas ao cliente não são promises)
 *   - NÃO contém confirmação de ação concluída (✅, "agendado", "confirmado", etc.)
 */
// `looksLikePromise` foi movido para `agentUtils.ts` (2026-06-28) para reuso pela
// Secretária — ela tinha o mesmo risco do Bug #20 (promete ação destrutiva e para
// sem executar). Ver agentUtils.ts.

/**
 * Detecta a "esquiva de disponibilidade" — o modelo barato AFIRMA que não
 * conseguiu verificar a disponibilidade SEM ter chamado a ferramenta.
 *
 * CAUSA-RAIZ (2026-06-21, confirmada por print real): o cliente perguntou
 * "tem às 11h?"; o modelo respondeu "não consegui verificar a disponibilidade
 * para as 11h" — mas 11:00 estava livre (o cliente agendou 12:00 logo depois,
 * mesmo grid de hora em hora). Ou seja, o modelo NÃO consultou a tool e
 * inventou a falha. É comportamento não-determinístico do gpt-4o-mini.
 *
 * Quando isto é detectado e o cliente perguntou um horário específico, o
 * orquestrador FORÇA uma re-iteração instruindo o modelo a realmente chamar
 * verificar_disponibilidade — mesma estratégia determinística do promise-text
 * (looksLikePromise). Os args (data/hora) são preenchidos pela injeção
 * determinística do loop. Assim o modelo não consegue mais "fingir" a falha.
 */
function looksLikeAvailabilityDodge(text: string): boolean {
  return /n[ãa]o\s+(consegui|consigo|foi poss[íi]vel|deu para|deu pra)\s+(verificar|consultar|checar|confirmar)\s+(a\s+)?disponibilidade/i.test(text);
}

/**
 * Detecta "pedido genérico de agendamento" — cliente quer marcar sem especificar serviço.
 *
 * Bug #A (2026-06-27, confirmado nos AgentActions #552→#553 do ticket 22):
 * após `listar_servicos`, o agente chamou IMEDIATAMENTE `buscar_proximo_horario`
 * com `servicoId:6` (Corte Feminino — primeiro da lista) sem o cliente ter
 * mencionado nenhum serviço. "Gostaria de agendar um horário" não especifica nada.
 *
 * Retorna true se a mensagem é APENAS intenção de agendar, sem serviço concreto.
 * Retorna false se o cliente nomeou algo específico ("quero manicure", "corte", etc.).
 */
function isPureScheduleRequest(msg: string): boolean {
  const normalized = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/gu, "");
  // Exige pelo menos uma palavra de intenção de agendamento
  if (!/\b(agendar|marcar|horario|horarios|vaga|disponibilidade|agendamento)\b/.test(normalized)) {
    return false;
  }
  // Remove palavras curtas (≤3 chars) e palavras genéricas de agendamento/cortesia.
  // Se sobrar conteúdo ≥ 5 chars após limpeza, o cliente nomeou algo específico.
  // Threshold = 5: captura "corte" (5 chars, serviço real) como conteúdo específico.
  const withoutGeneric = normalized
    .replace(/\b\w{1,3}\b/g, "")
    .replace(
      /\b(agendar|marcar|horario|horarios|vaga|disponibilidade|agendamento|gostaria|quero|preciso|posso|poderia|queria|pode|sera|para|favor|novo|nova|quais|qual|quando|como)\b/g,
      ""
    )
    .replace(/\s+/g, "")
    .trim();
  return withoutGeneric.length < 5;
}

/**
 * Constrói bloco de contexto com o último serviço discutido na conversa.
 *
 * Bug #33 (2026-05-24): sem este bloco, o LLM escolhia o serviço mais frequente
 * no histórico, não o mais recente. Cliente mudou de "esmalte" para "depilação",
 * disse "quero agendar" e o bot voltou ao esmalte.
 *
 * Esta injeção é DETERMINÍSTICA — independe da atenção/probabilidade do LLM:
 * o prompt sempre diz explicitamente qual serviço está em pauta agora.
 *
 * @param lastService - Retorno de extractLastDiscussedService (null se nenhum)
 * @returns Bloco formatado para system prompt, ou null se não há serviço
 */
function buildLastServiceBlock(lastService: string | null): string | null {
  if (!lastService) return null;
  return (
    `**Serviço em discussão nesta conversa:** "${lastService}"\n` +
    `Quando o cliente confirmar intenção de agendar sem nomear o serviço ` +
    `('quero agendar', 'pode marcar', 'quero esse', 'sim', 'pode', 'ok', 'pode ser', '👍'), ` +
    `use "${lastService}" como o serviço alvo. ` +
    `NÃO mude para outro serviço sem que o cliente peça explicitamente.\n` +
    // Bug #40 (2026-05-31): cliente disse "cortar o cabelo", o bot ofereceu
    // horário, cliente perguntou "E a tarde?" e o bot RE-PERGUNTOU qual serviço.
    // Causa: este bloco só cobria a CONFIRMAÇÃO de agendamento, não o REFINAMENTO
    // de disponibilidade — então a regra 11 ("pergunte o serviço") vencia.
    `Se o cliente refinar a busca de horários ('e a tarde?', 'e de manhã?', ` +
    `'e amanhã?', 'e na sexta?', 'tem mais cedo?', 'mais tarde?', 'outro dia?'), ` +
    `isso se refere ao MESMO serviço "${lastService}" — chame ` +
    `verificar_disponibilidade ou buscar_proximo_horario DIRETAMENTE para ele. ` +
    `É PROIBIDO perguntar de novo qual serviço o cliente quer: ele já está definido.`
  );
}

/**
 * Constrói bloco de contexto com a última DATA discutida na conversa.
 *
 * Bug #B2 (2026-06-20): o agente já ancorava o último SERVIÇO discutido
 * (buildLastServiceBlock, Bug #33/#40), mas NÃO a última DATA. Quando o cliente
 * refina por horário sem repetir o dia ("tem às 11h?", "mais cedo?", "e às 15h?"),
 * o LLM não sabia qual data usar e chamava verificar_disponibilidade com data
 * faltando/errada → falhava com "não consegui verificar".
 *
 * Esta injeção é DETERMINÍSTICA: o prompt diz explicitamente qual data está em
 * pauta, com o dia da semana já resolvido (formatDateWithWeekdayBRT). Análogo a
 * buildLastServiceBlock — só vale para REFINAMENTO sem nova data; se o cliente
 * nomear outro dia, a tabela de calendário do bloco temporal prevalece.
 *
 * @param lastDateIso - ISO "YYYY-MM-DD" da última data discutida (null se nenhuma)
 * @returns Bloco para system prompt, ou null se não há data em pauta
 */
function buildLastDateBlock(lastDateIso: string | null): string | null {
  if (!lastDateIso) return null;
  return (
    `**Data em discussão nesta conversa:** ${formatDateWithWeekdayBRT(lastDateIso)} ` +
    `(ISO para tools: ${lastDateIso})\n` +
    `Quando o cliente refinar a busca por HORÁRIO sem informar uma nova data ` +
    `('tem às 11h?', 'e às 15h?', 'mais cedo?', 'mais tarde?', 'de manhã?', 'à tarde?'), ` +
    `use ESTA data (${lastDateIso}) ao chamar verificar_disponibilidade. ` +
    `NÃO pergunte de novo qual dia: ele já está definido. ` +
    `Só troque de data se o cliente pedir explicitamente outro dia.`
  );
}

/**
 * Bloco de fluxo de agendamento — guia o LLM em decisões críticas de agenda.
 *
 * Bug #17 (Round 5): cliente tinha agendamento 09:00 confirmado. Disse
 * "perfeito!" celebrando. LLM (gpt-oss-120b) interpretou como nova solicitação,
 * declarou que 09:00 estava ocupado, ofereceu 11:00 — e CRIOU 11:00 sem
 * cancelar 09:00. Cliente ficou com 2 agendamentos.
 *
 * Causas observadas:
 *   - Modelos baratos perdem contexto de "o que já foi feito neste turno".
 *   - Tratam celebrações como nova intenção de ação.
 *   - Ignoram tools de busca antes de modificar (vão direto a criar_evento).
 *
 * Defesa em camadas:
 *   - Camada determinística (criar_evento bloqueia se já existe ativo) — feito.
 *   - Camada determinística (reagendar atômico) — feito.
 *   - Camada probabilística (este bloco): instruções DURAS e VERBALIZADAS
 *     no system prompt para reduzir a probabilidade de erro do LLM.
 *
 * Não substitui as defesas determinísticas — complementa. Mesmo se o LLM
 * ignorar o prompt, criar_evento vai recusar duplicatas.
 */
function buildAgendamentoFlowBlock(): string {
  return [
    "**Fluxo OBRIGATÓRIO de agendamentos (cumpra à risca — modelos pequenos costumam errar aqui):**",
    "1. ANTES de qualquer ação que modifique a agenda (criar/cancelar/remarcar), CHAME `buscar_agendamento_cliente` para saber se o cliente já tem agendamento ativo.",
    "2. Se o cliente JÁ TEM agendamento PENDENTE e quer mudar para outro horário/dia: use `reagendar_evento(scheduleId=<id>, novaData='YYYY-MM-DD', novaHora='HH:MM')` — NUNCA `criar_evento`. Criar um segundo agendamento sem cancelar o primeiro deixa o cliente com agendamento duplicado.",
    "3. Se o cliente quer cancelar e marcar outro: pode chamar `reagendar_evento` direto (faz cancel+create atomicamente) ou `cancelar_evento` seguido de `criar_evento`. Mas NUNCA crie um novo enquanto o anterior segue PENDENTE.",
    "4. Confirmações curtas do cliente — 'perfeito', 'ok', 'sim', 'beleza', 'pode confirmar', '👍' — NÃO são novas solicitações. Quando você acabou de confirmar um agendamento e o cliente celebra, apenas responda agradecendo/finalizando. NÃO chame nenhuma tool de modificação.",
    "5. Se a tool `criar_evento` retornar um erro mencionando 'cliente já tem agendamento #X' ou 'use reagendar_evento', SIGA a instrução do erro — chame `reagendar_evento` com o scheduleId indicado. NÃO tente criar de novo.",
    "6. Antes de afirmar ao cliente que algo foi cancelado/remarcado, confira que a tool retornou `sucesso: true`. Se retornou erro ou aviso, repasse o estado real — nunca minta dizendo 'já foi'.",
    "7. **REMARCAÇÃO — SERVIÇO É PRESERVADO AUTOMATICAMENTE:** Ao usar `reagendar_evento`, NÃO informe servicoId — o serviço ORIGINAL do agendamento é preservado. NÃO mude o serviço ao remarcar, mesmo que o cliente mencione um problema diferente ('quebrei o dente', 'estou com dor') como contexto. A remarcação apenas muda data/hora, o serviço fica intacto. Se o cliente quiser OUTRO serviço além de remarcar, isso é um fluxo separado: cancele com `cancelar_evento` e crie novo com `criar_evento` com o serviço correto. NÃO use `criar_evento` para remarcar — isso cria duplicata e usa o serviço errado.",
    // Bug #27 (Round 10): cliente responde com número ('1', '2') após lista numerada →
    // LLM não mapeava para o item da lista e pedia repetição em texto.
    "8. **SELEÇÃO POR NÚMERO:** Se você acabou de listar serviços ou opções numeradas e o cliente responde com um número ('1', '2', '3'...), interprete IMEDIATAMENTE como seleção do item correspondente — sem pedir confirmação em texto. Ex: você listou '1. Avaliação odontológica' e o cliente enviou '1' → trate como se tivesse dito 'Avaliação odontológica' e prossiga com o fluxo de agendamento daquele serviço.",
    // Bug #28 (Round 10): LLM chamava verificar_disponibilidade com data de amanhã
    // antes de checar hoje, deixando agenda do dia ociosa.
    "9. **PRIORIDADE HOJE — use buscar_proximo_horario PRIMEIRO:** Quando o cliente quer agendar e NÃO especificou data concreta, SEMPRE chame `buscar_proximo_horario` (começa por HOJE). NUNCA chame `verificar_disponibilidade` com data futura antes de confirmar se há vaga hoje. Um horário ocioso hoje custa mais que um amanhã cheio. Só use `verificar_disponibilidade` quando o cliente pedir EXPLICITAMENTE por um dia específico ('quero na sexta', 'tem vaga dia 15?').",
    // Bug #29 (Round 10): após propor horário e ouvir confirmação, LLM re-listava
    // slots em vez de ir direto ao criar_evento.
    "10. **CONFIRMAÇÃO DE HORÁRIO — vá direto ao criar_evento:** Se você JÁ propôs um horário específico ao cliente (ex: 'Temos às 10h disponível, confirma?') e o cliente confirma aquele horário (ex: 'sim', 'pode ser', 'às 10 então', 'quero esse', '10h está bom'), chame DIRETAMENTE `criar_evento` com data e hora já conhecidas. NUNCA chame `verificar_disponibilidade` de novo — o cliente está CONFIRMANDO, não pedindo nova busca. Re-listar disponibilidade após o cliente confirmar quebra a experiência e o faz repetir informação desnecessariamente.",
    // Bug #30 (Round 11): cliente perguntou 'que horários tem na quinta?' (sem
    // serviço) e o bot dumpou todos os 4 serviços × ~10 slots cada = lista enorme.
    // Bug #31 regressão: após remover agentServices, LLM passou a chamar
    // listar_servicos → e então verificar_disponibilidade para CADA serviço da
    // lista, em sequência. Regra reforçada para fechar esse caminho também.
    "11. **PERGUNTE O SERVIÇO PRIMEIRO — NUNCA verifique disponibilidade de mais de um serviço por turno:** Se o cliente perguntar horários SEM especificar qual procedimento (ex: 'que horários tem hoje?', 'horários da quinta', 'quando tem vaga?', 'que horários tem na quinta a tarde?'), siga EXATAMENTE:\n" +
    "   **EXCEÇÃO:** se já houver um bloco '**Serviço em discussão nesta conversa:**' acima, o serviço JÁ está definido — NÃO pergunte de novo nem chame `listar_servicos`. Use aquele serviço e vá direto à consulta de disponibilidade.\n" +
    "   a) Use `listar_servicos` para obter os nomes dos serviços disponíveis.\n" +
    "   b) Apresente APENAS os nomes, sem horários. Ex: 'Temos: 1. Avaliação, 2. Limpeza, 3. Reparo. Qual desses você precisa?'\n" +
    "   c) AGUARDE o cliente escolher o serviço.\n" +
    "   d) Só DEPOIS da escolha, chame `verificar_disponibilidade` ou `buscar_proximo_horario` para AQUELE serviço específico.\n" +
    "   PROIBIDO: chamar verificar_disponibilidade ou buscar_proximo_horario para múltiplos serviços em um mesmo turno, mesmo que sequencialmente. Um turno = no máximo 1 consulta de disponibilidade, para 1 serviço.",
    // Bug #33 (2026-05-24): LLM voltava ao serviço anterior (mais citado no histórico)
    // ao receber "Quero agendar" após o cliente mudar de serviço.
    // Regra probabilística complementa a injeção determinística do buildLastServiceBlock.
    "12. **SERVIÇO MAIS RECENTE — use o último, não o mais citado:** Quando o cliente confirma intenção de agendar ('quero agendar', 'pode marcar', 'quero esse', 'sim', 'ok') sem nomear o serviço, use o serviço discutido MAIS RECENTEMENTE nesta conversa — não o primeiro, não o mais citado, o ÚLTIMO. Se o system prompt tiver um bloco '**Serviço em discussão nesta conversa:**', use ESSE serviço e não procure outro. Só chame `listar_servicos` se nenhum serviço foi mencionado nesta conversa.",
    // Bug #35 (2026-05-28): cliente pedia "de manhã"/"à tarde"/"de noite" e o LLM
    // (gpt-4o-mini) recebia o dia inteiro e tentava filtrar sozinho — falhava e
    // respondia "não consegui verificar a disponibilidade". Agora o filtro é
    // determinístico via parâmetro `periodo` das tools. A regra abaixo apenas
    // garante que o LLM REPASSE o termo do cliente em vez de filtrar manualmente.
    "13. **PERÍODO DO DIA — repasse, não filtre:** Se o cliente mencionar um período ('de manhã', 'à tarde', 'de tarde', 'de noite', 'mais cedo'), passe o argumento `periodo` (`'manha'`, `'tarde'` ou `'noite'`) para `verificar_disponibilidade` ou `buscar_proximo_horario`. A tool já devolve SOMENTE os horários daquele período — você NUNCA deve filtrar a lista você mesmo nem dizer que 'não conseguiu verificar'. Se a tool retornar lista vazia para o período, ofereça os horários de outro período do dia.",
    // Feature UX-1 (2026-05-31): em vez de listar cada slot individualmente
    // ("12:00, 13:00, 14:00, …"), o campo `rangeFormatado` já traz a faixa
    // pronta ("das 12:00 às 18:00"). Isso reduz mensagens longas no WhatsApp.
    "14. **APRESENTE DISPONIBILIDADE COMO FAIXA — use `rangeFormatado`:** Ao informar disponibilidade ao cliente, use o campo `rangeFormatado` de cada profissional no resultado de `verificar_disponibilidade` (ex: 'Amanda tem horários das 13:00 às 18:00. Qual prefere?'). A lista de horários individuais NÃO é fornecida de propósito — apresente SEMPRE a faixa e pergunte qual horário o cliente prefere. Quando o cliente escolher um horário dentro da faixa, chame `criar_evento` com aquele horário — a validação de que o horário está livre é automática (se estiver ocupado/fora do expediente, `criar_evento` devolve erro com os horários livres para você reofertar).",
    // Bug #B1 (2026-06-20): cliente perguntava "tem às 11h?" e o bot respondia
    // "não consegui verificar" — porque após o Bug #39 a tool só devolve a faixa,
    // não a lista de slots, e o LLM não conseguia decidir se 11h cabia na faixa.
    // Agora verificar_disponibilidade aceita `hora` e devolve `horaConsultadaDisponivel`.
    "15. **HORÁRIO ESPECÍFICO — responda pelo campo `horaConsultadaDisponivel`, NUNCA diga 'não consegui verificar':** Se o cliente perguntar por um horário exato ('tem às 11h?', 'pode 14:30?', 'consigo às 9h?'), chame `verificar_disponibilidade` passando `hora` (ex: '11:00') e a data em discussão. O resultado traz `horaConsultadaDisponivel` (true/false): se TRUE, confirme ('Sim! Às 11h a Amanda está livre. Posso agendar?'); se FALSE, diga que aquele horário não está livre e ofereça a faixa `rangeFormatado` ('Às 11h não tenho, mas tenho das 13:00 às 18:00. Qual prefere?'). É PROIBIDO responder 'não consegui verificar' — a resposta é determinística e está no campo.",
    // Problema do dia da semana (2026-06-20): a regra 8 antiga proibia mencionar
    // o dia da semana. Agora as tools devolvem `dataFormatada` já com o dia certo.
    "16. **DIA DA SEMANA — use `dataFormatada` das tools (já vem correto):** Ao mencionar uma data ao cliente, inclua o dia da semana para soar natural ('segunda-feira, 22/06/2026'). Use SEMPRE o campo `dataFormatada` devolvido pelas tools (verificar_disponibilidade / buscar_proximo_horario) ou a tabela de calendário do bloco temporal — ambos já trazem o dia da semana calculado corretamente. NUNCA calcule o dia da semana de cabeça; se não tiver o dado pronto, diga só a data."
  ].join("\n");
}

/**
 * Processa uma mensagem recebida no canal agente e retorna a resposta final.
 * Executa o loop agêntico com suporte a tool calls até obter uma resposta de texto.
 */
export async function handleClientAgent(
  input: HandleClientAgentInput
): Promise<HandleClientAgentOutput> {
  const { companyId, ticketId, contactId, contactName, contactNumber, userMessage, whatsappId } = input;

  // Camada de segurança — input: sanitizar e logar tentativas de injeção.
  // sanitizeUserMessage remove padrões de prompt injection e trunca mensagens suspeitas
  // de padding attack. Feito ANTES de qualquer uso de userMessage no loop.
  const { sanitized: sanitizedMessage, injectionDetected } = sanitizeUserMessage(userMessage);
  if (injectionDetected) {
    logger.warn(
      `[AgentService][SECURITY] Tentativa de prompt injection detectada e sanitizada | ` +
      `ticket=${ticketId} company=${companyId}`
    );
  }

  try {
    const [providerConfig, basePrompt, history] = await Promise.all([
      loadProviderConfig(companyId),
      buildSystemPrompt(companyId),
      loadContext(companyId, ticketId)
    ]);

    const temperature = getTemperatureForPersonality(providerConfig.personality);

    // Identidade do contato é informação operacional, não vai no template
    // de personalidade — mas o LLM precisa para não pedir "qual seu número?".
    const contactBlock = buildContactContextBlock(contactName, contactNumber, ticketId, contactId);
    // Contexto temporal — sem ele o LLM trata "hoje" como qualquer dia
    // do treino e cria agendamentos no passado (bug #11).
    const dateTimeBlock = buildCurrentDateTimeBlock();
    // Fluxo de agendamento — instruções duras para o LLM não criar duplicatas
    // ou interpretar celebrações como nova intenção (bug #17).
    const flowBlock = buildAgendamentoFlowBlock();
    // Fluxo de execução — modelos baratos prometem ação sem chamar tool;
    // este bloco força o LLM a executar antes de responder (bug #20).
    const executionBlock = buildExecutionFlowBlock();
    // Bloco de segurança — prompt hardening probabilístico: instrui o LLM a ignorar
    // tentativas de override, não revelar dados internos e manter escopo de atendimento.
    // Complementa as defesas determinísticas (sanitizeUserMessage + checkOutputSafety).
    const securityBlock = buildSecurityBlock();
    // Bug #33: injeta deterministicamente o último serviço discutido na conversa.
    // Resolve o problema do LLM escolher o serviço mais frequente (antigo) em vez
    // do mais recente quando o cliente diz "quero agendar" sem nomear o serviço.
    // Usa `history` (não `activeHistory`) porque a compactação ainda não aconteceu
    // neste ponto do código — os dois têm as mesmas mensagens recentes com tool results.
    // A compactação preserva as últimas 10 mensagens, onde os tool results relevantes
    // sempre estarão, então o resultado é idêntico independente de compactação.
    const lastService = extractLastDiscussedService(history);
    const lastServiceBlock = buildLastServiceBlock(lastService);
    if (lastService) {
      logger.info(
        `[AgentService] Injetando serviço em contexto: "${lastService}" | ticket=${ticketId}`
      );
    }
    // Bug #B2 (2026-06-20): âncora determinística da última DATA discutida.
    // Sem ela, "tem às 11h?" (sem repetir o dia) fazia o LLM chamar a tool com
    // data faltando/errada. Análogo ao lastServiceBlock, mas para a data.
    const lastDateIso = extractLastDiscussedDate(history);
    const lastDateBlock = buildLastDateBlock(lastDateIso);
    if (lastDateIso) {
      logger.info(
        `[AgentService] Injetando data em contexto: "${lastDateIso}" | ticket=${ticketId}`
      );
    }
    const systemPrompt = [basePrompt, dateTimeBlock, executionBlock, flowBlock, securityBlock, lastServiceBlock, lastDateBlock, contactBlock]
      .filter(Boolean)
      .join("\n\n");

    const provider = AIProviderFactory.create(providerConfig);

    // ── Compactação de contexto ──────────────────────────────────────────────
    // Tickets longos (50+ mensagens) fazem o LLM "esquecer" o início da conversa.
    // Quando o histórico supera COMPACTION_THRESHOLD, as mensagens antigas são
    // substituídas por um resumo gerado pelo LLM antes de montar o array final.
    //
    // Decisão arquitetural: a chamada ao LLM para gerar o resumo fica aqui (index.ts)
    // e não no contextManager porque contextManager é puro Redis/cache — não tem
    // acesso ao provider. O contextCompactor.ts contém apenas funções puras.
    // Registrado em decisions_log.md (compaction design, 2026-05-23).
    let activeHistory = history;
    if (shouldCompact(activeHistory)) {
      try {
        // Mensagens "antigas" = tudo exceto as últimas 10
        const oldMessages = activeHistory.slice(0, -10);
        const contextText = buildCompactionContext(oldMessages);
        const summaryPrompt =
          "Você é um assistente de sumarização. Leia a conversa abaixo e produza um " +
          "resumo conciso (máximo 3 parágrafos) em português, capturando: " +
          "quem é o cliente, o que ele quer/precisa, e quaisquer dados importantes " +
          "(nome, serviço escolhido, datas mencionadas, agendamentos feitos). " +
          "NÃO inclua sua opinião — apenas fatos da conversa.\n\n" +
          "CONVERSA:\n" + contextText;

        const summaryResponse = await provider.chat(
          [{ role: "user", content: summaryPrompt }],
          "Você é um assistente de sumarização de conversas de atendimento ao cliente.",
          { temperature: 0, maxTokens: 512 }
        );

        if (summaryResponse.content && summaryResponse.content.trim().length > 0) {
          activeHistory = applyCompaction(activeHistory, summaryResponse.content.trim(), 10);
          // Persiste já compactado para que a próxima mensagem do cliente
          // não precise compactar novamente (evita chamada duplicada ao LLM).
          await saveContext(companyId, ticketId, activeHistory);
          logger.info(
            `[AgentService][Compaction] Histórico compactado | ticket=${ticketId} ` +
            `originalCount=${history.length} newCount=${activeHistory.length}`
          );
        } else {
          // Resumo vazio: mantém histórico original e loga para diagnóstico.
          logger.warn(
            `[AgentService][Compaction] LLM retornou resumo vazio — mantendo histórico original | ` +
            `ticket=${ticketId} historyCount=${history.length}`
          );
        }
      } catch (compactionErr) {
        // Falha na compactação não deve bloquear o atendimento — usa histórico original.
        // O erro é logado com contexto suficiente para diagnóstico posterior.
        logger.error(
          `[AgentService][Compaction] Falha ao compactar contexto — usando histórico original | ` +
          `ticket=${ticketId} company=${companyId}: ${(compactionErr as Error).message}`
        );
      }
    }
    // ── Fim da compactação ───────────────────────────────────────────────────

    // Camada de segurança — wrapping: envolve a mensagem sanitizada com delimitadores
    // [MENSAGEM_CLIENTE_INICIO]...[MENSAGEM_CLIENTE_FIM] para que o LLM (instruído no
    // securityBlock) trate o conteúdo como "dados do cliente", não "instrução do sistema".
    // O histórico não é envolto pois já foi salvo e o LLM tem contexto do securityBlock.
    const messages: AIMessage[] = [
      ...activeHistory,
      { role: "user", content: wrapUserMessage(sanitizedMessage) }
    ];

    // Mantém o último texto não-vazio que o LLM já gerou — se o loop estourar
    // sem síntese final, ainda enviamos algo coerente em vez do FALLBACK.
    let lastNonEmptyContent: string | null = null;
    let finalReply: string = FALLBACK_REPLY;
    let iterations = 0;

    // Bug #32: gate determinístico anti-multi-availability dump.
    // Rule 11 (prompt) tentava impedir o LLM de consultar disponibilidade de
    // múltiplos serviços em um mesmo turno, mas como regra de prompt é
    // probabilística o LLM ignorava. Aqui rastreamos os servicoIds já
    // consultados no TURNO ATUAL — uma 2ª chamada para servicoId diferente
    // recebe um tool result de bloqueio em vez de executar de fato.
    const availabilityServicosThisTurn = new Set<number>();
    const AVAILABILITY_TOOLS = new Set(["verificar_disponibilidade", "buscar_proximo_horario"]);

    // Gate anti-assunção-de-serviço (Bug #A, 2026-06-27): rastreia se listar_servicos
    // foi chamado neste run. Junto com isPureScheduleRequest, impede que o modelo busque
    // disponibilidade imediatamente após listar serviços sem o cliente ter escolhido.
    let listarServicosCalledThisRun = false;
    let cachedServicosThisRun: Array<{ id: number; nome: string }> = [];

    // Causa-raiz "não consegui verificar" (2026-06-21): se o cliente perguntou um
    // horário específico ("tem às 11h?") e o modelo se esquiva sem chamar a tool,
    // forçamos UMA re-iteração instruindo-o a verificar de fato. `horaPerguntada`
    // marca que houve pergunta de horário neste turno; o flag evita loop infinito.
    const horaPerguntada = extractTimeFromMessage(sanitizedMessage);
    let availabilityDodgeRetryUsed = false;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await provider.chatWithTools(
        messages,
        ALL_AGENT_TOOLS,
        systemPrompt,
        { temperature }
      );

      if (response.finishReason === "error") {
        logger.error(
          `[AgentService] provider=${providerConfig.provider} model=${providerConfig.model} ticket=${ticketId} retornou finishReason=error na iter ${iterations} (provavelmente erro HTTP do provedor — checar payload acima)`
        );
        break;
      }

      // Fallback para LLMs que emitem pseudo-XML (`<function=NAME=...>...</function>`)
      // em vez de tool_calls estruturados — comportamento observado com Llama via Groq.
      // Só ativa quando o provider não retornou toolCalls nativos.
      const nativeToolCalls = response.toolCalls ?? [];
      let effectiveToolCalls = nativeToolCalls;
      let effectiveContent = response.content;
      if (nativeToolCalls.length === 0 && response.content) {
        const parsed = parsePseudoXmlToolCalls(response.content);
        if (parsed.toolCalls.length > 0) {
          effectiveToolCalls = parsed.toolCalls;
          effectiveContent = parsed.cleanedText;
          logger.info(
            `[AgentService] pseudo-XML detectado e parseado: ${parsed.toolCalls.length} tool(s) | ticket=${ticketId} model=${providerConfig.model}`
          );
        }
      }

      if (effectiveContent && effectiveContent.trim().length > 0) {
        lastNonEmptyContent = effectiveContent;
      }

      if (effectiveToolCalls.length === 0) {
        // Causa-raiz "não consegui verificar" (2026-06-21): o cliente perguntou um
        // horário específico e o modelo se esquivou ("não consegui verificar a
        // disponibilidade") SEM chamar a tool. Forçamos uma re-iteração obrigando-o
        // a chamar verificar_disponibilidade — os args (data/hora) são preenchidos
        // pela injeção determinística do loop. Tem prioridade sobre o promise-text.
        if (
          effectiveContent &&
          horaPerguntada &&
          !availabilityDodgeRetryUsed &&
          iterations < MAX_ITERATIONS - 1 &&
          looksLikeAvailabilityDodge(effectiveContent)
        ) {
          availabilityDodgeRetryUsed = true;
          logger.warn(
            `[AgentService] esquiva de disponibilidade detectada (cliente pediu hora=${horaPerguntada}) ` +
            `sem tool call (iter ${iterations}) | ticket=${ticketId} model=${providerConfig.model} → forçando verificação`
          );
          messages.push({ role: "assistant", content: effectiveContent });
          messages.push({
            role: "user",
            content:
              `[SISTEMA]: Você disse que não conseguiu verificar a disponibilidade, mas NÃO chamou ` +
              `nenhuma ferramenta — isso é proibido. Chame verificar_disponibilidade AGORA, passando ` +
              `o servicoId do serviço em discussão, a data já combinada nesta conversa e hora="${horaPerguntada}". ` +
              `Depois responda objetivamente ao cliente se o horário ${horaPerguntada} está livre (use o campo ` +
              `horaConsultadaDisponivel do resultado). NUNCA diga que não conseguiu verificar.`
          });
          lastNonEmptyContent = effectiveContent;
          continue; // força próxima iteração
        }

        // Bug #20 Round 8: quando o LLM emite "promise-text" (ex: "Vou listar
        // os serviços que temos") sem chamar nenhuma tool, forçamos re-iteração
        // determinística em vez de aceitar a promessa como resposta final.
        // Injetamos correção no histórico e continuamos o loop — o LLM recebe
        // a mensagem "[SISTEMA]" como instrução de correção e tende a executar.
        // Limitado a `iterations < MAX_ITERATIONS - 1` para preservar headroom.
        if (
          effectiveContent &&
          iterations < MAX_ITERATIONS - 1 &&
          looksLikePromise(effectiveContent)
        ) {
          logger.warn(
            `[AgentService] promise-text sem tool_calls detectado (iter ${iterations}) | ` +
            `ticket=${ticketId} model=${providerConfig.model} → forçando re-iteração`
          );
          messages.push({ role: "assistant", content: effectiveContent });
          messages.push({
            role: "user",
            content:
              "[SISTEMA]: Você prometeu executar uma ação mas não chamou nenhuma ferramenta. " +
              "Execute AGORA usando as tools disponíveis — chame a tool necessária e só depois " +
              "escreva a resposta final ao cliente."
          });
          lastNonEmptyContent = effectiveContent;
          continue; // força próxima iteração sem encerrar o loop
        }

        finalReply = effectiveContent ?? FALLBACK_REPLY;
        messages.push({ role: "assistant", content: finalReply });
        break;
      }

      // CRÍTICO: precisamos preservar `toolCalls` na mensagem assistant.
      // Sem isso a OpenAI rejeita a próxima request com HTTP 400 ("messages
      // with role 'tool' must be a response to a preceeding message with
      // 'tool_calls'"). A Groq aceitava silenciosamente, escondendo o bug.
      // Veja interfaces.ts → AIMessage.toolCalls.
      messages.push({
        role: "assistant",
        content: effectiveContent ?? "",
        toolCalls: effectiveToolCalls as AIToolCall[]
      });

      for (const toolCall of effectiveToolCalls as AIToolCall[]) {
        let result: Record<string, unknown>;

        // Gate anti-assunção-de-serviço (Bug #A, 2026-06-27):
        // Bloqueia buscar_proximo_horario quando o agente acabou de listar serviços
        // mas o cliente ainda não escolheu qual quer. Causa-raiz confirmada nos
        // AgentActions #552→#553: listar_servicos em 17:55:30, buscar_proximo_horario
        // para servicoId:6 (Corte Feminino) em 17:55:34 — modelo assumiu o primeiro
        // da lista. Exceção: lastService != null (serviço já estava em contexto anterior).
        if (
          toolCall.name === "buscar_proximo_horario" &&
          listarServicosCalledThisRun &&
          !lastService &&
          isPureScheduleRequest(sanitizedMessage)
        ) {
          const blockedResult = {
            erro:
              "BLOQUEADO: você acabou de listar os serviços mas o cliente não escolheu " +
              "qual quer. NUNCA assuma um serviço. PERGUNTE: 'Qual serviço você prefere?' " +
              "Aguarde a resposta e só então chame buscar_proximo_horario com o servicoId " +
              "correto para o serviço que o cliente escolheu."
          };
          messages.push({
            role: "tool",
            content: JSON.stringify(blockedResult),
            toolCallId: toolCall.id,
            name: toolCall.name
          });
          try {
            await AgentAction.create({
              companyId, ticketId, contactId,
              action: toolCall.name,
              parameters: toolCall.arguments,
              result: blockedResult,
              success: false,
              provider: providerConfig.provider,
              model: providerConfig.model,
              inputTokens: response.usage?.inputTokens,
              outputTokens: response.usage?.outputTokens
            });
          } catch (logErr) {
            logger.warn(`[AgentService] AgentAction.create falhou (gate BugA) para ${toolCall.name}: ${(logErr as Error).message}`);
          }
          continue;
        }

        // Gate de servicoId em criar_evento (Bug #B3, 2026-06-27):
        // AgentActions #556 confirmou: modelo usou servicoId:1 (inexistente) em criar_evento,
        // causando erro e re-tentativa. Se já temos a lista de serviços em cache, validamos
        // antes de executar — economiza 1 round-trip desnecessário com o banco.
        if (toolCall.name === "criar_evento" && cachedServicosThisRun.length > 0) {
          const servicoIdArg = (toolCall.arguments as any)?.servicoId;
          if (typeof servicoIdArg === "number") {
            const servicoValido = cachedServicosThisRun.some(s => s.id === servicoIdArg);
            if (!servicoValido) {
              const listaValida = cachedServicosThisRun.map(s => `${s.id} (${s.nome})`).join(", ");
              const blockedResult = {
                erro:
                  `servicoId ${servicoIdArg} não existe. IDs válidos: [${listaValida}]. ` +
                  "Use o servicoId correto de acordo com o serviço que o cliente escolheu."
              };
              messages.push({
                role: "tool",
                content: JSON.stringify(blockedResult),
                toolCallId: toolCall.id,
                name: toolCall.name
              });
              try {
                await AgentAction.create({
                  companyId, ticketId, contactId,
                  action: toolCall.name,
                  parameters: toolCall.arguments,
                  result: blockedResult,
                  success: false,
                  provider: providerConfig.provider,
                  model: providerConfig.model,
                  inputTokens: response.usage?.inputTokens,
                  outputTokens: response.usage?.outputTokens
                });
              } catch (logErr) {
                logger.warn(`[AgentService] AgentAction.create falhou (gate BugB3) para ${toolCall.name}: ${(logErr as Error).message}`);
              }
              continue;
            }
          }
        }

        // Bug #32: gate determinístico — bloqueia consulta de disponibilidade
        // para um 2º serviço no mesmo turno. Mesmo que o LLM ignore a Rule 11
        // do prompt, este gate impede o despejo de "todos os serviços × todos
        // os horários". O LLM recebe um erro instrutivo e é forçado a perguntar
        // ao cliente qual procedimento ele quer antes de continuar.
        if (AVAILABILITY_TOOLS.has(toolCall.name)) {
          const servicoId = (toolCall.arguments as any)?.servicoId;
          if (typeof servicoId === "number") {
            if (
              availabilityServicosThisTurn.size > 0 &&
              !availabilityServicosThisTurn.has(servicoId)
            ) {
              const alreadyChecked = Array.from(availabilityServicosThisTurn).join(", ");
              logger.warn(
                `[AgentService][Bug#32] Bloqueada consulta de disponibilidade para serviço diferente no mesmo turno | ` +
                `ticket=${ticketId} tool=${toolCall.name} servicoId_tentado=${servicoId} servicosJaConsultados=[${alreadyChecked}]`
              );
              const blockedResult = {
                erro:
                  "BLOQUEADO: você já consultou disponibilidade para outro serviço neste turno " +
                  `(serviço(s) já consultado(s): ${alreadyChecked}). ` +
                  "É PROIBIDO consultar disponibilidade de mais de um serviço por turno. " +
                  "Em vez disso, PERGUNTE ao cliente qual procedimento ele quer agendar, " +
                  "AGUARDE a resposta dele, e só então consulte disponibilidade APENAS daquele serviço escolhido."
              };
              messages.push({
                role: "tool",
                content: JSON.stringify(blockedResult),
                toolCallId: toolCall.id,
                name: toolCall.name
              });
              // Loga a ação bloqueada para auditoria (mesmo padrão do happy path)
              try {
                await AgentAction.create({
                  companyId,
                  ticketId,
                  contactId,
                  action: toolCall.name,
                  parameters: toolCall.arguments,
                  result: blockedResult,
                  success: false,
                  provider: providerConfig.provider,
                  model: providerConfig.model,
                  inputTokens: response.usage?.inputTokens,
                  outputTokens: response.usage?.outputTokens
                });
              } catch (logErr) {
                logger.warn(
                  `[AgentService] AgentAction.create falhou (gate Bug#32) para ${toolCall.name}: ${(logErr as Error).message}`
                );
              }
              continue; // não executa a tool — vai para o próximo toolCall
            }
            // NÃO contabiliza aqui: o serviço só entra no gate APÓS uma consulta
            // BEM-SUCEDIDA (ver bloco pós-execução). Antes, um servicoId alucinado
            // pelo modelo (ex: 1, inexistente) era contado e bloqueava a tentativa
            // correta (ex: 6) no mesmo turno — bug confirmado nos AgentActions (#502→#504).
          }

          // Bug #37 (2026-05-31): injeção DETERMINÍSTICA do período.
          // O fix do Bug #35 moveu o FILTRO de período para dentro da tool, mas
          // deixou o TRIGGER (o LLM passar `periodo`) ainda probabilístico —
          // gpt-4o-mini frequentemente NÃO emite o argumento ao receber "E para a
          // tarde?", então a tool devolvia o dia inteiro e o modelo voltava a
          // falhar ("não consegui verificar" / "apenas pela manhã").
          //
          // Aqui extraímos o período da MENSAGEM ATUAL do cliente (determinístico,
          // independente do modelo) e o injetamos nos args quando o LLM o omitiu.
          // Usamos sanitizedMessage (turno atual) — nunca o histórico — para não
          // arrastar período de turnos anteriores. Se o LLM já passou um período
          // válido, respeitamos a escolha dele e não sobrescrevemos.
          const argsObj = toolCall.arguments as Record<string, unknown>;
          if (!normalizePeriod(argsObj.periodo as string | undefined)) {
            const periodoDaMensagem = normalizePeriod(sanitizedMessage);
            if (periodoDaMensagem) {
              argsObj.periodo = periodoDaMensagem;
              logger.info(
                `[AgentService][Bug#37] periodo="${periodoDaMensagem}" injetado deterministicamente ` +
                `em ${toolCall.name} (LLM havia omitido) | ticket=${ticketId}`
              );
            }
          }

          // Bug #B1 (2026-06-20): injeção DETERMINÍSTICA do horário específico.
          // Mesmo princípio do período (Bug #37): se o cliente perguntou "tem às
          // 11h?" e o LLM esqueceu de passar `hora`, extraímos da mensagem atual e
          // injetamos. Só se aplica a verificar_disponibilidade (única tool que
          // aceita `hora`); buscar_proximo_horario não tem esse parâmetro.
          // Não sobrescreve se o LLM já passou um `hora` válido.
          if (toolCall.name === "verificar_disponibilidade" && !argsObj.hora) {
            const horaDaMensagem = extractTimeFromMessage(sanitizedMessage);
            if (horaDaMensagem) {
              argsObj.hora = horaDaMensagem;
              logger.info(
                `[AgentService][Bug#B1] hora="${horaDaMensagem}" injetada deterministicamente ` +
                `em verificar_disponibilidade (LLM havia omitido) | ticket=${ticketId}`
              );
            }
          }

          // CAUSA-RAIZ "não consegui verificar" (2026-06-21): injeção DETERMINÍSTICA
          // da DATA. verificar_disponibilidade EXIGE `data`, mas modelos baratos a
          // omitem (data "no contexto": "tem às 11h?") ou a malformam ("sexta").
          // Sem data válida a tool falhava e o bot dizia "não consegui verificar".
          // Mesmo princípio do período/hora: quando o LLM não passou uma data ISO
          // válida, resolvemos deterministicamente — primeiro da MENSAGEM atual
          // (ex: "sexta", "26/06"), senão da última data discutida no histórico
          // (ex: refinamento "tem às 11h?" após combinar segunda). buscar_proximo_
          // horario NÃO precisa de data, então não é afetado.
          if (toolCall.name === "verificar_disponibilidade") {
            const dataAtual = argsObj.data;
            const dataValida =
              typeof dataAtual === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dataAtual);
            if (!dataValida) {
              const dataInjetada =
                extractDateFromMessage(sanitizedMessage) ?? lastDateIso;
              if (dataInjetada) {
                argsObj.data = dataInjetada;
                logger.info(
                  `[AgentService][DataInject] data="${dataInjetada}" injetada deterministicamente ` +
                  `em verificar_disponibilidade (LLM havia omitido/malformado: ${JSON.stringify(dataAtual)}) | ticket=${ticketId}`
                );
              } else {
                logger.warn(
                  `[AgentService][DataInject] verificar_disponibilidade sem data válida e sem ` +
                  `data inferível da mensagem/histórico | ticket=${ticketId} data=${JSON.stringify(dataAtual)}`
                );
              }
            }
          }
        }

        try {
          // Bug #22 (Round 8): contactId não era repassado ao contexto das tools,
          // então quando o LLM omitia contactId nos args de criar_evento, o
          // Sequelize recebia contactId=undefined e a query "WHERE contactId = undefined"
          // não encontrava o agendamento existente — bypassando o check anti-duplicata.
          // Fix: incluir contactId do input do AgentService no contexto de execução.
          const exec = await executeAgentTool(toolCall.name, toolCall.arguments, {
            companyId,
            ticketId,
            whatsappId,
            contactId
          });
          result = exec.result;
        } catch (toolErr) {
          logger.error(
            `[AgentService] tool ${toolCall.name} lançou exceção | ticket=${ticketId} args=${JSON.stringify(toolCall.arguments)}: ${(toolErr as Error).message}`
          );
          result = { erro: `Falha ao executar ${toolCall.name}: ${(toolErr as Error).message}` };
        }

        // Fix do gate Bug #32 (2026-06-21, confirmado nos AgentActions do ticket 22):
        // só contabiliza o serviço no gate anti-"despejo de múltiplos serviços" APÓS
        // uma consulta de um serviço que REALMENTE EXISTE. O modelo barato alucina um
        // servicoId inexistente (ex: 1) o tempo todo; se contássemos esse ID falho, ele
        // BLOQUEARIA a tentativa correta (ex: 6) no MESMO turno — o agente travava e
        // re-perguntava o serviço (#502→#504 e #543→#545 nos AgentActions).
        //
        // As DUAS tools sinalizam "serviço não encontrado" de formas diferentes:
        //   - verificar_disponibilidade → { erro: "Serviço #1 não encontrado." }
        //   - buscar_proximo_horario    → { encontrado: false, mensagem: "Serviço não encontrado." }
        // Por isso checamos AMBOS os sinais. "Sem slots" (serviço existe, agenda cheia)
        // NÃO é "não encontrado" → continua contando, preservando a intenção do gate.
        if (AVAILABILITY_TOOLS.has(toolCall.name)) {
          const r = result as any;
          const servicoNaoEncontrado =
            (typeof r.erro === "string" && /n[ãa]o encontrad/i.test(r.erro)) ||
            (r.encontrado === false && typeof r.mensagem === "string" && /n[ãa]o encontrad/i.test(r.mensagem));
          if (!servicoNaoEncontrado && !r.erro) {
            const sid = (toolCall.arguments as any)?.servicoId;
            if (typeof sid === "number") availabilityServicosThisTurn.add(sid);
          }
        }

        // Popula cache de serviços para os gates BugA e BugB3.
        // Só atualiza quando listar_servicos retorna com sucesso (sem campo erro).
        if (toolCall.name === "listar_servicos" && !(result as any).erro) {
          const r = result as any;
          if (Array.isArray(r.servicos)) {
            listarServicosCalledThisRun = true;
            cachedServicosThisRun = r.servicos.map((s: any) => ({
              id: Number(s.id),
              nome: String(s.nome)
            }));
          }
        }

        try {
          await AgentAction.create({
            companyId,
            ticketId,
            contactId,
            action: toolCall.name,
            parameters: toolCall.arguments,
            result,
            success: !(result as any).erro,
            provider: providerConfig.provider,
            model: providerConfig.model,
            inputTokens: response.usage?.inputTokens,
            outputTokens: response.usage?.outputTokens
          });
        } catch (logErr) {
          // AgentAction.create falhar não deve abortar a resposta ao cliente
          logger.warn(
            `[AgentService] AgentAction.create falhou para ${toolCall.name}: ${(logErr as Error).message}`
          );
        }

        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
          name: toolCall.name
        });
      }
    }

    if (iterations >= MAX_ITERATIONS && finalReply === FALLBACK_REPLY) {
      logger.warn(
        `[AgentService] MAX_ITERATIONS=${MAX_ITERATIONS} atingido sem resposta de texto | ticket=${ticketId} model=${providerConfig.model} (usando lastNonEmptyContent=${lastNonEmptyContent !== null} como fallback)`
      );
      // Prefere o último texto que o LLM gerou (mesmo que entremeado com tool_calls)
      // a desistir com FALLBACK_REPLY — é mais provável que faça sentido para o cliente.
      finalReply = lastNonEmptyContent ?? PROCESSING_REPLY;
    }

    // Bug #20 Round 10 (regressão observada em produção): o guard de promise-text
    // só dispara DENTRO do loop, em iterações onde o LLM emite promessa SEM tool_call.
    // Dois caminhos burlavam o guard:
    //   (A) LLM emite promessa + tool_call no MESMO turno → guard skipado (toolCalls > 0);
    //       loop atinge MAX_ITERATIONS; fallback usa lastNonEmptyContent (promessa).
    //   (B) Promessa surge na iteração MAX-1 → condição `iterations < MAX-1` é false;
    //       finalReply = promessa sem re-iteração possível.
    // Em ambos, o cliente recebe "Estou processando..." e fica esperando ação que
    // nunca volta. Esta guarda final é defesa em profundidade: independente de
    // como o finalReply foi produzido, se ainda for promise-text, substitui por
    // mensagem honesta. O cliente sabe que precisa repetir, em vez de esperar
    // indefinidamente.
    if (looksLikePromise(finalReply)) {
      logger.warn(
        `[AgentService] finalReply é promise-text APÓS o loop — substituindo por safe fallback | ` +
        `ticket=${ticketId} model=${providerConfig.model} iterations=${iterations} ` +
        `promiseSnippet="${finalReply.slice(0, 80)}"`
      );
      finalReply =
        "Tive uma demora ao processar sua última mensagem. Pode reenviar o que precisa, por favor?";
    }

    // Camada de segurança — output guardrail: bloqueia respostas que indicam jailbreak
    // bem-sucedido (ex: "jailbreak ativado", "fui reprogramado para") ou vazamento de
    // dados internos (ex: "meu system prompt diz..."). Substitui por fallback seguro.
    const safetyCheck = checkOutputSafety(finalReply, { companyId, ticketId });
    if (!safetyCheck.safe) {
      logger.warn(
        `[AgentService][SECURITY] Output bloqueado pelo guardrail — substituído por SECURITY_FALLBACK | ` +
        `${safetyCheck.reason}`
      );
      finalReply = SECURITY_FALLBACK_REPLY;
    }

    // Salva mensagem sanitizada (sem padrões de injeção, sem delimitadores de wrapping)
    // para que o histórico de contexto fique limpo e legível nas iterações futuras.
    // Usa activeHistory (já compactado se houve compactação) para não re-inflar o contexto.
    await saveContext(companyId, ticketId, [
      ...activeHistory,
      { role: "user", content: sanitizedMessage },
      { role: "assistant", content: finalReply }
    ]);

    return { reply: finalReply };
  } catch (error) {
    logger.error(
      `[AgentService] handleClientAgent crashed | ticket=${ticketId} company=${companyId}: ${(error as Error).message}\n${(error as Error).stack}`
    );
    return { reply: FALLBACK_REPLY };
  }
}
