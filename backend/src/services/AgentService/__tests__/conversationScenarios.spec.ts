/**
 * Cenários de conversa — testes de integração do loop agêntico completo.
 *
 * Cada teste simula um atendimento real do início ao fim:
 *   - Cliente envia mensagem
 *   - Agente decide quais ferramentas chamar (mockado para ser determinístico)
 *   - Ferramentas retornam resultados (mockados com dados realistas)
 *   - Agente sintetiza e responde ao cliente
 *
 * O que é validado em cada cenário:
 *   ✅ Quais ferramentas foram chamadas (e com quais argumentos)
 *   ✅ A resposta final ao cliente está correta
 *   ✅ O system prompt contém as instruções certas
 *   ✅ O histórico de contexto foi salvo corretamente
 *
 * Cenários cobertos:
 *   1.  Agendamento simples do início ao fim
 *   2.  Confirmação de horário → cria evento
 *   3.  Serviço disponível APENAS como pacote (depilação)
 *   4.  Tabela de dias da semana no prompt (Bug #35 — "terça = 30/05 sábado")
 *   5.  Remarcação — cliente já tem agendamento ativo
 *   6.  Histórico de agendamentos concluídos
 *   7.  Upsell de pacote com desconto percentual
 *   8.  Mudança de serviço no meio da conversa (Bug #33)
 *   9.  Agente NÃO cria duplicata quando evento já existe
 *   10. Transferência para humano quando solicitada explicitamente
 */

jest.mock("../contextManager");
jest.mock("../knowledgeBuilder");
jest.mock("../providers/AIProviderFactory");
jest.mock("../tools");
jest.mock("../../../models/Setting");
jest.mock("../../../models/GlobalSetting");
jest.mock("../../../models/AgentAction");
jest.mock("../../../libs/wbot", () => ({}));
jest.mock("../../../libs/socket", () => ({
  getIO: jest.fn().mockReturnValue({ to: jest.fn().mockReturnValue({ emit: jest.fn() }) })
}));

import { handleClientAgent } from "../index";
import * as contextManager from "../contextManager";
import * as knowledgeBuilder from "../knowledgeBuilder";
import { AIProviderFactory } from "../providers/AIProviderFactory";
import * as tools from "../tools";
import Setting from "../../../models/Setting";
import GlobalSetting from "../../../models/GlobalSetting";
import AgentAction from "../../../models/AgentAction";
import { clearSettingsCache } from "../settingsCache";
import { extractDateFromMessage } from "../agentUtils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockLoadContext = contextManager.loadContext as jest.Mock;
const mockSaveContext = contextManager.saveContext as jest.Mock;
const mockBuildPrompt = knowledgeBuilder.buildSystemPrompt as jest.Mock;
const mockGetTemp = knowledgeBuilder.getTemperatureForPersonality as jest.Mock;
const mockCreate = AIProviderFactory.create as jest.Mock;
const mockChatWithTools = jest.fn();

// ── Dados de teste ───────────────────────────────────────────────────────────

const BASE_INPUT = {
  companyId: 1,
  ticketId: 10,
  contactId: 5,
  contactName: "Maria",
  contactNumber: "5511999990001",
  whatsappId: 2
};

/** Resultado de listar_servicos com 3 serviços reais */
const SERVICOS_MOCK = {
  servicos: [
    { id: 1, nome: "Corte Feminino", duracaoMinutos: 60, profissionais: ["Amanda"] },
    { id: 2, nome: "Esmalte das mãos", duracaoMinutos: 30, profissionais: ["Amanda"] },
    { id: 3, nome: "Esmalte dos pés", duracaoMinutos: 30, profissionais: ["Amanda"] }
  ],
  total: 3
};

/** Resultado de listar_pacotes com Pacote Laser */
const PACOTES_MOCK = {
  pacotes: [
    {
      id: 1,
      nome: "Pacote Laser 10 sessões",
      servico: "Depilação a Laser",
      sessoes: 10,
      preco: 350,
      descontoPercent: 30,
      descricao: "10 sessões de depilação a laser com desconto especial"
    }
  ],
  total: 1
};

/** Resultado de buscar_proximo_horario — slot encontrado */
const SLOT_ENCONTRADO = {
  encontrado: true,
  data: "2026-05-26",
  hora: "09:00",
  profissional: "Amanda",
  profissionalId: 2,
  servico: "Corte Feminino",
  mensagem: "Próximo horário disponível: 2026-05-26 às 09:00 com Amanda."
};

/** Resultado de criar_evento — sucesso */
const EVENTO_CRIADO = {
  sucesso: true,
  scheduleId: 99,
  mensagem: "Agendamento criado com sucesso para 26/05/2026 às 09:00 com Amanda."
};

/** Resultado de buscar_agendamento_cliente — sem agendamento ativo */
const SEM_AGENDAMENTO = { agendamentos: [], total: 0, mensagem: "Nenhum agendamento ativo." };

/** Resultado de buscar_agendamento_cliente — COM agendamento pendente */
const COM_AGENDAMENTO = {
  agendamentos: [{
    id: 42,
    status: "PENDING",
    data: "2026-05-25",
    hora: "10:00",
    servico: "Corte Feminino",
    profissional: "Amanda"
  }],
  total: 1
};

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  clearSettingsCache();

  mockLoadContext.mockResolvedValue([]);
  mockSaveContext.mockResolvedValue(undefined);
  mockBuildPrompt.mockResolvedValue(
    "Você é Luna, assistente virtual da Estética Bella no WhatsApp."
  );
  mockGetTemp.mockReturnValue(0.5);
  (AgentAction.create as jest.Mock).mockResolvedValue({});

  (Setting.findAll as jest.Mock).mockResolvedValue([
    { key: "agentProvider", value: "anthropic" },
    { key: "agentApiKey", value: "sk-test" },
    { key: "agentModel", value: "claude-3-haiku-20240307" },
    { key: "agentPersonality", value: "híbrido" }
  ]);
  (GlobalSetting.findAll as jest.Mock).mockResolvedValue([]);

  mockCreate.mockReturnValue({ chatWithTools: mockChatWithTools });
  (tools.ALL_AGENT_TOOLS as any) = [];
  (tools.executeAgentTool as any) = jest.fn();
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Resposta do LLM que chama N ferramentas */
function llmCallsTools(
  ...calls: { id: string; name: string; args: Record<string, unknown> }[]
) {
  return {
    content: null,
    toolCalls: calls.map(c => ({ id: c.id, name: c.name, arguments: c.args })),
    finishReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 }
  };
}

/** Resposta do LLM com texto final ao cliente */
function llmResponds(text: string) {
  return {
    content: text,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 20, outputTokens: 15 }
  };
}

/** Retorna quais tools foram efetivamente executadas pelo executeAgentTool */
function executedTools(): string[] {
  return (tools.executeAgentTool as jest.Mock).mock.calls.map((c: any[]) => c[0]);
}

/** Retorna os argumentos da N-ésima chamada de uma tool específica */
function argsOf(toolName: string, callIndex = 0): Record<string, unknown> {
  const calls = (tools.executeAgentTool as jest.Mock).mock.calls.filter(
    (c: any[]) => c[0] === toolName
  );
  return calls[callIndex]?.[1] ?? {};
}

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 1: Agendamento simples do início ao fim
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 1: Agendamento simples — lista serviços + busca horário", () => {
  it("agente chama listar_servicos e buscar_proximo_horario ao receber pedido de agendamento", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })     // listar_servicos
      .mockResolvedValueOnce({ result: SLOT_ENCONTRADO });  // buscar_proximo_horario

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "buscar_proximo_horario", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds(
        "Temos horário disponível para Corte Feminino amanhã, 26/05/2026, às 09:00 com Amanda. Confirmo?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero agendar um corte de cabelo"
    });

    // Ferramentas corretas foram chamadas
    expect(executedTools()).toContain("listar_servicos");
    expect(executedTools()).toContain("buscar_proximo_horario");

    // buscar_proximo_horario foi chamado com o servicoId do serviço correto
    expect(argsOf("buscar_proximo_horario").servicoId).toBe(1);

    // Resposta menciona o horário encontrado
    expect(result.reply).toContain("09:00");
    expect(result.reply).toContain("Amanda");
  });

  it("agente responde com 'nenhum horário' quando todos os slots estão ocupados", async () => {
    const semSlot = {
      encontrado: false,
      mensagem: "Nenhum horário disponível nos próximos 7 dias."
    };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: semSlot });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "buscar_proximo_horario", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds(
        "Infelizmente não temos horários disponíveis para Corte Feminino nos próximos 7 dias. Gostaria de ser avisada quando abrir vaga?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero corte de cabelo"
    });

    expect(result.reply).toMatch(/não temos horários|indisponível|sem vaga/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 2: Confirmação → cria evento
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 2: Cliente confirma horário → agente cria evento", () => {
  it("cria evento com data/hora corretos após confirmação do cliente", async () => {
    // Histórico: agente já propôs 26/05 às 09:00
    mockLoadContext.mockResolvedValue([
      { role: "user", content: "Quero corte" },
      { role: "assistant", content: "Temos 26/05/2026 às 09:00 com Amanda. Confirmo?" }
    ]);

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SEM_AGENDAMENTO })  // buscar_agendamento_cliente
      .mockResolvedValueOnce({ result: EVENTO_CRIADO });   // criar_evento

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools(
        { id: "c1", name: "buscar_agendamento_cliente", args: {} }
      ))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "criar_evento",
        args: { servicoId: 1, atendenteId: 2, data: "2026-05-26", hora: "09:00" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "✅ Corte Feminino agendado para 26/05/2026 às 09:00 com Amanda! Até lá, Maria."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Sim, pode confirmar"
    });

    // criar_evento deve ter sido chamado com a data/hora corretos
    expect(executedTools()).toContain("criar_evento");
    expect(argsOf("criar_evento").data).toBe("2026-05-26");
    expect(argsOf("criar_evento").hora).toBe("09:00");

    // Resposta confirma o agendamento
    expect(result.reply).toMatch(/agendado|confirmado|✅/i);
  });

  it("NÃO chama criar_evento quando não há confirmação (pergunta do cliente)", async () => {
    mockChatWithTools.mockResolvedValueOnce(
      llmResponds("Você prefere Corte Feminino ou Esmalte?")
    );

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quais serviços vocês têm?"
    });

    // Sem confirmação → nenhum evento criado
    expect(executedTools()).not.toContain("criar_evento");
    expect(result.reply).toContain("?");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 3: Serviço disponível APENAS como pacote (Depilação a Laser)
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 3: Serviço só existe como pacote — agente deve oferecer pacote", () => {
  it("chama listar_pacotes após listar_servicos e menciona pacote ao cliente", async () => {
    // listar_servicos: sem depilação
    // listar_pacotes: tem Pacote Laser
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })    // listar_servicos (sem depilação)
      .mockResolvedValueOnce({ result: PACOTES_MOCK });    // listar_pacotes

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "listar_pacotes", args: {} }))
      .mockResolvedValueOnce(llmResponds(
        "Depilação a laser não está no catálogo de serviços avulsos, mas temos o " +
        "Pacote 10 Sessões de Laser por R$350 — 30% de desconto vs sessões avulsas! " +
        "Quer saber mais ou posso conectar com um atendente?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Gostaria de fazer depilação a laser"
    });

    // Ambas as ferramentas foram chamadas
    expect(executedTools()).toContain("listar_servicos");
    expect(executedTools()).toContain("listar_pacotes");

    // Agente NÃO diz simplesmente "não temos" — menciona o pacote
    expect(result.reply).not.toMatch(/^(esse serviço não está disponível|não temos esse serviço)$/i);
    expect(result.reply).toMatch(/pacote|laser/i);
  });

  it("informa desconto percentual correto do pacote (30%)", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: PACOTES_MOCK });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "listar_pacotes", args: {} }))
      .mockResolvedValueOnce(llmResponds(
        "Temos o Pacote Laser 10 sessões por R$350 com 30% de desconto!"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Tem pacote de depilação?"
    });

    expect(result.reply).toMatch(/30%|trinta por cento/i);
    expect(result.reply).toMatch(/R\$\s*350|trezentos e cinquenta/i);
  });

  it("quando listar_pacotes também não tem o serviço, agente informa claramente", async () => {
    const pacotesVazios = { pacotes: [], total: 0 };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: pacotesVazios });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "listar_pacotes", args: {} }))
      .mockResolvedValueOnce(llmResponds(
        "Esse serviço não está disponível no momento. Posso ajudar com Corte Feminino, Esmalte das mãos ou Esmalte dos pés."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Tem massagem?"
    });

    // Com listar_pacotes vazio, agente pode dizer "não temos"
    expect(result.reply).toMatch(/não está disponível|não temos/i);
    // Mas deve oferecer alternativas reais
    expect(result.reply).toMatch(/corte|esmalte/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 4: Tabela de dias da semana no system prompt (Bug #35)
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 4: Tabela de dias da semana (Bug #35 — LLM calculava terça = 30/05 sábado)", () => {
  afterEach(() => jest.useRealTimers());

  it("injeta tabela com ISO correto para cada dia quando hoje é segunda 25/05", async () => {
    // Bug real: hoje=segunda 25/05, cliente pediu terça, LLM computou 30/05 (sábado!)
    // Fix: tabela explícita no prompt — LLM apenas consulta, não calcula
    jest.useFakeTimers().setSystemTime(new Date("2026-05-25T12:00:00-03:00")); // segunda BRT

    mockChatWithTools.mockResolvedValueOnce(llmResponds("Ok, verificarei para terça!"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Quero marcar para terça à tarde" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;

    // Hoje: segunda 25/05
    expect(systemPrompt).toMatch(/segunda-feira.*25\/05\/2026|25\/05\/2026.*segunda/i);
    // Terça REAL: 26/05 — NÃO 30/05 (sábado)
    expect(systemPrompt).toMatch(/ter[çc]a-feira.*26\/05\/2026|26\/05\/2026.*ter[çc]a/i);
    // ISO correto para as tools de calendário
    expect(systemPrompt).toContain("2026-05-26");
    // Sábado REAL: 30/05 — confirmando que o LLM tem a data certa do sábado
    expect(systemPrompt).toMatch(/s[áa]bado.*30\/05\/2026|30\/05\/2026.*s[áa]bado/i);
    // Instrução explícita para NÃO calcular
    expect(systemPrompt).toMatch(/nunca.*calcul|consulte.*tabela|n[ãa]o.*calcul/i);
  });

  it("tabela atravessa virada de mês corretamente (sexta 29/05 → segunda 01/06)", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-29T12:00:00-03:00")); // sexta

    mockChatWithTools.mockResolvedValueOnce(llmResponds("Ok!"));
    await handleClientAgent({ ...BASE_INPUT, userMessage: "Quando tem vaga?" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;

    // Próxima segunda: 01/06 (virada de mês)
    expect(systemPrompt).toContain("2026-06-01");
    // Domingo 31/05 deve estar na tabela
    expect(systemPrompt).toContain("2026-05-31");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 5: Remarcação — cliente já tem agendamento ativo
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 5: Remarcação — agente usa reagendar_evento, não criar_evento", () => {
  it("chama reagendar_evento quando cliente tem agendamento PENDENTE", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: COM_AGENDAMENTO })  // buscar_agendamento_cliente → tem pendente
      .mockResolvedValueOnce({ result: { sucesso: true, mensagem: "Reagendado para 26/05 às 14:00." } });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "buscar_agendamento_cliente", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "reagendar_evento",
        args: { scheduleId: 42, novaData: "2026-05-26", novaHora: "14:00" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "✅ Remarcado! Seu Corte Feminino agora está agendado para 26/05/2026 às 14:00 com Amanda."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero mudar meu horário para amanhã às 14h"
    });

    // Deve usar reagendar, NÃO criar novo
    expect(executedTools()).toContain("reagendar_evento");
    expect(executedTools()).not.toContain("criar_evento");

    // Chama com o scheduleId do agendamento existente
    expect(argsOf("reagendar_evento").scheduleId).toBe(42);
    expect(argsOf("reagendar_evento").novaData).toBe("2026-05-26");

    expect(result.reply).toMatch(/remarcado|reagendado|✅/i);
  });

  it("cria evento normalmente quando cliente NÃO tem agendamento pendente", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SEM_AGENDAMENTO })  // buscar_agendamento_cliente → vazio
      .mockResolvedValueOnce({ result: EVENTO_CRIADO });   // criar_evento

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "buscar_agendamento_cliente", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "criar_evento",
        args: { servicoId: 1, data: "2026-05-26", hora: "09:00" }
      }))
      .mockResolvedValueOnce(llmResponds("✅ Agendado!"));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero marcar corte para amanhã às 9h"
    });

    // Sem agendamento pendente → criar_evento é o correto
    expect(executedTools()).toContain("criar_evento");
    expect(executedTools()).not.toContain("reagendar_evento");
    expect(result.reply).toMatch(/agendado|✅/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 6: Histórico de agendamentos concluídos
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 6: Histórico de agendamentos — cliente pergunta sobre atendimentos passados", () => {
  it("chama listar_agendamentos e responde com dados do histórico", async () => {
    const historico = {
      agendamentos: [
        {
          id: 10,
          status: "DONE",
          data: "2026-05-10",
          hora: "10:00",
          servico: "Corte Feminino",
          profissional: "Amanda"
        }
      ],
      total: 1
    };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: historico });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({
        id: "c1",
        name: "listar_agendamentos",
        args: { status: "DONE" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "Seu último atendimento foi um Corte Feminino no dia 10/05/2026 às 10:00 com Amanda."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quando foi meu último atendimento?"
    });

    expect(executedTools()).toContain("listar_agendamentos");
    expect(result.reply).toMatch(/10\/05\/2026|corte|amanda/i);
  });

  it("informa corretamente quando não há histórico de atendimentos", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: { agendamentos: [], total: 0 } });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_agendamentos", args: {} }))
      .mockResolvedValueOnce(llmResponds(
        "Você ainda não tem atendimentos registrados conosco. Gostaria de agendar o primeiro?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Já fui atendida aí antes?"
    });

    expect(result.reply).toMatch(/não tem|ainda não|nenhum/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 7: Upsell de pacote — agente menciona pacote proativamente
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 7: Upsell — agente oferece pacote ao listar serviços", () => {
  it("menciona pacote disponível ao apresentar catálogo de serviços", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: PACOTES_MOCK });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools(
        { id: "c1", name: "listar_servicos", args: {} },
        { id: "c2", name: "listar_pacotes", args: {} }
      ))
      .mockResolvedValueOnce(llmResponds(
        "Nossos serviços: 1. Corte Feminino (60min), 2. Esmalte das mãos, 3. Esmalte dos pés. " +
        "💡 Temos também o Pacote Laser 10 sessões por R$350 — 30% de economia! Qual você prefere?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quais serviços vocês têm?"
    });

    expect(executedTools()).toContain("listar_servicos");
    expect(executedTools()).toContain("listar_pacotes");
    expect(result.reply).toMatch(/corte|esmalte/i);
    // Upsell do pacote presente
    expect(result.reply).toMatch(/pacote|laser|desconto/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 8: Mudança de serviço no meio da conversa (Bug #33)
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 8: Mudança de serviço — agente usa o ÚLTIMO serviço discutido (Bug #33)", () => {
  it("injeta serviço mais recente no system prompt quando cliente mudou de ideia", async () => {
    // Histórico: cliente falou de Esmalte primeiro, depois Depilação
    // O system prompt DEVE mencionar Depilação como serviço em discussão
    mockLoadContext.mockResolvedValue([
      { role: "user", content: "Quero esmalte" },
      {
        role: "tool",
        content: JSON.stringify({
          servico: "Esmalte das mãos",
          disponivel: false,
          profissionais: []
        }),
        toolCallId: "c1",
        name: "verificar_disponibilidade"
      },
      {
        role: "assistant",
        content: "Infelizmente não temos horário disponível para esmalte no momento."
      },
      { role: "user", content: "E depilação a laser, como funciona?" },
      {
        role: "tool",
        content: JSON.stringify({
          servico: "Depilação a Laser",  // ← MAIS RECENTE
          pacotes: [{ nome: "Pacote Laser 10 sessões", preco: 350 }]
        }),
        toolCallId: "c2",
        name: "listar_pacotes"
      },
      {
        role: "assistant",
        content: "A depilação a laser remove pelos de forma eficaz..."
      }
    ]);

    mockChatWithTools.mockResolvedValueOnce(llmResponds(
      "Você está se referindo ao Pacote Laser? Posso te ajudar com isso!"
    ));

    await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero agendar"
    });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;

    // O bloco de "serviço em discussão" deve apontar para Depilação (último),
    // não para Esmalte (primeiro, mas desatualizado)
    expect(systemPrompt).toContain("Depilação a Laser");
    expect(systemPrompt).not.toMatch(/esmalte.*servi[çc]o em discuss[ãa]o/i);
    // Deve conter a instrução de usar esse serviço ao confirmar
    expect(systemPrompt).toMatch(/servi[çc]o em discuss[ãa]o/i);
  });

  it("NÃO injeta bloco de serviço quando não há nenhum serviço no histórico", async () => {
    // Histórico limpo — cliente nunca mencionou um serviço
    mockLoadContext.mockResolvedValue([
      { role: "user", content: "Olá, vocês atendem aos sábados?" },
      { role: "assistant", content: "Sim, atendemos!" }
    ]);

    mockChatWithTools.mockResolvedValueOnce(llmResponds("Claro! Como posso ajudar?"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Que ótimo!" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    // Sem serviço no histórico → o BLOCO dinâmico não deve aparecer.
    // Nota: o texto da regra 12 menciona a frase como exemplo (com aspas simples),
    // mas o bloco dinâmico real tem formato: **Serviço...:** "NomeDoServiço"
    // Verificamos que o bloco com aspas duplas (nome do serviço injetado) não está presente.
    expect(systemPrompt).not.toMatch(/\*\*Servi[çc]o em discuss[ãa]o nesta conversa:\*\*\s+"/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 9: Anti-duplicata — não cria segundo evento se já tem ativo
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 9: Anti-duplicata — cria_evento bloqueado, agente usa reagendar_evento", () => {
  it("quando criar_evento retorna erro de duplicata, agente usa reagendar_evento", async () => {
    const erroDuplicata = {
      erro: "Cliente já tem agendamento #42 ativo. Use reagendar_evento(scheduleId=42) para alterar.",
      scheduleId: 42
    };
    const reagendamentoOk = { sucesso: true, mensagem: "Reagendado com sucesso." };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SEM_AGENDAMENTO })     // buscar_agendamento_cliente
      .mockResolvedValueOnce({ result: erroDuplicata })        // criar_evento → ERRO
      .mockResolvedValueOnce({ result: reagendamentoOk });     // reagendar_evento → OK

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "buscar_agendamento_cliente", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "criar_evento",
        args: { servicoId: 1, data: "2026-05-26", hora: "09:00" }
      }))
      // LLM recebe o erro e chama reagendar
      .mockResolvedValueOnce(llmCallsTools({
        id: "c3",
        name: "reagendar_evento",
        args: { scheduleId: 42, novaData: "2026-05-26", novaHora: "09:00" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "✅ Como você já tinha um agendamento, atualizei para 26/05 às 09:00."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero marcar para amanhã às 9h"
    });

    expect(executedTools()).toContain("criar_evento");
    expect(executedTools()).toContain("reagendar_evento");
    expect(argsOf("reagendar_evento").scheduleId).toBe(42);
    expect(result.reply).toMatch(/agendado|reagendado|✅/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 10: Transferência para humano quando solicitada explicitamente
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 10: Transferência para humano — somente quando cliente pede explicitamente", () => {
  it("transfere para humano quando cliente pede explicitamente 'quero falar com atendente'", async () => {
    const transferOk = { sucesso: true, mensagem: "Ticket transferido para atendimento humano." };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: transferOk });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({
        id: "c1",
        name: "transferir_para_humano",
        args: { motivo: "Cliente solicitou atendimento humano" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "Claro! Estou transferindo para um atendente humano. Um momento, por favor."
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero falar com um atendente humano, por favor"
    });

    expect(executedTools()).toContain("transferir_para_humano");
    expect(result.reply).toMatch(/atendente|transferindo|aguardar/i);
  });

  it("NÃO transfere para humano em situação de agendamento normal", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: SLOT_ENCONTRADO });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({ id: "c2", name: "buscar_proximo_horario", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds(
        "Temos às 09:00 amanhã! Confirmo?"
      ));

    await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero marcar um corte"
    });

    // Agendamento normal → sem transferência
    expect(executedTools()).not.toContain("transferir_para_humano");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 11: Verificar disponibilidade em dia específico pedido pelo cliente
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 11: Verificar disponibilidade para dia específico solicitado", () => {
  it("chama verificar_disponibilidade (não buscar_proximo) quando cliente especifica data", async () => {
    const slotsDisponivel = {
      disponivel: true,
      data: "2026-05-26",
      servico: "Corte Feminino",
      profissionais: [
        { id: 2, nome: "Amanda", slots: ["14:00", "15:00", "16:00"] }
      ]
    };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: slotsDisponivel });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "verificar_disponibilidade",
        args: { servicoId: 1, data: "2026-05-26" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "Amanhã, 26/05, temos com Amanda: 14:00, 15:00 ou 16:00. Qual prefere?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero corte amanhã à tarde"
    });

    // Para data específica: verificar_disponibilidade (não buscar_proximo_horario)
    expect(executedTools()).toContain("verificar_disponibilidade");
    expect(argsOf("verificar_disponibilidade").data).toBe("2026-05-26");
    expect(result.reply).toMatch(/14:00|15:00|16:00|amanda/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 12: Contexto do atendimento — agente usa dados do cliente sem perguntar
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 12: Dados do cliente injetados — agente não pergunta o que já sabe", () => {
  it("injeta nome e número do cliente no system prompt", async () => {
    mockChatWithTools.mockResolvedValueOnce(llmResponds("Olá Maria! Como posso ajudar?"));

    await handleClientAgent({
      ...BASE_INPUT,
      contactName: "Maria",
      contactNumber: "5511999990001",
      userMessage: "Oi"
    });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    expect(systemPrompt).toContain("Maria");
    expect(systemPrompt).toContain("5511999990001");
    // Instrução para não perguntar o que já sabe (aceita "Nunca pergunte" ou "não pergunte")
    expect(systemPrompt).toMatch(
      /n[ãa]o perg.*nome|n[ãa]o perg.*telefone|nunca pergunte?.*nome|nunca pergunte?.*telefone/i
    );
  });

  it("injeta ticketId para tools que precisam identificar o ticket", async () => {
    mockChatWithTools.mockResolvedValueOnce(llmResponds("Ok!"));

    await handleClientAgent({ ...BASE_INPUT, ticketId: 99, userMessage: "Oi" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    expect(systemPrompt).toContain("99");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 13: Período do dia determinístico (Bug #35 — "E para a tarde?")
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 13: Período do dia (manhã/tarde/noite) — filtro determinístico", () => {
  it("injeta a regra de repasse do período no system prompt (não filtrar manualmente)", async () => {
    mockChatWithTools.mockResolvedValueOnce(llmResponds("Claro! Para qual serviço?"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem horário à tarde?" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    // A regra 13 deve orientar o LLM a PASSAR `periodo` e NÃO filtrar sozinho.
    expect(systemPrompt).toMatch(/periodo/i);
    expect(systemPrompt).toMatch(/manh[ãa]|tarde|noite/i);
    expect(systemPrompt).toMatch(/n[ãa]o.*filtr|repasse/i);
  });

  it("passa periodo='tarde' à verificar_disponibilidade e responde só com horários da tarde", async () => {
    // Tool já devolve SOMENTE a tarde (filtro determinístico no backend).
    const slotsTarde = {
      disponivel: true,
      data: "2026-05-26",
      servico: "Corte Feminino",
      periodo: "tarde",
      profissionais: [{ id: 2, nome: "Amanda", slots: ["14:00", "15:00", "16:00"] }]
    };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SERVICOS_MOCK })
      .mockResolvedValueOnce({ result: slotsTarde });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "listar_servicos", args: {} }))
      .mockResolvedValueOnce(llmCallsTools({
        id: "c2",
        name: "verificar_disponibilidade",
        args: { servicoId: 1, data: "2026-05-26", periodo: "tarde" }
      }))
      .mockResolvedValueOnce(llmResponds(
        "À tarde temos com Amanda: 14:00, 15:00 ou 16:00. Qual prefere?"
      ));

    const result = await handleClientAgent({
      ...BASE_INPUT,
      userMessage: "Quero corte amanhã, mas só de tarde"
    });

    // O período foi REPASSADO à tool (determinístico), não filtrado pelo LLM.
    expect(executedTools()).toContain("verificar_disponibilidade");
    expect(argsOf("verificar_disponibilidade").periodo).toBe("tarde");
    // Resposta NÃO contém o erro de regressão e lista só horários da tarde.
    expect(result.reply).not.toMatch(/não consegui verificar/i);
    expect(result.reply).toMatch(/14:00|15:00|16:00/);
  });

  it("INJETA periodo='tarde' deterministicamente quando o LLM OMITE o argumento (Bug #37)", async () => {
    // Cenário REAL do bug: gpt-4o-mini chama verificar_disponibilidade SEM `periodo`
    // ao receber "E para a tarde?". A injeção determinística no orquestrador garante
    // que a tool seja chamada com periodo='tarde' mesmo assim — independente do modelo.
    const slotsTarde = {
      disponivel: true,
      data: "2026-05-26",
      servico: "Corte Feminino",
      periodo: "tarde",
      profissionais: [{ id: 2, nome: "Amanda", slots: ["14:00", "15:00"] }]
    };

    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: slotsTarde });

    mockChatWithTools
      // LLM OMITE periodo de propósito (reproduz o comportamento do gpt-4o-mini)
      .mockResolvedValueOnce(llmCallsTools({
        id: "c1",
        name: "verificar_disponibilidade",
        args: { servicoId: 1, data: "2026-05-26" }
      }))
      .mockResolvedValueOnce(llmResponds("À tarde temos 14:00 ou 15:00 com Amanda."));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "E para a tarde?" });

    // Mesmo sem o LLM passar, o orquestrador injetou periodo='tarde' nos args.
    expect(argsOf("verificar_disponibilidade").periodo).toBe("tarde");
  });

  it("NÃO injeta periodo quando a mensagem do cliente não menciona período", async () => {
    (tools.executeAgentTool as jest.Mock)
      .mockResolvedValueOnce({ result: SLOT_ENCONTRADO });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "buscar_proximo_horario", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds("Temos 09:00 amanhã!"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Quero um corte de cabelo" });

    // Sem período na mensagem → argumento permanece ausente (não inventamos período).
    expect(argsOf("buscar_proximo_horario").periodo).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CENÁRIO 14: Horário específico (Bug #B1) + âncora de data (Bug #B2)
// Reproduz o print real do usuário (2026-06-20): "Tem horário para as 11h?"
// → bot respondia "não consegui verificar". Agora a resposta é determinística.
// ────────────────────────────────────────────────────────────────────────────

describe("Cenário 14: Horário específico (Bug #B1) e âncora de data (Bug #B2)", () => {
  /** Resultado de verificar_disponibilidade com checagem de horário específico */
  const DISPONIVEL_11H = {
    disponivel: true,
    data: "2026-06-22",
    dataFormatada: "segunda-feira, 22/06/2026",
    servico: "Corte Feminino",
    horaConsultada: "11:00",
    horaConsultadaDisponivel: true,
    profissionais: [
      { id: 2, nome: "Amanda", horariosDisponiveis: 5, rangeFormatado: "das 09:00 às 18:00", horaDisponivel: true }
    ]
  };

  it("INJETA hora='11:00' deterministicamente quando o LLM OMITE o argumento", async () => {
    // Cenário do print: cliente pergunta "Tem horário para as 11h?". O gpt-4o-mini
    // chama verificar_disponibilidade SEM `hora`. A injeção garante a checagem.
    (tools.executeAgentTool as jest.Mock).mockResolvedValueOnce({ result: DISPONIVEL_11H });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({
        id: "c1",
        name: "verificar_disponibilidade",
        args: { servicoId: 1, data: "2026-06-22" } // SEM hora
      }))
      .mockResolvedValueOnce(llmResponds("Sim! Às 11h a Amanda está livre. Posso confirmar?"));

    const result = await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem horário para as 11h?" });

    // Orquestrador injetou hora normalizada nos args da tool.
    expect(argsOf("verificar_disponibilidade").hora).toBe("11:00");
    // Resposta NÃO contém o bordão de falha.
    expect(result.reply).not.toMatch(/não consegui verificar/i);
  });

  it("NÃO injeta hora quando a mensagem não menciona horário (evita falso-positivo com data)", async () => {
    (tools.executeAgentTool as jest.Mock).mockResolvedValueOnce({ result: DISPONIVEL_11H });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({
        id: "c1",
        name: "verificar_disponibilidade",
        args: { servicoId: 1, data: "2026-06-22" }
      }))
      .mockResolvedValueOnce(llmResponds("Temos horários nesse dia."));

    // "22 é que dia?" tem o número 22 mas NÃO é horário — não pode virar hora.
    await handleClientAgent({ ...BASE_INPUT, userMessage: "22 é que dia? Segunda ou terça?" });

    expect(argsOf("verificar_disponibilidade").hora).toBeUndefined();
  });

  it("injeta o bloco de âncora de DATA no system prompt a partir do histórico (Bug #B2)", async () => {
    // Histórico já tem um tool result com data discutida (22/06). Quando o cliente
    // refina por horário sem repetir o dia, o prompt deve trazer a data em pauta.
    mockLoadContext.mockResolvedValue([
      { role: "user", content: "Quero cortar o cabelo" },
      {
        role: "tool",
        toolCallId: "x",
        name: "buscar_proximo_horario",
        content: JSON.stringify({ encontrado: true, data: "2026-06-22", hora: "09:00", servico: "Corte Feminino" })
      },
      { role: "assistant", content: "O próximo horário é segunda, 22/06 às 09:00 com Amanda." }
    ]);

    mockChatWithTools.mockResolvedValueOnce(llmResponds("Deixa eu checar as 11h."));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem às 11h?" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    // O bloco de data em discussão deve estar presente, com a data ISO e o dia da semana.
    expect(systemPrompt).toMatch(/Data em discuss[ãa]o/i);
    expect(systemPrompt).toContain("2026-06-22");
    expect(systemPrompt).toMatch(/segunda-feira/i);
  });

  // CAUSA-RAIZ "não consegui verificar" (2026-06-21): o modelo barato chamava
  // verificar_disponibilidade SEM `data`. Agora o orquestrador injeta a data
  // deterministicamente (da mensagem, senão do histórico).
  it("INJETA data + hora quando o LLM omite ambos ('tem às 11h?' com data no histórico)", async () => {
    mockLoadContext.mockResolvedValue([
      { role: "user", content: "Quero cortar o cabelo" },
      {
        role: "tool", toolCallId: "x", name: "buscar_proximo_horario",
        content: JSON.stringify({ encontrado: true, data: "2026-06-22", hora: "09:00", servico: "Corte Feminino" })
      },
      { role: "assistant", content: "Próximo horário: segunda, 22/06 às 09:00." }
    ]);
    (tools.executeAgentTool as jest.Mock).mockResolvedValueOnce({ result: DISPONIVEL_11H });

    mockChatWithTools
      // LLM omite data E hora (data "no contexto") — reproduz o gpt-4o-mini do print
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "verificar_disponibilidade", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds("Sim, às 11h a Amanda está livre!"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem às 11h?" });

    // Orquestrador injetou a data (do histórico) e a hora (da mensagem).
    expect(argsOf("verificar_disponibilidade").data).toBe("2026-06-22");
    expect(argsOf("verificar_disponibilidade").hora).toBe("11:00");
  });

  it("INJETA data resolvida da mensagem quando o cliente diz um dia ('tem na sexta?')", async () => {
    (tools.executeAgentTool as jest.Mock).mockResolvedValueOnce({ result: DISPONIVEL_11H });

    mockChatWithTools
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "verificar_disponibilidade", args: { servicoId: 1 } }))
      .mockResolvedValueOnce(llmResponds("Na sexta temos horários."));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem data na sexta-feira?" });

    // A data injetada deve casar com a resolução determinística de "sexta".
    const esperada = extractDateFromMessage("Tem data na sexta-feira?");
    expect(esperada).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(argsOf("verificar_disponibilidade").data).toBe(esperada);
  });

  // CAUSA-RAIZ confirmada por print (2026-06-21): o modelo se esquiva
  // ("não consegui verificar a disponibilidade") SEM chamar a tool. O
  // orquestrador detecta e FORÇA a verificação.
  it("FORÇA a verificação quando o modelo se esquiva sem chamar a tool ('não consegui verificar')", async () => {
    mockLoadContext.mockResolvedValue([
      {
        role: "tool", toolCallId: "x", name: "buscar_proximo_horario",
        content: JSON.stringify({ encontrado: true, data: "2026-06-22", hora: "09:00", servico: "Corte Feminino" })
      }
    ]);
    (tools.executeAgentTool as jest.Mock).mockResolvedValueOnce({ result: DISPONIVEL_11H });

    mockChatWithTools
      // 1ª resposta: ESQUIVA — texto sem tool call (reproduz o gpt-4o-mini do print)
      .mockResolvedValueOnce(llmResponds("Para o Corte Feminino, não consegui verificar a disponibilidade para o horário das 11h."))
      // 2ª (após o [SISTEMA] forçado): agora chama a tool
      .mockResolvedValueOnce(llmCallsTools({ id: "c1", name: "verificar_disponibilidade", args: { servicoId: 1, data: "2026-06-22", hora: "11:00" } }))
      // 3ª: responde objetivamente
      .mockResolvedValueOnce(llmResponds("Sim! Às 11h a Amanda está livre. Posso confirmar?"));

    const result = await handleClientAgent({ ...BASE_INPUT, userMessage: "Tem horário para as 11h?" });

    // A tool foi efetivamente executada (o orquestrador não aceitou a esquiva).
    expect(executedTools()).toContain("verificar_disponibilidade");
    // A resposta final NÃO é mais o bordão de falha.
    expect(result.reply).not.toMatch(/não consegui verificar/i);
    expect(result.reply).toMatch(/11h|livre|dispon/i);
  });

  it("NÃO força verificação quando não houve pergunta de horário específico", async () => {
    // "não consegui verificar" sem o cliente ter pedido um horário → não re-itera
    // (evita loop em casos onde a esquiva não se aplica).
    mockChatWithTools.mockResolvedValueOnce(
      llmResponds("Desculpe, não consegui verificar a disponibilidade no momento.")
    );

    const result = await handleClientAgent({ ...BASE_INPUT, userMessage: "Bom dia" });

    // Só 1 chamada ao modelo — sem re-iteração forçada (não havia hora na mensagem).
    expect(mockChatWithTools).toHaveBeenCalledTimes(1);
    expect(result.reply).toMatch(/não consegui verificar/i);
  });

  it("system prompt traz a regra de horário específico (15) e a de dia da semana (16)", async () => {
    mockChatWithTools.mockResolvedValueOnce(llmResponds("Como posso ajudar?"));

    await handleClientAgent({ ...BASE_INPUT, userMessage: "Oi" });

    const systemPrompt = mockChatWithTools.mock.calls[0][2] as string;
    // Regra 15: horário específico → horaConsultadaDisponivel, proibido "não consegui verificar"
    expect(systemPrompt).toMatch(/horaConsultadaDisponivel/);
    expect(systemPrompt).toMatch(/n[ãa]o consegui verificar/i);
    // Regra 16: usar dataFormatada / dia da semana
    expect(systemPrompt).toMatch(/dataFormatada/);
    expect(systemPrompt).toMatch(/dia da semana/i);
  });
});
