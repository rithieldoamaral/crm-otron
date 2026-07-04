/**
 * Testes TDD para knowledgeBuilder — monta system prompt a partir das Settings.
 */

jest.mock("../../../models/Setting");
// settingsCache usa Setting.findAll internamente — mocking o modelo é suficiente.
// Mas o cache em memória persiste entre testes: clearSettingsCache() garante
// que cada teste parte de um estado limpo e recebe seu próprio mock return.
jest.mock("../settingsCache", () => {
  const original = jest.requireActual("../settingsCache");
  return original; // usa a implementação real — o mock é no nível do Setting model
});

import Setting from "../../../models/Setting";
import { buildSystemPrompt, getTemperatureForPersonality } from "../knowledgeBuilder";
import { clearSettingsCache } from "../settingsCache";

const mockFindAll = Setting.findAll as jest.Mock;

function makeSettings(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    agentName: "Luna",
    agentPersonality: "atencioso",
    agentBusinessName: "Barbearia do João",
    agentServices: "Corte de cabelo, Barba",
    agentHours: "Seg-Sáb 9h-19h",
    agentFAQ: "",
    agentInstructions: "",
    agentRestrictions: ""
  };
  const merged = { ...defaults, ...overrides };
  return Object.entries(merged).map(([key, value]) => ({ key, value }));
}

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // settingsCache persiste entre testes — limpar garante que cada teste
    // vê seu próprio mockFindAll.mockResolvedValue sem interferência.
    clearSettingsCache();
  });

  it("inclui nome do agente no prompt", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentName: "Max" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/Max/);
  });

  it("inclui nome do negócio no prompt", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentBusinessName: "Pet Shop Feliz" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/Pet Shop Feliz/);
  });

  // Bug #31: agentServices (texto livre do "Conhecimento do Negócio") criava
  // ambiguidade — o LLM usava esses 12 itens como fonte de verdade e ignorava
  // a tool listar_servicos (que retorna os 4 serviços reais do BD).
  // Fix: agentServices não deve ser injetado no prompt; o LLM deve obter a
  // lista SEMPRE via listar_servicos.
  it("[Bug #31] NÃO injeta agentServices no prompt — LLM deve usar listar_servicos", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentServices: "Banho e tosa, Vacina" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).not.toMatch(/Banho e tosa/);
    expect(prompt).not.toMatch(/Serviços oferecidos/i);
  });

  it("[Bug #31] instrui o LLM a usar listar_servicos para nomes/IDs dos serviços", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentServices: "" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/listar_servicos/);
    // Deve deixar claro que listar_servicos é para nomes/IDs (catálogo), não para horários
    expect(prompt).toMatch(/(nomes|IDs|catálog)/i);
  });

  it("inclui horários no prompt", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentHours: "Dom-Sex 8h-18h" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/Dom-Sex 8h-18h/);
  });

  it("inclui FAQ quando configurado", async () => {
    mockFindAll.mockResolvedValue(makeSettings({
      agentFAQ: "P: Aceitam cartão? R: Sim, todos os cartões."
    }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/Aceitam cartão/);
  });

  it("não inclui seção FAQ quando está vazia", async () => {
    mockFindAll.mockResolvedValue(makeSettings({ agentFAQ: "" }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).not.toMatch(/FAQ/i);
  });

  it("inclui instruções customizadas quando configuradas", async () => {
    mockFindAll.mockResolvedValue(makeSettings({
      agentInstructions: "Sempre oferecer desconto para novos clientes"
    }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/desconto para novos clientes/);
  });

  it("inclui restrições quando configuradas", async () => {
    mockFindAll.mockResolvedValue(makeSettings({
      agentRestrictions: "Nunca mencionar concorrentes"
    }));
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/Nunca mencionar concorrentes/);
  });

  it("usa valores padrão quando Settings estão ausentes", async () => {
    mockFindAll.mockResolvedValue([]);
    const prompt = await buildSystemPrompt(1);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("busca settings filtradas pelo companyId correto", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    await buildSystemPrompt(42);
    expect(mockFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 42 })
      })
    );
  });

  // Regressão bug #3: LLM gpt-oss-120b chamou criar_evento com argumentos
  // da PRIMEIRA oferta (27/04 09h) embora o cliente tivesse confirmado a
  // ÚLTIMA (28/04 12h). Sem diretiva explícita o modelo "vaza" args antigos.
  it("contém diretiva de re-confirmação de argumentos antes de criar_evento (bug #3)", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    const prompt = await buildSystemPrompt(1);
    // A diretiva deve mencionar que os argumentos da tool devem refletir
    // EXATAMENTE o último horário oferecido/confirmado em texto.
    expect(prompt).toMatch(/(últim[oa]|exata|reflet|coincid|bater|mesm[oa])/i);
    expect(prompt).toMatch(/criar_evento/);
  });

  // Regressão bug #2: LLM respondeu "10h indisponível" sem ter chamado
  // verificar_disponibilidade — usou só buscar_proximo_horario (que retorna
  // o primeiro slot) e respondeu com base na ausência da hora exata.
  it("contém diretiva de usar verificar_disponibilidade para horários específicos (bug #2)", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/verificar_disponibilidade/);
    // Deve deixar claro que para horário específico não basta buscar_proximo_horario.
    expect(prompt).toMatch(/(específic[oa]|horário pedido|hora solicitad)/i);
  });

  // Cleanup: criar_agendamento foi removida na sessão de 26/04/2026.
  // O prompt ainda mencionava "criar_agendamento / criar_evento" como se
  // fossem alternativas — confunde o LLM e contradiz a regra "use SEMPRE criar_evento".
  it("não menciona a ferramenta removida criar_agendamento", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    const prompt = await buildSystemPrompt(1);
    expect(prompt).not.toMatch(/criar_agendamento/);
  });

  // Atualizado (Problema dia da semana, 2026-06-20): a regra antiga (Bug #5)
  // PROIBIA o agente de mencionar o dia da semana porque o LLM errava o cálculo
  // de cabeça — mas isso gerava a esquiva robótica "recomendo conferir no seu
  // calendário" que o usuário reportou. Hoje o dia da semana vem PRONTO e correto
  // (tabela de calendário do bloco temporal + campo `dataFormatada` das tools).
  // Nova diretriz: USE o dia da semana, mas SEMPRE a partir de um dado pronto —
  // nunca calcule de cabeça.
  it("instrui a INCLUIR o dia da semana a partir de dado pronto, sem calcular (Problema 2026-06-20)", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    const prompt = await buildSystemPrompt(1);
    // Menciona dia da semana e o campo determinístico que o fornece.
    expect(prompt).toMatch(/dia da semana/i);
    expect(prompt).toMatch(/dataFormatada|tabela|calend[áa]rio/i);
    // Proíbe CALCULAR de cabeça (não proíbe mais mencionar).
    expect(prompt).toMatch(/(NUNCA|não)\s+calcule/i);
    // E NÃO contém mais a esquiva robótica antiga.
    expect(prompt).not.toMatch(/recomendo conferir no seu calend[áa]rio/i);
  });

  // Captura de aniversário (2026-06-28): o agente deve oferecer registrar a data de
  // nascimento ao FINAL de um atendimento bem-sucedido e chamar registrar_aniversario.
  // Alimenta as campanhas de aniversário (BirthdayIntelligentService), que sofriam de
  // escassez de matéria-prima (birthday só era preenchido manualmente via CRM).
  it("instrui a oferecer e registrar o aniversário ao final do atendimento (registrar_aniversario)", async () => {
    mockFindAll.mockResolvedValue(makeSettings());
    const prompt = await buildSystemPrompt(1);
    expect(prompt).toMatch(/registrar_aniversario/);
    expect(prompt).toMatch(/anivers[áa]rio/i);
    // Deve deixar claro que é AO FINAL / atendimento concluído — não no meio do fluxo.
    expect(prompt).toMatch(/(final|conclu[íi])/i);
  });
});

describe("getTemperatureForPersonality", () => {
  it("retorna 0.3 para personalidade atencioso", () => {
    expect(getTemperatureForPersonality("atencioso")).toBe(0.3);
  });

  it("retorna 0.7 para personalidade vendedor", () => {
    expect(getTemperatureForPersonality("vendedor")).toBe(0.7);
  });

  it("retorna 0.5 para personalidade híbrido", () => {
    expect(getTemperatureForPersonality("híbrido")).toBe(0.5);
  });

  it("retorna 0.5 como fallback para personalidade desconhecida", () => {
    expect(getTemperatureForPersonality("desconhecido")).toBe(0.5);
  });
});
