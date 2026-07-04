/**
 * Testes TDD para contextManager (Redis via cacheLayer).
 */

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDel = jest.fn();

jest.mock("../../../libs/cache", () => ({
  cacheLayer: {
    get: mockGet,
    set: mockSet,
    del: mockDel
  }
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("loadContext", () => {
  it("retorna array vazio quando não há chave no Redis", async () => {
    mockGet.mockResolvedValue(null);
    const { loadContext } = await import("../contextManager");
    const result = await loadContext(1, 42);
    expect(result).toEqual([]);
  });

  it("retorna mensagens parseadas do Redis", async () => {
    const messages = [
      { role: "user", content: "Olá" },
      { role: "assistant", content: "Oi! Como posso ajudar?" }
    ];
    mockGet.mockResolvedValue(JSON.stringify(messages));
    const { loadContext } = await import("../contextManager");
    const result = await loadContext(1, 42);
    expect(result).toEqual(messages);
  });

  it("retorna array vazio em caso de erro no Redis", async () => {
    mockGet.mockRejectedValue(new Error("Redis connection refused"));
    const { loadContext } = await import("../contextManager");
    const result = await loadContext(1, 42);
    expect(result).toEqual([]);
  });

  it("usa chave correta: agent:ctx:{companyId}:{ticketId}", async () => {
    mockGet.mockResolvedValue(null);
    const { loadContext } = await import("../contextManager");
    await loadContext(7, 123);
    expect(mockGet).toHaveBeenCalledWith("agent:ctx:7:123");
  });
});

describe("saveContext", () => {
  it("salva mensagens no Redis com TTL de 3600 segundos", async () => {
    mockSet.mockResolvedValue("OK");
    const { saveContext } = await import("../contextManager");
    const messages = [{ role: "user" as const, content: "teste" }];
    await saveContext(1, 42, messages);
    expect(mockSet).toHaveBeenCalledWith(
      "agent:ctx:1:42",
      JSON.stringify(messages),
      "EX",
      3600
    );
  });

  it("trunca para maxMessages mantendo as mais recentes", async () => {
    mockSet.mockResolvedValue("OK");
    const { saveContext } = await import("../contextManager");
    const messages = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`
    }));
    await saveContext(1, 42, messages, 20);
    const saved = JSON.parse(mockSet.mock.calls[0][1]);
    expect(saved).toHaveLength(20);
    expect(saved[0].content).toBe("msg 5");
    expect(saved[19].content).toBe("msg 24");
  });

  it("não lança erro quando Redis falha", async () => {
    mockSet.mockRejectedValue(new Error("Redis down"));
    const { saveContext } = await import("../contextManager");
    await expect(
      saveContext(1, 42, [{ role: "user", content: "x" }])
    ).resolves.toBeUndefined();
  });
});

describe("clearContext", () => {
  it("deleta a chave correta do Redis", async () => {
    mockDel.mockResolvedValue(1);
    const { clearContext } = await import("../contextManager");
    await clearContext(3, 99);
    expect(mockDel).toHaveBeenCalledWith("agent:ctx:3:99");
  });

  it("não lança erro quando Redis falha ao deletar", async () => {
    mockDel.mockRejectedValue(new Error("Redis down"));
    const { clearContext } = await import("../contextManager");
    await expect(clearContext(3, 99)).resolves.toBeUndefined();
  });
});
