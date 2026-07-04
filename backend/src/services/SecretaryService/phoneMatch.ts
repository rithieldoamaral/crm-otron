/**
 * phoneMatch — comparação robusta de telefones para reconhecimento do admin
 * da Secretária, tolerando as variações de formato do WhatsApp brasileiro.
 *
 * Causa-raiz (ticket #22, 2026-06-28): o WhatsApp entrega o JID de um celular
 * brasileiro frequentemente SEM o "9º dígito" (`554888368758`), enquanto o admin
 * cadastra o número COM o 9 (`5548988368758`). A comparação dígito-exata anterior
 * falhava e o admin caía no fluxo do Agente. Ver `directives/secretary_admin_phone_match.md`.
 */

/**
 * Reduz qualquer representação de telefone a uma chave canônica comparável.
 *
 * Regras (na ordem):
 * 1. Remove sufixo de JID (`@s.whatsapp.net`) e todo caractere não-numérico
 *    (máscara, `+`, espaços, `-`, `(`, `)`).
 * 2. Sem código de país (10 ou 11 dígitos) → assume Brasil e prepend `55`.
 *    - 10 díg = DDD(2) + número fixo(8)
 *    - 11 díg = DDD(2) + 9 + celular(8)
 * 3. Celular brasileiro de 13 dígitos (`55` + DDD + `9` + 8 dígitos) → remove o
 *    9º dígito, gerando a forma de 12 dígitos que o WhatsApp costuma trafegar.
 *
 * Mantém comparação DÍGITO-EXATA na chave canônica — não afrouxa a segurança,
 * apenas unifica os formatos equivalentes do MESMO número.
 *
 * @param raw - Número/JID em qualquer formato (pode ser undefined/null).
 * @returns Chave canônica só com dígitos, ou "" se a entrada for vazia.
 *
 * @example
 *   canonicalizePhone("5548988368758")            // "554888368758"
 *   canonicalizePhone("554888368758@s.whatsapp.net") // "554888368758"
 *   canonicalizePhone("48988368758")              // "554888368758"
 */
export function canonicalizePhone(raw: string | undefined | null): string {
  let digits = (raw ?? "").replace(/@.*/, "").replace(/\D/g, "");
  if (!digits) return "";

  // Sem código de país → assume Brasil (DDD + número).
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }

  // Celular BR de 13 díg com o 9º dígito (índice 4 = primeiro dígito após o DDD):
  // remove o `9` para casar com a forma de 12 díg entregue pelo WhatsApp.
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
    digits = digits.slice(0, 4) + digits.slice(5);
  }

  return digits;
}

/**
 * Compara dois telefones tolerando diferenças de formato (9º dígito, código de
 * país, máscara, JID). Retorna false se qualquer lado for vazio.
 *
 * @param a - primeiro número/JID
 * @param b - segundo número/JID
 * @returns true se representam o mesmo número após canonicalização.
 */
export function phonesMatch(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  const ca = canonicalizePhone(a);
  const cb = canonicalizePhone(b);
  return ca !== "" && ca === cb;
}
