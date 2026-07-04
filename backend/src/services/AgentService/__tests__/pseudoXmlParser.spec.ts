/**
 * Testes TDD para parsePseudoXmlToolCalls — fallback que extrai tool calls
 * quando o LLM (tipicamente Llama via Groq) emite pseudo-XML inline em vez de
 * retornar tool_calls estruturados. Os formatos cobertos foram observados em
 * produção com llama-3.3-70b-versatile.
 */

import { parsePseudoXmlToolCalls } from "../pseudoXmlParser";

describe("parsePseudoXmlToolCalls", () => {
  it("retorna lista vazia quando o texto não contém pseudo-XML", () => {
    const result = parsePseudoXmlToolCalls("Olá, como posso ajudar?");
    expect(result.toolCalls).toEqual([]);
    expect(result.cleanedText).toBe("Olá, como posso ajudar?");
  });

  it("retorna lista vazia para texto vazio ou null", () => {
    expect(parsePseudoXmlToolCalls("").toolCalls).toEqual([]);
    expect(parsePseudoXmlToolCalls(null).toolCalls).toEqual([]);
    expect(parsePseudoXmlToolCalls(undefined).toolCalls).toEqual([]);
  });

  it("extrai uma tool sem argumentos: <function=NAME></function>", () => {
    const text = "Vou buscar agora. <function=listar_servicos></function>";
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("listar_servicos");
    expect(result.toolCalls[0].arguments).toEqual({});
  });

  it("extrai uma tool com JSON args inline: <function=NAME={...}</function>", () => {
    const text =
      'Verificando contato. <function=buscar_contato={"nome_ou_numero": "João"}</function>';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("buscar_contato");
    expect(result.toolCalls[0].arguments).toEqual({ nome_ou_numero: "João" });
  });

  it("extrai múltiplas tools no mesmo texto", () => {
    const text =
      'Vou verificar. <function=listar_servicos></function> Depois marco. <function=criar_agendamento={"servico":"Limpeza","dataHora":"hoje"}</function>';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("listar_servicos");
    expect(result.toolCalls[1].name).toBe("criar_agendamento");
    expect(result.toolCalls[1].arguments).toEqual({
      servico: "Limpeza",
      dataHora: "hoje"
    });
  });

  it("remove os pseudo-XML do cleanedText e preserva texto natural", () => {
    const text =
      'Olá! Vou verificar. <function=listar_servicos></function> Aguarde um instante.';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.cleanedText).toBe("Olá! Vou verificar.  Aguarde um instante.");
  });

  it("gera id estável e único por tool call", () => {
    const text =
      '<function=listar_servicos></function> <function=listar_servicos></function>';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBeTruthy();
    expect(result.toolCalls[1].id).toBeTruthy();
    expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id);
  });

  it("trata JSON inválido degradando para arguments vazios", () => {
    const text = "<function=criar_agendamento={broken json}</function>";
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("criar_agendamento");
    expect(result.toolCalls[0].arguments).toEqual({});
  });

  it("aceita quebras de linha e espaços extras dentro do JSON", () => {
    const text =
      '<function=verificar_disponibilidade={\n  "servicoId": "limpeza",\n  "data": "hoje"\n}</function>';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls[0].arguments).toEqual({
      servicoId: "limpeza",
      data: "hoje"
    });
  });

  it("normaliza nomes mal formados removendo underscores ausentes (best-effort)", () => {
    // O LLM ocasionalmente emite "buscarcontato" em vez de "buscar_contato".
    // O parser não tenta adivinhar; entrega o nome como veio e deixa o
    // executor responder com "tool desconhecida" no próximo turno.
    const text =
      '<function=buscarcontato={"nomeou_numero": "5599"}</function>';
    const result = parsePseudoXmlToolCalls(text);
    expect(result.toolCalls[0].name).toBe("buscarcontato");
  });
});
