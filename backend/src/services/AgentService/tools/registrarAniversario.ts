/**
 * Tool: registrar_aniversario
 *
 * Grava `Contact.birthday` (DATEONLY) do contato do ATENDIMENTO ATUAL, capturando
 * a data de nascimento durante a conversa — tipicamente ao final de um atendimento
 * bem-sucedido, quando a fricção é mínima.
 *
 * Por que existe: as campanhas de aniversário (BirthdayIntelligentService) já rodam,
 * mas tinham pouca matéria-prima porque `birthday` só era preenchido manualmente via
 * CRM (Create/UpdateContactService). Esta tool passa a alimentá-las a partir da conversa.
 *
 * Princípio (decisions_log 2026-05-10 / Bug #25): o `contactId` do "contato atual" vem
 * SEMPRE do contexto de execução do AgentService, nunca dos argumentos do LLM — o modelo
 * não conhece IDs internos e os alucina. O único argumento do LLM é a data em texto.
 */

import Contact from "../../../models/Contact";
import { logger } from "../../../utils/logger";

/**
 * Ano-sentinela usado quando o cliente informa apenas DD/MM (sem ano).
 *
 * É um ano bissexto (1904) para que 29/02 seja uma data válida mesmo sem ano
 * informado. Só o par mês-dia importa para a campanha de aniversário
 * (`BirthdayService.utils.extractMonthDay`), então o ano é um placeholder — 1904
 * é claramente um marcador de "ano desconhecido", não uma data de nascimento real.
 */
export const SENTINEL_YEAR = 1904;

/** Menor ano de nascimento aceito (sanidade — evita typos absurdos). */
const MIN_BIRTH_YEAR = 1900;

interface RegistrarAniversarioArgs {
  /** Data em texto, no formato que o cliente disse: "15/03", "15/03/1990" ou ISO. */
  data_nascimento: string;
}

interface RegistrarAniversarioResult {
  sucesso: boolean;
  mensagem: string;
  /** true quando o contato JÁ tinha aniversário — nada foi sobrescrito (idempotência). */
  jaRegistrado?: boolean;
  /** Data efetivamente gravada, em YYYY-MM-DD. */
  dataRegistrada?: string;
  erro?: string;
}

/** Resultado do parser puro — união discriminada por `ok`. */
export type ParseBirthdayResult =
  | { ok: true; iso: string; anoInformado: boolean }
  | { ok: false; erro: string };

/** Quantos dias tem o mês (1-indexado) no ano informado — trata bissexto. */
function daysInMonth(year: number, month: number): number {
  // Date.UTC(year, month, 0) → último dia do mês anterior a `month+1` = último dia de `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Valida e normaliza uma data de nascimento em texto para `YYYY-MM-DD` (DATEONLY).
 *
 * Formatos aceitos:
 *   - BR com ano:  "DD/MM/AAAA"  (separadores `/`, `.` ou `-`)
 *   - BR sem ano:  "DD/MM"        → usa `SENTINEL_YEAR` (só MM-DD importa)
 *   - ISO:         "AAAA-MM-DD"   (caso o LLM já normalize)
 *
 * Regras de validação:
 *   - mês em 1..12; dia válido para o mês (respeitando bissexto);
 *   - ano informado entre {@link MIN_BIRTH_YEAR} e o ano corrente;
 *   - a data não pode ser no futuro.
 *
 * Função PURA — sem I/O, testável isoladamente.
 *
 * @param raw Texto da data como veio do cliente/LLM
 * @param now Referência para a checagem de "futuro" (default: agora)
 * @returns `{ ok: true, iso, anoInformado }` ou `{ ok: false, erro }`
 *
 * @example
 *   parseBirthdayBR("15/03/1990") // → { ok: true, iso: "1990-03-15", anoInformado: true }
 *   parseBirthdayBR("15/03")      // → { ok: true, iso: "1904-03-15", anoInformado: false }
 *   parseBirthdayBR("31/04/1990") // → { ok: false, erro: "..." }
 */
export function parseBirthdayBR(
  raw: string,
  now: Date = new Date()
): ParseBirthdayResult {
  const invalido = (erro: string): ParseBirthdayResult => ({ ok: false, erro });

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return invalido("Data de nascimento vazia.");
  }
  const texto = raw.trim();

  let day: number;
  let month: number;
  let year: number;
  let anoInformado: boolean;

  // ISO primeiro (ano com 4 dígitos elimina ambiguidade com o `-` do formato BR).
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = texto.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{4}))?$/);

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    anoInformado = true;
  } else if (br) {
    day = Number(br[1]);
    month = Number(br[2]);
    anoInformado = br[3] !== undefined;
    year = anoInformado ? Number(br[3]) : SENTINEL_YEAR;
  } else {
    return invalido(
      "Formato não reconhecido. Peça a data no formato dia/mês/ano (ex: 15/03/1990) ou dia/mês (ex: 15/03)."
    );
  }

  if (month < 1 || month > 12) return invalido("Mês inválido.");
  if (day < 1 || day > daysInMonth(year, month)) return invalido("Dia inválido para o mês informado.");

  if (anoInformado) {
    const currentYear = now.getUTCFullYear();
    if (year < MIN_BIRTH_YEAR || year > currentYear) return invalido("Ano de nascimento inválido.");
    // Data completa não pode estar no futuro.
    const birthUTC = Date.UTC(year, month - 1, day);
    const nowMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (birthUTC > nowMidnight) return invalido("Data de nascimento no futuro.");
  }

  const isoOut = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ok: true, iso: isoOut, anoInformado };
}

/**
 * Grava a data de nascimento no contato do atendimento atual.
 *
 * Idempotente: se o contato já tem `birthday`, NÃO sobrescreve (a edição manual via
 * CRM continua sendo a autoridade para correções) — retorna sucesso sinalizando
 * `jaRegistrado`. Isolamento multi-tenant via `companyId`.
 *
 * @param args - { data_nascimento } — texto da data como o cliente informou
 * @param companyId - ID da empresa (isolamento multi-tenant)
 * @param contactId - ID do contato do ticket atual (vem do contexto, não do LLM)
 * @returns Confirmação da gravação, no-op idempotente ou descrição do erro
 */
export async function registrarAniversario(
  args: RegistrarAniversarioArgs,
  companyId: number,
  contactId?: number
): Promise<RegistrarAniversarioResult> {
  try {
    if (!contactId) {
      return {
        sucesso: false,
        mensagem: "Não há um contato associado a este atendimento.",
        erro: "contactId ausente no contexto de execução."
      };
    }

    const parsed = parseBirthdayBR(args?.data_nascimento ?? "");
    if (!parsed.ok) {
      // tsconfig tem strict:false → o narrowing NEGATIVO de union discriminada não
      // estreita `parsed` para {ok:false} dentro deste bloco. Acessamos `erro` via
      // cast explícito (garantido pelo `!parsed.ok`).
      return {
        sucesso: false,
        mensagem:
          "Não entendi a data. Peça a data de nascimento no formato dia/mês (ex: 15/03) ou dia/mês/ano.",
        erro: (parsed as { ok: false; erro: string }).erro
      };
    }

    const contato = await Contact.findOne({ where: { id: contactId, companyId } });
    if (!contato) {
      return {
        sucesso: false,
        mensagem: "Contato não encontrado.",
        erro: `Contato ID ${contactId} não encontrado na empresa ${companyId}.`
      };
    }

    // Idempotência: não sobrescreve um aniversário já registrado.
    if (contato.birthday) {
      return {
        sucesso: true,
        jaRegistrado: true,
        mensagem: "O aniversário deste cliente já estava registrado. Nada foi alterado."
      };
    }

    // DATEONLY aceita a string YYYY-MM-DD direto — sem Date/UTC, sem risco de fuso.
    await contato.update({ birthday: parsed.iso });

    logger.info(
      `[registrarAniversario] birthday gravado contactId=${contactId} companyId=${companyId} data=${parsed.iso}`
    );

    return {
      sucesso: true,
      dataRegistrada: parsed.iso,
      mensagem: "✅ Data de aniversário registrada com sucesso."
    };
  } catch (error) {
    // catch nunca silencioso (CLAUDE.md §II.5): loga com contexto para diagnóstico.
    logger.error(
      `[registrarAniversario] falha contactId=${contactId} companyId=${companyId}: ${(error as Error).message}`
    );
    return {
      sucesso: false,
      mensagem: "Erro ao registrar a data de aniversário.",
      erro: (error as Error).message
    };
  }
}

/** Definição JSON Schema da tool para o provider de IA */
export const registrarAniversarioDefinition = {
  name: "registrar_aniversario",
  description:
    "Registra a data de aniversário do cliente do atendimento ATUAL. Use SOMENTE ao final " +
    "de um atendimento concluído com sucesso, depois que o cliente informar a data de " +
    "nascimento. Grava no contato do ticket atual — NÃO peça nem passe ID do contato. " +
    "Passe a data exatamente como o cliente disse (dia/mês ou dia/mês/ano).",
  parameters: {
    type: "object",
    properties: {
      data_nascimento: {
        type: "string",
        description:
          "Data de nascimento informada pelo cliente, em formato dia/mês (ex: '15/03') " +
          "ou dia/mês/ano (ex: '15/03/1990'). Não invente — só chame se o cliente informou."
      }
    },
    required: ["data_nascimento"]
  }
};
