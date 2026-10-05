import { beforeAll, describe, expect, it } from "vitest";
import type { MessageUI } from "@/lib/chat/types";
import { ajouterMessage, enregistrerMessages, lireConversation, listerConversations, renommerConversation, supprimerConversation, versMarkdown } from "./conversations";
import { ecrireReglages, lireReglages } from "./reglages";

const u = (id: string, t: string): MessageUI => ({ id, role: "user", parts: [{ type: "text", text: t }] });
const a = (id: string, t: string): MessageUI => ({ id, role: "assistant", parts: [{ type: "text", text: t }], metadata: { fournisseur: "Groq", modele: "m", usage: { entree: 1, sortie: 2, total: 3 } } });

beforeAll(() => {
  delete process.env.DATABASE_URL;
});

describe("conversations (PGlite en mémoire)", () => {
  it("enregistre, liste, lit, recherche, renomme, supprime", async () => {
    await enregistrerMessages("c1", [u("m1", "Comment ouvrir une salle de sport à Bordeaux ?"), a("m2", "Voici les étapes…")], "1-groq");
    await enregistrerMessages("c2", [u("m3", "Recette de crêpes")]);
    const liste = await listerConversations();
    expect(liste.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(liste[1].titre).toBe("Comment ouvrir une salle de sport à Bordeaux ?");
    expect(liste[1].nbMessages).toBe(2);

    const lu = await lireConversation("c1");
    expect(lu?.messages).toHaveLength(2);
    expect(lu?.messages[1].metadata?.fournisseur).toBe("Groq");

    const rech = await listerConversations("bordeaux");
    expect(rech.map((c) => c.id)).toEqual(["c1"]);
    expect(rech[0].extrait).toMatch(/Bordeaux/);
    expect(await listerConversations("étapes")).toHaveLength(1);
    expect(await listerConversations("zzz")).toHaveLength(0);

    await ajouterMessage("c2", a("m4", "Mélangez farine, œufs et lait."));
    expect((await lireConversation("c2"))?.messages).toHaveLength(2);

    expect(await renommerConversation("c2", "Crêpes")).toBe(true);
    expect((await lireConversation("c2"))?.conversation.titre).toBe("Crêpes");

    const md = versMarkdown((await lireConversation("c1"))!.conversation, lu!.messages);
    expect(md).toContain("# Comment ouvrir");
    expect(md).toContain("Groq · m");

    expect(await supprimerConversation("c1")).toBe(true);
    expect(await lireConversation("c1")).toBeNull();
    expect(await supprimerConversation("c1")).toBe(false);
  });

  it("ignore les parties avant un marqueur de régénération", async () => {
    const m: MessageUI = {
      id: "r1",
      role: "assistant",
      parts: [{ type: "text", text: "partiel" }, { type: "data-regeneration", data: { raison: "x" } }, { type: "text", text: "final" }],
    };
    await enregistrerMessages("c3", [u("q", "?"), m]);
    const lu = await lireConversation("c3");
    expect(lu?.messages[1].parts).toEqual([{ type: "text", text: "final" }]);
  });

  it("#23 : garde les pastilles pages/recherches émises avant un marqueur de régénération", async () => {
    const m: MessageUI = {
      id: "r2",
      role: "assistant",
      parts: [
        { type: "data-page-lue", id: "p1", data: { url: "https://x.test", titre: "X", source: "direct", caracteres: 10, ok: true, contenu: "txt" } },
        { type: "text", text: "tentative dégénérée" },
        { type: "data-regeneration", data: { raison: "x" } },
        { type: "text", text: "réponse finale" },
      ],
    } as unknown as MessageUI;
    await enregistrerMessages("c4", [u("q", "?"), m]);
    const lu = await lireConversation("c4");
    const parts = lu?.messages[1].parts ?? [];
    expect(parts.some((p) => p.type === "data-page-lue")).toBe(true); // pastille conservée
    expect(parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text)).toEqual(["réponse finale"]); // texte dégénéré jeté
  });

  it("réglages persistants et bornés", async () => {
    const d = await lireReglages();
    expect(d.temperature).toBe(0.7);
    const r = await ecrireReglages({ temperature: 5, maxTokens: 10, systeme: "Bonjour" });
    expect(r.temperature).toBe(2);
    expect(r.maxTokens).toBe(64);
    expect((await lireReglages()).systeme).toBe("Bonjour");
  });
});
