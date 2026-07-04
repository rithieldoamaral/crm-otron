/**
 * Testes TDD para a tool consultarUsuarios.
 */

jest.mock("../../../../models/User");

import { consultarUsuarios } from "../../tools/consultarUsuarios";
import User from "../../../../models/User";

describe("consultarUsuarios", () => {
  const companyId = 1;

  beforeEach(() => jest.clearAllMocks());

  it("retorna lista de usuários ativos da empresa", async () => {
    (User.findAll as jest.Mock).mockResolvedValue([
      { id: 1, name: "Carla Atendente", email: "carla@pet.com", profile: "user" },
      { id: 2, name: "Bruno Supervisor", email: "bruno@pet.com", profile: "admin" }
    ]);

    const result = await consultarUsuarios({}, companyId);

    expect(User.findAll).toHaveBeenCalledTimes(1);
    const callArgs = (User.findAll as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ companyId });
    expect(result.usuarios).toHaveLength(2);
    expect(result.usuarios[0]).toMatchObject({ id: 1, nome: "Carla Atendente" });
    expect(result.total).toBe(2);
  });

  it("não expõe senha ou token nos dados retornados", async () => {
    (User.findAll as jest.Mock).mockResolvedValue([
      { id: 1, name: "Carla", email: "carla@pet.com", profile: "user", passwordHash: "secret123", tokenVersion: 5 }
    ]);

    const result = await consultarUsuarios({}, companyId);

    expect(result.usuarios[0]).not.toHaveProperty("passwordHash");
    expect(result.usuarios[0]).not.toHaveProperty("tokenVersion");
  });

  it("retorna lista vazia quando empresa não tem usuários", async () => {
    (User.findAll as jest.Mock).mockResolvedValue([]);

    const result = await consultarUsuarios({}, companyId);

    expect(result.usuarios).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("filtra por perfil quando informado", async () => {
    (User.findAll as jest.Mock).mockResolvedValue([
      { id: 2, name: "Admin", email: "admin@pet.com", profile: "admin" }
    ]);

    await consultarUsuarios({ perfil: "admin" }, companyId);

    const callArgs = (User.findAll as jest.Mock).mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ profile: "admin" });
  });

  // ── Validação de enum (defesa contra alucinação do LLM) ───────────────────

  describe("validação de perfil", () => {
    it.each([
      ["administrador"], // português completo
      ["operator"],      // não está no enum
      ["root"],          // privilégio inexistente
      ["ADMIN"],         // case incorreto (queremos lowercase para casar com banco)
    ])('rejeita perfil inválido "%s" sem chamar User.findAll', async (perfil) => {
      const result = await consultarUsuarios({ perfil }, companyId);

      expect(result.usuarios).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.erro).toMatch(/perfil|admin|user/i);
      expect(User.findAll).not.toHaveBeenCalled();
    });

    it.each([["admin"], ["user"]])('aceita perfil válido "%s"', async (perfil) => {
      (User.findAll as jest.Mock).mockResolvedValue([]);

      const result = await consultarUsuarios({ perfil }, companyId);

      expect(result.erro).toBeUndefined();
      expect(User.findAll).toHaveBeenCalledTimes(1);
    });
  });
});
