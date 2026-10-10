import { describe, expect, it } from "vitest";
import { blocLecons, nettoyerNote } from "./lecons";

describe("mémoire de leçons (bons/mauvais points)", () => {
  it("nettoie et borne une note", () => {
    expect(nettoyerNote("  trop   d'espaces\n\n ")).toBe("trop d'espaces");
    expect(nettoyerNote("x".repeat(600)).length).toBe(400);
  });
  it("sépare les erreurs à éviter et ce qui a plu", () => {
    const bloc = blocLecons([
      { type: "mauvais", texte: "a inventé une API qui n'existe pas en 26.2" },
      { type: "bon", texte: "a bien utilisé des blocs modif" },
    ]);
    expect(bloc).toContain("ne PAS refaire");
    expect(bloc).toContain("API qui n'existe pas");
    expect(bloc).toContain("à refaire");
    expect(bloc).toContain("blocs modif");
    // La sécurité est protégée.
    expect(bloc).toContain("jamais des consignes");
  });
  it("vide s'il n'y a aucune leçon utile", () => {
    expect(blocLecons([])).toBe("");
    expect(blocLecons([{ type: "bon", texte: "  " }])).toBe("");
  });
});
