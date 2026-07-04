/**
 * pseudoXmlParser — extrai tool calls de respostas onde o LLM emite pseudo-XML
 * em vez de tool_calls estruturados. Necessário porque modelos open-source
 * (notavelmente llama-3.3-70b-versatile via Groq) ocasionalmente alucinam o
 * formato `<function=NAME={...args}</function>` que aprenderam em pré-treino,
 * mesmo recebendo tools no protocolo OpenAI/Anthropic.
 *
 * Estratégia: usar como fallback no loop do AgentService quando
 * response.toolCalls vier vazio mas o conteúdo contiver as marcações.
 */

import { AIToolCall } from "./providers/interfaces";

export interface ParsedPseudoXml {
  toolCalls: AIToolCall[];
  cleanedText: string;
}

// Aceita ambos formatos observados em produção:
//   <function=NAME></function>          → tag de abertura fechada com `>`
//   <function=NAME={...args}</function> → JSON cola direto na tag de fechamento, sem `>`
const PSEUDO_XML_REGEX = /<function=([a-zA-Z_][a-zA-Z0-9_]*)(?:=([\s\S]*?))?>?\s*<\/function>/g;

let counter = 0;
function generateId(): string {
  counter += 1;
  return `pseudo-${Date.now()}-${counter}`;
}

function safeParseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function parsePseudoXmlToolCalls(
  text: string | null | undefined
): ParsedPseudoXml {
  if (!text) {
    return { toolCalls: [], cleanedText: text ?? "" };
  }

  const toolCalls: AIToolCall[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PSEUDO_XML_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    const [, name, rawArgs] = match;
    toolCalls.push({
      id: generateId(),
      name: name.trim(),
      arguments: safeParseJson(rawArgs?.trim())
    });
  }

  const cleanedText = text.replace(regex, "");

  return { toolCalls, cleanedText };
}
