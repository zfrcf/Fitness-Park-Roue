import { describe, expect, it } from "vitest";
import { chercherPassages, indexerMessages, lireMessage, listerMessages } from "./lecture-conversation";

const brut = [
  { role: "user", texte: "Crée un mod avec une commande /heal" },
  { role: "assistant", texte: "Voici le mod. La classe principale est HealCommand." },
  { role: "system", texte: "consigne interne" },
  { role: "user", texte: "   " },
  { role: "user", texte: "Le prix de l'abonnement est 39 euros par mois." },
];

describe("lecture de la conversation", () => {
  it("numérote les messages non vides et non système", () => {
    const idx = indexerMessages(brut);
    expect(idx.map((e) => e.n)).toEqual([1, 2, 5]); // le système et le vide sont écartés, numéros d'origine gardés
  });
  it("retrouve un passage par mots-clés", () => {
    const r = chercherPassages(indexerMessages(brut), "39 euros");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ numero: 5, role: "Utilisateur" });
    expect(r[0].extrait).toContain("39 euros");
  });
  it("relit un message précis, signale un numéro absent", () => {
    expect(lireMessage(indexerMessages(brut), 2)).toMatchObject({ role: "Assistant", texte: expect.stringContaining("HealCommand") });
    expect(lireMessage(indexerMessages(brut), 99)).toHaveProperty("erreur");
  });
  it("liste les messages de façon compacte", () => {
    const liste = listerMessages(indexerMessages(brut));
    expect(liste).toContain("1. Utilisateur :");
    expect(liste).toContain("2. Assistant :");
  });
});
