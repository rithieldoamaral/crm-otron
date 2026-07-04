/**
 * Testes TDD para registrarAniversario.
 *
 * A tool grava `Contact.birthday` (DATEONLY) do contato do ATENDIMENTO ATUAL,
 * capturando a data de nascimento durante a conversa (ao final de um atendimento
 * bem-sucedido). Alimenta o BirthdayIntelligentService (campanhas de aniversário),
 * que hoje sofre de escassez de matéria-prima porque `birthday` só era preenchido
 * manualmente via CRM.
 *
 * Duas responsabilidades testadas isoladamente:
 *   1. `parseBirthdayBR`  — função PURA: valida/normaliza formatos BR (DD/MM, DD/MM/AAAA)
 *                            e ISO para `YYYY-MM-DD`. Sem I/O.
 *   2. `registrarAniversario` — orquestra: valida contato (multi-tenant), idempotência
 *                            (não sobrescreve birthday existente) e grava.
 *
 * Princípio (decisions_log 2026-05-10 / Bug #25): `contactId` do "contato atual"
 * vem do CONTEXTO DE EXECUÇÃO, nunca dos argumentos do LLM.
 */

jest.mock("../../../../models/Contact");
jest.mock("../../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import {
  parseBirthdayBR,
  registrarAniversario,
  SENTINEL_YEAR
} from "../../tools/registrarAniversario";
import Contact from "../../../../models/Contact";

const mockFindOne = Contact.findOne as jest.Mock;

describe("parseBirthdayBR (função pura)", () => {
  // Data de referência fixa para tornar a checagem de "data no futuro" determinística.
  const NOW = new Date(Date.UTC(2026, 6, 2)); // 2026-07-02

  it("normaliza DD/MM/AAAA para YYYY-MM-DD", () => {
    const r = parseBirthdayBR("15/03/1990", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.iso).toBe("1990-03-15");
      expect(r.anoInformado).toBe(true);
    }
  });

  it("aceita DD/MM sem ano usando o ano sentinela (só MM-DD importa para a campanha)", () => {
    const r = parseBirthdayBR("15/03", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.iso).toBe(`${SENTINEL_YEAR}-03-15`);
      expect(r.anoInformado).toBe(false);
    }
  });

  it("aceita dígitos únicos e faz zero-padding (5/7 → 07-05)", () => {
    const r = parseBirthdayBR("5/7", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.iso).toBe(`${SENTINEL_YEAR}-07-05`);
  });

  it("aceita formato ISO YYYY-MM-DD diretamente", () => {
    const r = parseBirthdayBR("1988-12-25", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.iso).toBe("1988-12-25");
      expect(r.anoInformado).toBe(true);
    }
  });

  it("aceita separadores '.' e '-' no formato BR", () => {
    expect(parseBirthdayBR("15.03.1990", NOW)).toMatchObject({ ok: true, iso: "1990-03-15" });
    expect(parseBirthdayBR("15-03-1990", NOW)).toMatchObject({ ok: true, iso: "1990-03-15" });
  });

  it("aceita 29/02 sem ano (ano sentinela é bissexto)", () => {
    const r = parseBirthdayBR("29/02", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.iso).toBe(`${SENTINEL_YEAR}-02-29`);
  });

  it("aceita 29/02 em ano bissexto explícito", () => {
    expect(parseBirthdayBR("29/02/2000", NOW)).toMatchObject({ ok: true, iso: "2000-02-29" });
  });

  it("rejeita 29/02 em ano NÃO bissexto", () => {
    const r = parseBirthdayBR("29/02/2001", NOW);
    expect(r.ok).toBe(false);
  });

  it("rejeita dia inválido para o mês (31/04)", () => {
    expect(parseBirthdayBR("31/04/1990", NOW).ok).toBe(false);
  });

  it("rejeita dia zero e mês fora de 1-12", () => {
    expect(parseBirthdayBR("00/01", NOW).ok).toBe(false);
    expect(parseBirthdayBR("10/13", NOW).ok).toBe(false);
  });

  it("rejeita ano de 2 dígitos (exige AAAA)", () => {
    expect(parseBirthdayBR("15/03/90", NOW).ok).toBe(false);
  });

  it("rejeita ano anterior a 1900", () => {
    expect(parseBirthdayBR("15/03/1899", NOW).ok).toBe(false);
  });

  it("rejeita data no futuro (ano futuro)", () => {
    expect(parseBirthdayBR("15/03/2030", NOW).ok).toBe(false);
  });

  it("rejeita data no futuro dentro do ano corrente", () => {
    // now = 2026-07-02; 30/12/2026 ainda não aconteceu → nascimento impossível
    expect(parseBirthdayBR("30/12/2026", NOW).ok).toBe(false);
  });

  it("rejeita string vazia, espaços e lixo", () => {
    expect(parseBirthdayBR("", NOW).ok).toBe(false);
    expect(parseBirthdayBR("   ", NOW).ok).toBe(false);
    expect(parseBirthdayBR("não sei", NOW).ok).toBe(false);
  });
});

describe("registrarAniversario (orquestração)", () => {
  const companyId = 2;
  const contactId = 42;

  beforeEach(() => jest.clearAllMocks());

  it("grava o birthday quando o contato ainda não tem (DD/MM/AAAA)", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindOne.mockResolvedValue({ id: contactId, name: "Maria", birthday: null, update });

    const result = await registrarAniversario({ data_nascimento: "15/03/1990" }, companyId, contactId);

    expect(update).toHaveBeenCalledWith({ birthday: "1990-03-15" });
    expect(result.sucesso).toBe(true);
    expect(result.dataRegistrada).toBe("1990-03-15");
    expect(result.jaRegistrado).toBeFalsy();
  });

  it("grava usando ano sentinela quando só DD/MM é informado", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindOne.mockResolvedValue({ id: contactId, name: "Maria", birthday: null, update });

    const result = await registrarAniversario({ data_nascimento: "05/09" }, companyId, contactId);

    expect(update).toHaveBeenCalledWith({ birthday: `${SENTINEL_YEAR}-09-05` });
    expect(result.sucesso).toBe(true);
  });

  it("é IDEMPOTENTE: não sobrescreve birthday já existente", async () => {
    const update = jest.fn();
    mockFindOne.mockResolvedValue({ id: contactId, name: "Maria", birthday: "1980-01-01", update });

    const result = await registrarAniversario({ data_nascimento: "15/03/1990" }, companyId, contactId);

    expect(update).not.toHaveBeenCalled();
    expect(result.sucesso).toBe(true);
    expect(result.jaRegistrado).toBe(true);
  });

  it("não toca no banco quando a data é inválida", async () => {
    const result = await registrarAniversario({ data_nascimento: "bla bla" }, companyId, contactId);

    expect(mockFindOne).not.toHaveBeenCalled();
    expect(result.sucesso).toBe(false);
    expect(result.erro).toBeTruthy();
  });

  it("falha graciosamente quando o contato não existe (multi-tenant)", async () => {
    mockFindOne.mockResolvedValue(null);

    const result = await registrarAniversario({ data_nascimento: "15/03/1990" }, companyId, contactId);

    expect(result.sucesso).toBe(false);
  });

  it("isola por empresa: findOne filtra por id E companyId", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockFindOne.mockResolvedValue({ id: contactId, name: "Maria", birthday: null, update });

    await registrarAniversario({ data_nascimento: "15/03/1990" }, companyId, contactId);

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: contactId, companyId } })
    );
  });

  it("falha quando não há contato no contexto (contactId ausente) sem tocar no banco", async () => {
    const result = await registrarAniversario({ data_nascimento: "15/03/1990" }, companyId, undefined);

    expect(mockFindOne).not.toHaveBeenCalled();
    expect(result.sucesso).toBe(false);
  });
});
