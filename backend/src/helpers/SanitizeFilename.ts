/**
 * SanitizeFilename — neutraliza path traversal em nomes de arquivo vindos de fora.
 *
 * Vetor real (security review 2026-06-28): `verifyMediaMessage` grava a mídia
 * recebida com `join(pastaDaEmpresa, media.filename)`, e `media.filename` vem do
 * REMETENTE (nome original do documento no WhatsApp). Um atacante enviando um
 * documento chamado `..\\..\\dist\\server.js` escreveria FORA de
 * `public/company{id}/` — sobrescrevendo arquivos do servidor (potencial RCE).
 *
 * Estratégia: reduzir ao basename (elimina qualquer componente de diretório em
 * POSIX e Windows), remover caracteres de controle/reservados, trocar espaços por
 * `_` e nunca retornar vazio (fallback com timestamp). Acentos e pontuação comum
 * de nomes BR são preservados.
 */

/**
 * Sanitiza um nome de arquivo controlado externamente para gravação segura.
 *
 * @param raw - Nome como veio do remetente (pode ser null/undefined)
 * @returns Nome seguro, sem componentes de diretório, nunca vazio
 *
 * @example
 *   sanitizeFilename("..\\..\\dist\\server.js") // "server.js"
 *   sanitizeFilename("../../../etc/passwd")     // "passwd"
 *   sanitizeFilename("Orçamento março.pdf")     // "Orçamento_março.pdf"
 */
export function sanitizeFilename(raw: string | null | undefined): string {
  const fallback = (): string => `file_${Date.now()}`;

  if (!raw || typeof raw !== "string") return fallback();

  // Basename manual cobrindo AMBOS os separadores (path.basename só trata o
  // separador da plataforma — em Linux, "..\\x" passaria intacto).
  const lastSlash = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
  let name = lastSlash >= 0 ? raw.slice(lastSlash + 1) : raw;

  // Caracteres de controle (code point < 32) removidos por code point — evita
  // literais de controle invisíveis em regex, que já causaram bug aqui.
  name = Array.from(name)
    .filter(ch => ch.charCodeAt(0) >= 32)
    .join("")
    // Reservados do Windows: < > : " | ? *
    .replace(/[<>:"|?*]/g, "")
    // Espaços viram _ (evita problemas de URL/shell downstream)
    .replace(/\s+/g, "_")
    // Remove pontos no início (".." residual não pode sobrar)
    .replace(/^\.+/, "");

  if (!name) return fallback();
  return name;
}
