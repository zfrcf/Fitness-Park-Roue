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
  it("détecte « jusqu'à » même sans verbe déclencheur", () => {
    for (const t of [
      "Fais tourner le projet jusqu'à ce que le jar compile",
      "Crée un mod et teste-le jusqu'à obtenir un jar",
      "continue jusqu'à.",
    ]) expect(detecterTacheLongue(t), t).toBe(true);
  });
  it("ne confond pas avec « jusqu'aujourd'hui » / « jusqu'alors »", () => {
    expect(detecterTacheLongue("Donne l'historique jusqu'aujourd'hui")).toBe(false);
    expect(detecterTacheLongue("Tout allait bien jusqu'alors, explique")).toBe(false);
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
