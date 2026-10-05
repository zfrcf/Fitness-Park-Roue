import { describe, expect, it } from "vitest";
import { messageErreurLisible } from "./utils";

describe("messageErreurLisible (#36)", () => {
  it("extrait le texte d'un corps JSON", () => {
    expect(messageErreurLisible({ message: '{"erreur":"Tous les fournisseurs sont épuisés."}' })).toBe("Tous les fournisseurs sont épuisés.");
    expect(messageErreurLisible({ message: '{"error":"boom"}' })).toBe("boom");
  });
  it("garde un message texte brut et gère l'absence", () => {
    expect(messageErreurLisible({ message: "Panne réseau" })).toBe("Panne réseau");
    expect(messageErreurLisible(null)).toMatch(/erreur est survenue/i);
    expect(messageErreurLisible({ message: "{json invalide" })).toBe("{json invalide");
  });
});
