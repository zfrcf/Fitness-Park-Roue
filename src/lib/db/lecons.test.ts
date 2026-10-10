import { describe, expect, it } from "vitest";
import { ajouterLecon, compterPoints, leconsPourPrompt, retirerLecon, retoursDeConversation } from "./lecons";

describe("mémoire de leçons par compte (base)", () => {
  it("compte les points et isole les comptes", async () => {
    await ajouterLecon({ proprietaire: "u-A", type: "bon", texte: "bonne structure", conversationId: "cA", messageId: "m1" });
    await ajouterLecon({ proprietaire: "u-A", type: "mauvais", texte: "API inventée", conversationId: "cA", messageId: "m2" });
    await ajouterLecon({ proprietaire: "u-B", type: "bon", texte: "chez B", conversationId: "cB", messageId: "mb" });
    expect(await compterPoints("u-A")).toEqual({ bons: 1, mauvais: 1 });
    expect(await compterPoints("u-B")).toEqual({ bons: 1, mauvais: 0 });
    const leconsA = await leconsPourPrompt("u-A");
    expect(leconsA.map((l) => l.texte)).toEqual(["bonne structure", "API inventée"]);
    expect(leconsA.map((l) => l.texte)).not.toContain("chez B");
  });

  it("un seul vote par message (le dernier remplace), et l'annulation retire", async () => {
    await ajouterLecon({ proprietaire: "u-C", type: "bon", texte: "v1", conversationId: "cC", messageId: "m" });
    await ajouterLecon({ proprietaire: "u-C", type: "mauvais", texte: "v2", conversationId: "cC", messageId: "m" });
    expect(await compterPoints("u-C")).toEqual({ bons: 0, mauvais: 1 });
    expect(await retoursDeConversation("u-C", "cC")).toEqual({ m: "mauvais" });
    await retirerLecon("u-C", "m");
    expect(await compterPoints("u-C")).toEqual({ bons: 0, mauvais: 0 });
  });
});
