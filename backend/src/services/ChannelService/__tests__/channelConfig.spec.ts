/**
 * Testes da leitura/escrita da configuração de canal.
 *
 * Dois riscos distintos são cobertos aqui:
 *
 * 1. VAZAMENTO — os controllers de WhatsApp devolvem o model inteiro ao
 *    frontend (`res.json(whatsapp)`). O `toJSON` do model remove
 *    `channelConfig` justamente para o ciphertext das credenciais não trafegar
 *    para o navegador em toda listagem de conexões (CLAUDE.md XV.6).
 *
 * 2. MÁSCARA — o que a UI recebe precisa ser suficiente para o operador
 *    reconhecer a conexão, e insuficiente para reconstruir a credencial.
 */

import {
  buildChannelConfig,
  getChannelConfig,
  maskChannelConfig
} from "../channelConfig";

process.env.CHANNEL_CONFIG_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** Conexão simulada com o mínimo que as funções consomem. */
const conexao = (config?: Record<string, string>) =>
  ({
    id: 7,
    companyId: 1,
    channelType: "cloud_api",
    channelConfig: config ? buildChannelConfig(config) : null
  } as any);

const CREDENCIAIS = {
  phoneNumberId: "109876543210987",
  wabaId: "102938475610293",
  accessToken: "EAAGtokenSuperSecretoDaMeta1234",
  appSecret: "appsecret9876"
};

describe("getChannelConfig", () => {
  it("decifra e devolve a configuração gravada", () => {
    expect(getChannelConfig(conexao(CREDENCIAIS))).toEqual(CREDENCIAIS);
  });

  it("devolve objeto vazio quando não há configuração", () => {
    // Conexão Baileys não tem channelConfig — estado legítimo, não erro.
    expect(getChannelConfig(conexao())).toEqual({});
  });

  it("FALHA ALTO quando o valor gravado é ilegível", () => {
    // Chave de criptografia trocada ou valor adulterado. Devolver {} aqui
    // faria o adaptador reportar "não configurado" — diagnóstico oposto ao
    // problema real, e correção oposta também.
    const corrompida = { ...conexao(), channelConfig: "lixo:invalido:aqui" };

    expect(() => getChannelConfig(corrompida)).toThrow();
  });
});

describe("maskChannelConfig", () => {
  it("mostra identificadores, que não são segredo", () => {
    const mascarado = maskChannelConfig(conexao(CREDENCIAIS));

    // Ajudam o operador a conferir se conectou o número certo.
    expect(mascarado.phoneNumberId).toBe("109876543210987");
    expect(mascarado.wabaId).toBe("102938475610293");
  });

  it("NUNCA devolve o token em texto puro", () => {
    const mascarado = maskChannelConfig(conexao(CREDENCIAIS));

    expect(mascarado.accessToken).not.toBe(CREDENCIAIS.accessToken);
    expect(String(mascarado.accessToken)).toContain("••••");
    expect(mascarado.appSecret).not.toBe(CREDENCIAIS.appSecret);
  });

  it("sinaliza que há credencial sem revelar qual", () => {
    expect(maskChannelConfig(conexao(CREDENCIAIS)).hasCredentials).toBe(true);
    expect(maskChannelConfig(conexao()).hasCredentials).toBe(false);
  });

  it("não derruba a tela quando a credencial está ilegível", () => {
    const corrompida = { ...conexao(), channelConfig: "lixo:invalido:aqui" };

    // A UI precisa renderizar "credencial ilegível" em vez de quebrar.
    expect(() => maskChannelConfig(corrompida)).not.toThrow();
    expect(maskChannelConfig(corrompida).configIlegivel).toBe(true);
  });
});

describe("proteção contra vazamento na serialização", () => {
  it("o valor cifrado NÃO contém o token em texto puro", () => {
    const cifrado = buildChannelConfig(CREDENCIAIS);

    expect(cifrado).not.toContain(CREDENCIAIS.accessToken);
    expect(cifrado).not.toContain(CREDENCIAIS.appSecret);
  });

  it("cifra o mesmo conteúdo de forma diferente a cada gravação", () => {
    // Sem isto, comparar duas linhas do banco revelaria que duas empresas
    // usam a MESMA credencial, sem precisar decifrar nada.
    expect(buildChannelConfig(CREDENCIAIS)).not.toBe(
      buildChannelConfig(CREDENCIAIS)
    );
  });
});
