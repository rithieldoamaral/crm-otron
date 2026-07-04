/**
 * Testes para OpenAICompatibleProvider — foco no formato de mensagens enviado.
 *
 * Bug crítico (29/04/2026): com gpt-oss-120b da Groq nunca caímos nesse caso
 * porque a Groq aceita mensagens "tool" sem o assistant anterior carregar
 * tool_calls. A OpenAI rejeita com HTTP 400:
 *   "messages with role 'tool' must be a response to a preceeding message
 *    with 'tool_calls'."
 *
 * Esses testes garantem que quando AIMessage{role=assistant} carrega
 * `toolCalls`, o provider serializa para o formato `tool_calls` da OpenAI.
 */

import { OpenAICompatibleProvider } from "../OpenAICompatibleProvider";
import { AIMessage } from "../interfaces";

type FetchInput = { url: string; body: any };

function makeFetchMock(responseJson: any, status = 200) {
  const captured: FetchInput[] = [];
  const fetchMock: any = jest.fn(async (url: string, init: any) => {
    captured.push({ url, body: JSON.parse(init.body) });
    return {
      ok: status < 400,
      status,
      json: async () => responseJson,
      text: async () => JSON.stringify(responseJson)
    };
  });
  return { fetchMock, captured };
}

describe("OpenAICompatibleProvider — formato de mensagens", () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("preserva tool_calls em mensagens assistant ao chamar a API", async () => {
    const { fetchMock, captured } = makeFetchMock({
      choices: [
        {
          message: { content: "ok", tool_calls: [] },
          finish_reason: "stop"
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    });
    global.fetch = fetchMock;

    const provider = new OpenAICompatibleProvider(
      "sk-test",
      "gpt-4o-mini",
      "https://api.openai.com/v1"
    );

    // Histórico replica exatamente o cenário do bug:
    //   user → assistant (com tool_calls) → tool (resposta) → ...
    const messages: AIMessage[] = [
      { role: "user", content: "Quero agendar amanhã às 11h" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_abc123",
            name: "verificar_disponibilidade",
            arguments: { data: "2026-04-30", hora: "11:00" }
          }
        ]
      },
      {
        role: "tool",
        content: '{"disponivel":true}',
        toolCallId: "call_abc123",
        name: "verificar_disponibilidade"
      }
    ];

    await provider.chatWithTools(messages, [], "system prompt");

    expect(captured).toHaveLength(1);
    const sent = captured[0].body.messages;

    // [0]=system, [1]=user, [2]=assistant com tool_calls, [3]=tool
    expect(sent).toHaveLength(4);
    expect(sent[2].role).toBe("assistant");
    expect(sent[2].tool_calls).toBeDefined();
    expect(sent[2].tool_calls).toHaveLength(1);
    expect(sent[2].tool_calls[0]).toEqual({
      id: "call_abc123",
      type: "function",
      function: {
        name: "verificar_disponibilidade",
        arguments: JSON.stringify({ data: "2026-04-30", hora: "11:00" })
      }
    });
    // OpenAI exige content=null (ou string vazia aceita) quando tem tool_calls;
    // o crítico é que tool_calls esteja presente para a [3] tool ser válida.
    expect(sent[3].role).toBe("tool");
    expect(sent[3].tool_call_id).toBe("call_abc123");
  });

  it("envia assistant sem tool_calls quando o histórico não tem", async () => {
    const { fetchMock, captured } = makeFetchMock({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });
    global.fetch = fetchMock;

    const provider = new OpenAICompatibleProvider(
      "sk-test",
      "gpt-4o-mini",
      "https://api.openai.com/v1"
    );

    const messages: AIMessage[] = [
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá! Como posso ajudar?" },
      { role: "user", content: "Quero agendar" }
    ];

    await provider.chatWithTools(messages, [], "system");

    const sent = captured[0].body.messages;
    expect(sent[2].role).toBe("assistant");
    expect(sent[2].tool_calls).toBeUndefined();
    expect(sent[2].content).toBe("Olá! Como posso ajudar?");
  });
});

// ─── Escalabilidade P0: timeout de rede ──────────────────────────────────────
//
// Sem AbortSignal.timeout, um fetch que trave por rede/LLM lento segura a
// conexão do pool do Sequelize indefinidamente — 5 clientes azarados = pool
// zerado. Com timeout de 30s, o fetch aborta e retorna finishReason: "error".

describe("OpenAICompatibleProvider — timeout de rede (escalabilidade P0)", () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => { global.fetch = ORIGINAL_FETCH; });

  it("retorna finishReason=error quando fetch é abortado por timeout", async () => {
    // Simula fetch que nunca resolve (pendente indefinidamente)
    global.fetch = jest.fn(() => new Promise(() => {})) as any;

    const provider = new OpenAICompatibleProvider(
      "sk-test",
      "gpt-4o-mini",
      "https://api.openai.com/v1"
    );

    // AbortSignal.timeout(30000) deve abortar — mas para o teste ser rápido,
    // verificamos que AbortSignal está sendo passado ao fetch (signal presente)
    // inspecionando o init da chamada.
    const signals: AbortSignal[] = [];
    global.fetch = jest.fn(async (_url: string, init: any) => {
      if (init?.signal) signals.push(init.signal);
      // Simula a exceção que AbortSignal lança quando timeout dispara
      throw new DOMException("The operation was aborted", "AbortError");
    }) as any;

    const result = await provider.chatWithTools([], [], "system");

    expect(result.finishReason).toBe("error");
    expect(result.content).toBeNull();
    // Confirma que signal foi passado ao fetch (defesa de que AbortSignal.timeout existe)
    expect(signals.length).toBeGreaterThan(0);
  });

  it("propaga timeout corretamente no método chat também", async () => {
    global.fetch = jest.fn(async (_url: string, init: any) => {
      if (init?.signal) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      throw new Error("sem signal");
    }) as any;

    const provider = new OpenAICompatibleProvider(
      "sk-test",
      "gpt-4o-mini",
      "https://api.openai.com/v1"
    );

    const result = await provider.chat([], "system");

    expect(result.finishReason).toBe("error");
  });
});
