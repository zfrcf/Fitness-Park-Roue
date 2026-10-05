import { describe, expect, it } from "vitest";
import { detecterTacheLongue } from "./detecter";

describe("detecterTacheLongue", () => {
  it("repère les demandes de travail long", () => {
    for (const t of [
      "Travaille jusqu'à ce que le jar soit prêt",
      "Corrige le mod en boucle jusqu'au build vert",
      "compile jusqu'à ce que ça marche",
      "Recommence jusqu'à ce que les tests passent",
      "Ne t'arrête pas tant que ce n'est pas fini",
      "travaille toute la nuit sur le projet",
    ]) expect(detecterTacheLongue(t), t).toBe(true);
  });
  it("ignore les messages normaux", () => {
    for (const t of [
      "Explique-moi les mixins",
      "Crée un mod simple",
      "Merci",
      "Quelle est la dernière version de Minecraft ?",
      "",
    ]) expect(detecterTacheLongue(t), t).toBe(false);
  });
});
