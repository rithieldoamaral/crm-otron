/**
 * Teste estrutural das rotas de governança de tokens.
 *
 * Por que existe: o dado deste módulo é comercialmente sensível — consumo e
 * custo por empresa, e a margem da plataforma. Uma rota adicionada aqui SEM
 * `isSuper` vazaria isso para qualquer JWT válido, e o vazamento seria
 * silencioso (nada quebra, ninguém percebe).
 *
 * Este teste falha no momento em que alguém acrescentar uma rota sem o gate.
 * É a mesma classe de proteção que a auditoria de 2026-07-27 mostrou faltar
 * nos relatórios (CLAUDE.md XV.1 — esconder no frontend não é proteger).
 */

import tokenGovernanceRoutes from "../tokenGovernanceRoutes";

jest.mock("../../middleware/isAuth", () => ({
  __esModule: true,
  default: function isAuth() {}
}));

jest.mock("../../middleware/isSuper", () => ({
  __esModule: true,
  default: function isSuper() {}
}));

jest.mock("../../controllers/TokenGovernanceController", () => ({
  overview: jest.fn(),
  byModel: jest.fn(),
  series: jest.fn(),
  credits: jest.fn(),
  addCredit: jest.fn(),
  listPrices: jest.fn(),
  upsertPrice: jest.fn()
}));

/** Nomes das funções de middleware registradas em cada camada da rota. */
const middlewareNamesOf = (layer: any): string[] =>
  (layer.route?.stack || []).map((s: any) => s.name);

const routeLayers = (): any[] =>
  (tokenGovernanceRoutes as any).stack.filter((l: any) => l.route);

describe("tokenGovernanceRoutes", () => {
  it("registra ao menos as sete rotas do módulo", () => {
    expect(routeLayers().length).toBeGreaterThanOrEqual(7);
  });

  it("TODA rota exige isSuper — sem exceção", () => {
    const semGate = routeLayers()
      .filter(l => !middlewareNamesOf(l).includes("isSuper"))
      .map(l => `${Object.keys(l.route.methods).join(",")} ${l.route.path}`);

    expect(semGate).toEqual([]);
  });

  it("TODA rota exige autenticação antes do gate de super", () => {
    const semAuth = routeLayers()
      .filter(l => !middlewareNamesOf(l).includes("isAuth"))
      .map(l => l.route.path);

    expect(semAuth).toEqual([]);
  });

  it("isAuth vem ANTES de isSuper (isSuper lê req.user preenchido por isAuth)", () => {
    routeLayers().forEach(l => {
      const nomes = middlewareNamesOf(l);
      expect(nomes.indexOf("isAuth")).toBeLessThan(nomes.indexOf("isSuper"));
    });
  });

  it("expõe as rotas esperadas pelo painel", () => {
    const paths = routeLayers().map(l => l.route.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "/token-governance/overview",
        "/token-governance/by-model",
        "/token-governance/series",
        "/token-governance/credits/:companyId",
        "/token-governance/prices"
      ])
    );
  });
});
