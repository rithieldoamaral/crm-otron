/**
 * Testes da escolha de template.
 *
 * Por que importa: escolher errado é falha SILENCIOSA. Um template com status
 * PENDING ou com número de parâmetros incompatível é recusado pela Meta no
 * momento do envio — e sem tratamento o sistema marca a mensagem como enviada
 * enquanto o cliente nunca recebe nada.
 *
 * Preferir devolver `null` (que faz o envio falhar alto) a devolver um
 * template que vai ser recusado é a decisão central desta função.
 */

import { escolherTemplate } from "../templates/pickTemplate";

const t = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    name: "lembrete",
    language: "pt_BR",
    status: "APPROVED",
    variableCount: 1,
    ...over
  } as any);

describe("escolherTemplate", () => {
  it("escolhe template aprovado com a quantidade certa de parâmetros", () => {
    expect(escolherTemplate([t()], ["João"])?.name).toBe("lembrete");
  });

  it("NÃO escolhe template pendente de aprovação", () => {
    // A Meta recusaria no envio; devolver null faz falhar alto agora.
    expect(escolherTemplate([t({ status: "PENDING" })], ["João"])).toBeNull();
  });

  it("NÃO escolhe template rejeitado", () => {
    expect(escolherTemplate([t({ status: "REJECTED" })], ["João"])).toBeNull();
  });

  it("NÃO escolhe template que espera MAIS parâmetros do que temos", () => {
    expect(escolherTemplate([t({ variableCount: 3 })], ["João"])).toBeNull();
  });

  it("NÃO escolhe template que espera MENOS parâmetros do que temos", () => {
    // Parâmetro sobrando também é recusado pela Meta.
    expect(escolherTemplate([t({ variableCount: 0 })], ["João"])).toBeNull();
  });

  it("aceita template sem parâmetros quando não há nada a preencher", () => {
    expect(escolherTemplate([t({ variableCount: 0 })], [])?.name).toBe(
      "lembrete"
    );
  });

  it("prefere o idioma pedido quando há mais de um", () => {
    const candidatos = [
      t({ name: "ingles", language: "en_US" }),
      t({ name: "portugues", language: "pt_BR" })
    ];

    expect(escolherTemplate(candidatos, ["João"], "pt_BR")?.name).toBe(
      "portugues"
    );
  });

  it("aceita outro idioma quando o preferido não existe", () => {
    // Mandar no idioma "errado" é melhor que não mandar.
    const candidatos = [t({ name: "ingles", language: "en_US" })];

    expect(escolherTemplate(candidatos, ["João"], "pt_BR")?.name).toBe(
      "ingles"
    );
  });

  it("devolve null para lista vazia ou ausente", () => {
    expect(escolherTemplate([], ["João"])).toBeNull();
    expect(escolherTemplate(null as any, ["João"])).toBeNull();
  });
});
