import { getProfessionalColor, PROFESSIONAL_COLOR_PALETTE } from "./professionalColors";

describe("getProfessionalColor", () => {
  it("retorna uma cor da paleta fixa", () => {
    const color = getProfessionalColor(1);
    expect(PROFESSIONAL_COLOR_PALETTE).toContain(color);
  });

  it("é determinístico: mesmo id sempre retorna a mesma cor", () => {
    expect(getProfessionalColor(42)).toBe(getProfessionalColor(42));
    expect(getProfessionalColor(7)).toBe(getProfessionalColor(7));
  });

  it("ids consecutivos mapeiam para cores diferentes (evita colisão visual)", () => {
    const c1 = getProfessionalColor(1);
    const c2 = getProfessionalColor(2);
    const c3 = getProfessionalColor(3);
    expect(c1).not.toBe(c2);
    expect(c2).not.toBe(c3);
  });

  it("aceita id null/undefined retornando cor neutra da paleta", () => {
    const color = getProfessionalColor(null);
    expect(PROFESSIONAL_COLOR_PALETTE).toContain(color);
    expect(getProfessionalColor(undefined)).toBe(color);
  });

  it("aceita string numérica (ex: vinda de query param)", () => {
    expect(getProfessionalColor("5")).toBe(getProfessionalColor(5));
  });

  it("paleta tem pelo menos 8 cores distintas", () => {
    const unique = new Set(PROFESSIONAL_COLOR_PALETTE);
    expect(unique.size).toBeGreaterThanOrEqual(8);
  });

  it("todas as cores da paleta são hex válidos", () => {
    PROFESSIONAL_COLOR_PALETTE.forEach((c) => {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });
});
