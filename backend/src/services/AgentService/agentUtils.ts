/**
 * agentUtils — funções puras utilitárias do AgentService.
 *
 * Sem dependências externas (Sequelize, Redis, googleapis) — 100% testáveis.
 * Responsabilidade única: lógica de extração e análise de histórico de conversa.
 */

import { AIMessage } from "./providers/interfaces";

// Nomes dos dias da semana em PT-BR, indexados por Date.getDay() (0=domingo, 6=sábado)
const DAY_NAMES_PT = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado"
];

/**
 * Gera o calendário dos próximos 7 dias a partir de `now`.
 *
 * Bug #35 (2026-05-25): LLMs têm aritmética de calendário não-confiável.
 * Exemplo real: cliente pediu "terça a tarde" (26/05/2026) → LLM computou
 * 30/05/2026 (sábado!) como próxima terça. Causa: o modelo não tem acesso
 * a aritmética de calendário confiável e comete erros de cálculo simples.
 *
 * Fix: fornecer tabela explícita dia-da-semana → data para os próximos 7 dias
 * no system prompt, removendo a necessidade de qualquer cálculo do LLM.
 *
 * @param now - Data de referência (tipicamente `new Date()` em BRT)
 * @returns Array de 7 entradas, cada uma com dayName, dateStr (DD/MM/AAAA) e iso (YYYY-MM-DD)
 *
 * @example
 * buildWeekCalendar(new Date("2026-05-25T12:00:00-03:00"))
 * // [
 * //   { dayName: "segunda-feira", dateStr: "25/05/2026", iso: "2026-05-25" },
 * //   { dayName: "terça-feira",   dateStr: "26/05/2026", iso: "2026-05-26" },
 * //   ...
 * // ]
 */
export function buildWeekCalendar(now: Date): Array<{ dayName: string; dateStr: string; iso: string }> {
  const TZ = "America/Sao_Paulo";
  const fmtDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric"
  });
  const fmtISO = (d: Date): string =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(d);

  const entries: Array<{ dayName: string; dateStr: string; iso: string }> = [];
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const iso = fmtISO(d);
    // Parseia ISO como data de calendário local para getDay() correto e estável
    // (evita o bug de UTC midnight que troca dia em fusos negativos — Bug #10)
    const [y, m, day] = iso.split("-").map(Number);
    const dayOfWeek = new Date(y, m - 1, day).getDay();
    entries.push({
      dayName: DAY_NAMES_PT[dayOfWeek],
      dateStr: fmtDate.format(d),
      iso
    });
  }
  return entries;
}

/**
 * Formata uma Date como "YYYY-MM-DD" no fuso `timeZone` (default BRT).
 * Usa `en-CA` porque essa locale produz ISO date nativamente.
 *
 * @param date - data a formatar
 * @param timeZone - fuso IANA (default America/Sao_Paulo)
 * @returns string ISO "YYYY-MM-DD" no fuso indicado
 */
export function isoLocalDate(date: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

/**
 * Bloco de contexto temporal para o system prompt (Agente E Secretária).
 *
 * Bug #11 (Round 4): LLMs não têm conceito de "agora" — apenas conhecimento
 * histórico do treinamento. Sem este bloco, o LLM dizia "amanhã, dia
 * 27/04/2026" para um cliente que escrevia no próprio dia 27/04, ou — no caso
 * da Secretária (ticket #22, 2026-06-28) — assumia "janeiro de 2025" e listava
 * agendamentos da data errada. Erros em cascata: agendamento no passado, slots
 * já passados, confusão "hoje/amanhã".
 *
 * Fix: injetar data/hora atual em BRT + equivalências de "hoje"/"amanhã" em
 * DD/MM/AAAA (para texto) e ISO YYYY-MM-DD (formato das tools de calendário),
 * mais a tabela explícita dia-da-semana→data (Bug #35) para remover qualquer
 * cálculo de calendário do LLM.
 *
 * Trade-off: TZ hardcoded em America/Sao_Paulo. Aceitável para o produto BR
 * atual; quando houver clientes em outros fusos, virar per-company Setting.
 *
 * @param now - Data de referência (default `new Date()`)
 * @returns bloco de texto pronto para concatenar ao system prompt
 */
export function buildCurrentDateTimeBlock(now: Date = new Date()): string {
  const TZ = "America/Sao_Paulo";
  const fmtDate = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric"
  });
  const fmtTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
  });
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const weekEntries = buildWeekCalendar(now);
  const weekLines = weekEntries.map((e, i) => {
    const dayLabel = i === 0
      ? `Hoje (${e.dayName})`
      : e.dayName.charAt(0).toUpperCase() + e.dayName.slice(1);
    return `  ${dayLabel}: ${e.dateStr} | ISO: ${e.iso}`;
  });

  return [
    "**Contexto temporal (use SEMPRE como referência para 'hoje', 'amanhã', etc.):**",
    `- Data/hora atual: ${fmtDate.format(now)} às ${fmtTime.format(now)} (fuso BRT, UTC-3)`,
    `- "Hoje" = ${fmtDate.format(now)} | ISO para tools: ${isoLocalDate(now, TZ)}`,
    `- "Amanhã" = ${fmtDate.format(tomorrow)} | ISO: ${isoLocalDate(tomorrow, TZ)}`,
    `- "Depois de amanhã" = ${fmtDate.format(dayAfter)} | ISO: ${isoLocalDate(dayAfter, TZ)}`,
    "- **Calendário dos próximos 7 dias (CONSULTE AQUI — NUNCA calcule data de dia da semana você mesmo):**",
    weekLines.join("\n"),
    "REGRAS DURAS:",
    "1. Nunca diga 'amanhã' apontando para uma data que já é HOJE — releia este bloco antes de mencionar uma data.",
    "2. Não ofereça nem confirme horários que já passaram (anteriores à hora atual no dia de hoje). Se pedirem um horário no passado, ofereça o próximo horário FUTURO disponível.",
    "3. Ao chamar tools de calendário (verificar_disponibilidade, criar_evento, consultar_agendamentos, etc.), use as strings ISO (YYYY-MM-DD) deste bloco para 'hoje'/'amanhã'.",
    "4. Quando mencionarem um dia da semana ('terça', 'sexta', 'próximo sábado'), consulte SEMPRE a tabela acima para obter a data ISO correta — NUNCA tente calcular você mesmo. Se o dia não estiver na tabela dos próximos 7 dias (ex: 'próxima semana terça'), use a data da tabela + 7 dias."
  ].join("\n");
}

/**
 * Detecta "promise-text" — resposta do LLM que PROMETE executar uma ação mas não
 * chama nenhuma tool no mesmo turno (ex: "Vou cancelar o agendamento para você").
 *
 * Bug #20 Round 8: a instrução probabilística no prompt não impede modelos baratos
 * (gpt-4o-mini, etc.) de "prometer e parar" sem executar. O orquestrador usa isto
 * para FORÇAR re-iteração determinística — sem depender de o LLM obedecer ao prompt.
 *
 * Aproveitado também pela Secretária (2026-06-28): lá o risco é MAIOR, porque o
 * "prometo e paro" em uma ação destrutiva (cancelar/fechar/enviar) faz a ação NUNCA
 * executar — o admin pede "cancela o 18", o modelo responde "Vou cancelar..." e para.
 *
 * Critérios:
 *   - Contém padrão "vou/vamos/estou [verbo de ação]" (promessa de ação futura);
 *   - NÃO termina em "?" (perguntas legítimas pedindo mais info não são promessa);
 *   - NÃO contém confirmação de ação concluída (✅, "cancelado", "agendado", etc.).
 *
 * @param text - texto gerado pelo LLM
 * @returns true se parece promessa de ação sem execução
 */
export function looksLikePromise(text: string): boolean {
  const lower = text.toLowerCase();
  // Respostas que já são confirmação de sucesso → não é promise-text
  if (/✅|agendado|cancelado|remarcado|confirmado|marcado|enviado|fechado|reaberto|transferido|pronto!|feito!/i.test(lower)) return false;
  // Perguntas legítimas → não é promise-text (LLM pede mais info)
  if (text.trim().endsWith("?")) return false;
  // Padrões de "promessa sem execução" mais comuns nos modelos baratos
  return (
    /\bvou\s+(começar\s+)?(verificar|listar|buscar|checar|agendar|confirmar|cancelar|remarcar|procurar|consultar|ver|fechar|reabrir|transferir|enviar|avisar)\b/i.test(lower) ||
    /\bvamos\s+(verificar|listar|buscar|checar|agendar|consultar|cancelar|fechar|enviar)\b/i.test(lower) ||
    /\bum momento\b.*\b(vou|verificar|buscar|consultar)\b/i.test(lower) ||
    /\bestou\s+(verificando|buscando|processando|listando|checando|consultando|cancelando|enviando)\b/i.test(lower) ||
    /\bdeixa\s+(eu|me)\s+(verificar|ver|buscar|consultar|checar|cancelar|enviar)\b/i.test(lower) ||
    /\bjá\s+vou\s+(verificar|buscar|checar|listar|cancelar|enviar)\b/i.test(lower)
  );
}

/**
 * Extrai um horário de relógio ("HH:MM") solicitado pelo cliente em linguagem
 * natural. Retorna null quando nenhum horário explícito é mencionado.
 *
 * Por que isso existe (Bug #B1 — horário específico, 2026-06-20):
 * - Cliente pergunta "Tem horário para as 11h?". A tool verificar_disponibilidade
 *   só devolve a FAIXA ("das 12:00 às 18:00", Bug #39), não a lista de slots —
 *   então o LLM não conseguia responder deterministicamente se 11:00 está livre,
 *   e soltava "não consegui verificar".
 * - Esta função extrai o horário da mensagem do cliente de forma DETERMINÍSTICA.
 *   O orquestrador injeta esse `hora` no tool call (mesmo padrão do `periodo` —
 *   Bug #37), garantindo que a checagem de horário específico não dependa do LLM.
 *
 * Conservadora de propósito: só reconhece quando há marcador explícito de hora
 * (dois-pontos "11:00", ou sufixo "h"/"hs"/"horas" como "11h"/"11h30"). Números
 * crus sem marcador ("dia 22", "22 é que dia?") NÃO são tratados como horário,
 * evitando falso-positivo com datas.
 *
 * @param message - Mensagem do cliente (texto livre)
 * @returns Horário normalizado "HH:MM", ou null se nenhum horário explícito
 *
 * @example
 * extractTimeFromMessage("Tem horário para as 11h?") // → "11:00"
 * extractTimeFromMessage("pode ser 14:30?")          // → "14:30"
 * extractTimeFromMessage("11h30 está bom")           // → "11:30"
 * extractTimeFromMessage("22 é que dia?")            // → null (data, não hora)
 */
export function extractTimeFromMessage(message?: string | null): string | null {
  if (!message) return null;
  const text = message.toLowerCase();

  // Padrão 1: "HH:MM" (dois-pontos é marcador inequívoco de horário)
  // Padrão 2: "HHh", "HHhs", "HHhrs", "HHhoras", "HHh30" (sufixo h + minutos opcionais)
  // Ambos exigem marcador explícito — números crus não casam.
  const regex = /\b(\d{1,2})\s*(?::|h(?:oras|rs|s)?)\s*(\d{2})?\b/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = regex.exec(text)) !== null) {
    const hour = Number(m[1]);
    const minute = m[2] !== undefined ? Number(m[2]) : 0;
    if (hour > 23 || minute > 59) continue; // descarta valores impossíveis (ex: "25h", "99:99")
    const hh = hour.toString().padStart(2, "0");
    const mm = minute.toString().padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return null;
}

/**
 * Extrai a data ISO ("YYYY-MM-DD") mais recentemente discutida a partir do
 * histórico — analisando os tool results de verificar_disponibilidade /
 * buscar_proximo_horario (ambos devolvem o campo `data`).
 *
 * Por que isso existe (Bug #B2 — âncora de data, 2026-06-20):
 * - O agente já tem âncora determinística do último SERVIÇO discutido
 *   (extractLastDiscussedService, Bug #33/#40), mas NÃO tinha da última DATA.
 * - Quando o cliente refina por horário sem repetir o dia ("tem às 11h?",
 *   "mais cedo?"), o LLM não sabia qual data usar e chamava a tool com data
 *   faltando/errada → falha. Esta função fornece a data em pauta para injeção
 *   determinística no system prompt (buildLastDateBlock), análogo ao serviço.
 *
 * @param history - Histórico de mensagens do ticket
 * @returns ISO "YYYY-MM-DD" mais recente, ou null se nenhuma data foi discutida
 */
export function extractLastDiscussedDate(history: AIMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "tool") continue;
    try {
      const parsed = typeof msg.content === "string" ? JSON.parse(msg.content) : null;
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data)) {
        return parsed.data;
      }
    } catch {
      // Conteúdo não-JSON — skip sem propagar
    }
  }
  return null;
}

/**
 * Extrai uma DATA (ISO "YYYY-MM-DD" em BRT) que o cliente mencionou na mensagem,
 * em linguagem natural. Retorna null quando nenhuma data explícita é reconhecida.
 *
 * CAUSA-RAIZ do "não consegui verificar" (2026-06-21):
 * - `verificar_disponibilidade` EXIGE `data`, mas modelos baratos a omitem
 *   ("tem às 11h?", com a data no contexto) ou a malformam ("sexta" em vez de
 *   "2026-06-26"). Sem data válida a tool quebrava → o bot dizia "não consegui
 *   verificar". (`buscar_proximo_horario` não sofria disso por NÃO usar `data`.)
 * - Esta função extrai a data da mensagem DETERMINISTICAMENTE para o orquestrador
 *   injetar no tool call — mesmo princípio do `periodo` (Bug #37) e `hora` (Bug #B1).
 *
 * Reconhece: "hoje", "amanhã", "depois de amanhã", dias da semana ("sexta",
 * "segunda-feira"), e datas numéricas "DD/MM" ou "DD/MM/AAAA" e "dia DD".
 * Datas relativas/dia-da-semana usam `buildWeekCalendar` (mesma fonte do prompt,
 * TZ-segura). Conservadora: retorna null se nada for reconhecido.
 *
 * @param message - Mensagem do cliente (texto livre)
 * @param now - Referência temporal (default new Date()) — em BRT
 * @returns ISO "YYYY-MM-DD" ou null
 *
 * @example
 * extractDateFromMessage("Tem data na sexta-feira?", seg25mai) // → próxima sexta ISO
 * extractDateFromMessage("pode ser dia 26/06?")               // → "2026-06-26"
 * extractDateFromMessage("Tem horário para as 11h?")          // → null (sem data)
 */
export function extractDateFromMessage(message?: string | null, now: Date = new Date()): string | null {
  if (!message) return null;
  const s = message.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const week = buildWeekCalendar(now); // [0]=hoje, [1]=amanhã, [2]=depois de amanhã, ...

  // 1. Relativos — checar "depois de amanha" ANTES de "amanha" (substring).
  if (/\bdepois de amanha\b/.test(s)) return week[2]?.iso ?? null;
  if (/\bamanha\b/.test(s)) return week[1]?.iso ?? null;
  if (/\bhoje\b/.test(s)) return week[0]?.iso ?? null;

  // 2. Dia da semana → próxima ocorrência (incluindo hoje) via week calendar.
  const WEEKDAY_TO_DOW: Record<string, number> = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6
  };
  for (const [token, dow] of Object.entries(WEEKDAY_TO_DOW)) {
    if (s.includes(token)) {
      const hit = week.find(e => {
        const [y, m, d] = e.iso.split("-").map(Number);
        return new Date(y, m - 1, d).getDay() === dow;
      });
      if (hit) return hit.iso;
    }
  }

  // 3. Data numérica "DD/MM" ou "DD/MM/AAAA".
  const todayIso = week[0].iso;
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : ty;
    if (year < 100) year += 2000; // "26" → 2026
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Sem ano explícito: se a data já passou neste ano, assume o próximo ano.
      if (!slash[3]) {
        const candidato = new Date(year, month - 1, day);
        const hoje = new Date(ty, tm - 1, td);
        if (candidato.getTime() < hoje.getTime()) year += 1;
      }
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  // 4. "dia DD" (mesmo mês; se já passou, próximo mês).
  const diaMatch = /\bdia\s+(\d{1,2})\b/.exec(s);
  if (diaMatch) {
    const day = Number(diaMatch[1]);
    if (day >= 1 && day <= 31) {
      let year = ty;
      let month = tm;
      if (day < td) { // já passou neste mês → próximo mês
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Extrai o nome do último serviço discutido a partir do histórico de mensagens.
 *
 * Escaneia tool results ao contrário procurando o campo `servico` em resultados
 * de `verificar_disponibilidade` ou `buscar_proximo_horario`. Retorna o serviço
 * mais recente encontrado, ou null se nenhum foi discutido ainda.
 *
 * Por que isso existe (Bug #33, 2026-05-24):
 * - Cliente discutia depilação a laser (último serviço).
 * - Agente respondia corretamente sobre depilação.
 * - Cliente disse "Quero agendar".
 * - LLM voltou ao esmalte nas unhas (serviço anterior, mais citado no histórico).
 * - Causa: sem injeção de contexto determinístico, o LLM escolhe o serviço mais
 *   frequente no histórico, não o mais recente.
 * - Fix: injetar `servico` mais recente como bloco no system prompt antes da chamada
 *   ao LLM, tornando a seleção determinística independente do tamanho do histórico.
 *
 * @param history - Array de mensagens do histórico do ticket (AIMessage[])
 * @returns Nome do serviço mais recentemente referenciado, ou null se nenhum
 *
 * @example
 * const svc = extractLastDiscussedService([
 *   { role: "tool", content: JSON.stringify({ servico: "Esmalte", ... }) },
 *   { role: "tool", content: JSON.stringify({ servico: "Depilação a laser", ... }) }
 * ]);
 * // → "Depilação a laser"
 */
export function extractLastDiscussedService(history: AIMessage[]): string | null {
  // Percorre ao contrário para encontrar o tool result MAIS RECENTE com campo `servico`
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "tool") continue;

    try {
      const parsed = typeof msg.content === "string" ? JSON.parse(msg.content) : null;
      if (!parsed || typeof parsed !== "object") continue;

      // `verificar_disponibilidade` retorna { servico: "nome", disponivel, ... }
      // `buscar_proximo_horario` retorna { servico: "nome", encontrado, ... }
      if (typeof parsed.servico === "string" && parsed.servico.length > 0) {
        return parsed.servico;
      }
    } catch {
      // Conteúdo não-JSON (ex: erros em string plana) — skip sem propagar
    }
  }

  return null;
}
