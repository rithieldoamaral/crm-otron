import crypto from "crypto";

/**
 * Criptografia de campo em repouso para credenciais de terceiros.
 *
 * POR QUE EXISTE (CLAUDE.md XV.6): o `channelConfig` das conexões guarda token
 * permanente da Meta e Auth Token da Twilio. São credenciais de terceiro — quem
 * as obtiver envia mensagem em nome do cliente e queima a cota paga dele. A
 * regra do projeto é explícita: credenciais de terceiro ficam "criptografados
 * em repouso, acesso restrito, jamais em log".
 *
 * ALGORITMO: AES-256-GCM. GCM (e não CBC) porque traz tag de autenticação —
 * ciphertext adulterado FALHA ao decifrar em vez de devolver lixo plausível.
 * Sem isso, quem tivesse escrita no banco poderia alterar bytes e induzir
 * comportamento imprevisível no lugar de um erro claro.
 *
 * IV ALEATÓRIO POR OPERAÇÃO: o mesmo texto nunca gera o mesmo ciphertext. Cifra
 * determinística vazaria informação sem precisar de chave — bastaria comparar
 * duas linhas do banco para saber que duas empresas usam a MESMA credencial.
 *
 * FORMATO ARMAZENADO: `iv:authTag:ciphertext`, tudo em base64. Guardar o IV
 * junto é padrão e não é segredo: ele precisa ser conhecido para decifrar, e
 * seu papel é ser único, não oculto.
 */

const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12; // 96 bits: tamanho recomendado para GCM
const SEPARADOR = ":";

/**
 * Deriva a chave de 32 bytes a partir da variável de ambiente.
 *
 * Lida a cada chamada, e não uma vez no import, porque o processo de teste
 * define a env var depois que os módulos já foram carregados. O custo do
 * hash é irrelevante perto do I/O de banco que sempre acompanha estas chamadas.
 *
 * @throws {Error} Se CHANNEL_CONFIG_SECRET não estiver definida.
 */
const obterChave = (): Buffer => {
  const segredo = process.env.CHANNEL_CONFIG_SECRET;

  if (!segredo) {
    // Falha alta e imediata: seguir sem cifra gravaria credencial em texto
    // puro no banco, que é exatamente o que XV.6 proíbe.
    throw new Error(
      "CHANNEL_CONFIG_SECRET não definida — impossível cifrar credenciais de canal."
    );
  }

  // sha256 normaliza qualquer comprimento de segredo para os 32 bytes que o
  // AES-256 exige, sem obrigar o operador a gerar exatamente 32 caracteres.
  return crypto.createHash("sha256").update(segredo).digest();
};

/**
 * Cifra um valor para gravação no banco.
 *
 * @param valorPuro - Texto a cifrar (tipicamente um JSON de credenciais).
 * @returns String `iv:authTag:ciphertext` em base64, ou "" se a entrada for vazia.
 * @throws {Error} Se CHANNEL_CONFIG_SECRET não estiver definida.
 *
 * @example
 * const cifrado = encryptField(JSON.stringify({ accessToken: "EAAG..." }));
 */
export const encryptField = (valorPuro: string): string => {
  // Vazio devolve vazio: "sem credencial" é estado legítimo (conexão Baileys
  // não tem channelConfig) e não deve virar ciphertext de string vazia.
  if (!valorPuro) return "";

  const iv = crypto.randomBytes(TAMANHO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, obterChave(), iv);

  const cifrado = Buffer.concat([
    cipher.update(valorPuro, "utf8"),
    cipher.final()
  ]);

  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    cifrado.toString("base64")
  ].join(SEPARADOR);
};

/**
 * Decifra um valor lido do banco.
 *
 * @param valorCifrado - String no formato produzido por encryptField.
 * @returns Texto original, ou "" se a entrada for vazia/nula.
 * @throws {Error} Se o formato for inválido ou o conteúdo tiver sido adulterado.
 *
 * @example
 * const config = JSON.parse(decryptField(whatsapp.channelConfig));
 */
export const decryptField = (
  valorCifrado: string | null | undefined
): string => {
  if (!valorCifrado) return "";

  const partes = valorCifrado.split(SEPARADOR);

  if (partes.length !== 3) {
    throw new Error("Valor cifrado em formato inválido.");
  }

  const [ivB64, tagB64, cifradoB64] = partes;

  const decipher = crypto.createDecipheriv(
    ALGORITMO,
    obterChave(),
    Buffer.from(ivB64, "base64")
  );
  // Se o conteúdo tiver sido alterado, final() lança — é essa verificação que
  // torna a adulteração detectável em vez de silenciosa.
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(cifradoB64, "base64")),
    decipher.final()
  ]).toString("utf8");
};

/**
 * Mascara um segredo para exibição.
 *
 * O frontend NUNCA recebe a credencial (XV.6 e IV.3): recebe esta máscara, que
 * serve só para o operador reconhecer qual credencial está configurada sem que
 * o valor trafegue.
 *
 * @param segredo - Valor em texto puro.
 * @returns "••••" seguido dos 4 últimos caracteres, ou "" se ausente.
 *
 * @example
 * maskSecret("EAAG1234567890abcd") // "••••abcd"
 */
export const maskSecret = (segredo: string | null | undefined): string => {
  if (!segredo) return "";

  // Com 4 caracteres ou menos, revelar "os últimos 4" revelaria o segredo
  // inteiro — nesse caso mascara tudo.
  if (segredo.length <= 4) return "••••";

  return `••••${segredo.slice(-4)}`;
};
