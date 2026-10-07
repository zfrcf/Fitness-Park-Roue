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

describe("analyserMessageAutomatique", () => {
  it("résume un message de correction avec journal de compilation", async () => {
    const { analyserMessageAutomatique } = await import("./utils");
    const t =
      "La compilation a échoué. Corrige le projet. Journal :\n\n```text\n> Task :compileJava\n/tmp/x/espaces/a/src/main/java/A.java:20: error: ')' expected\n    x(\n2 errors\n> Task :compileJava FAILED\n```";
    const r = analyserMessageAutomatique("u1", t);
    expect(r?.type).toBe("correction");
    expect(r?.nbErreurs).toBe(2);
    expect(r?.erreurs[0]).toBe("src/main/java/A.java:20: error: ')' expected");
  });
  it("ignore un message ordinaire, reconnaît une relance de tâche", async () => {
    const { analyserMessageAutomatique } = await import("./utils");
    expect(analyserMessageAutomatique("u2", "Ajoute une commande /ping")).toBeNull();
    expect(analyserMessageAutomatique("tache-abc", "Ta réponse ne contenait aucun fichier modifié.")?.type).toBe("relance");
  });
});
