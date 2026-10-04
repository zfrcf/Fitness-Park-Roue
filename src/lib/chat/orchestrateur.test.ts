import { createUIMessageStream, type UIMessageChunk } from "ai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getKV, type KV } from "@/lib/kv";
import { creerModele } from "@/lib/fournisseurs/client";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { demarrerFauxServeur, type FauxServeur, type Scenario } from "./faux-serveur";
import { executerChat, fusionnerContinuation, type DepsOrchestrateur } from "./orchestrateur";
import { REGLAGES_DEFAUT, type MessageUI, type MetaMessage } from "./types";

let serveur: FauxServeur;
let kv: KV;

beforeAll(async () => {
  serveur = await demarrerFauxServeur();
  kv = getKV(); // mémoire (pas de variable Upstash en test)
});
afterAll(() => serveur.fermer());
beforeEach(async () => {
  for (const k of await kv.keys("")) await kv.del(k);
  serveur.appels.length = 0;
});

function fournisseur(nom: string, scenario: Scenario | string, extra: Partial<Fournisseur> = {}): Fournisseur {
  return {
    id: `${nom.toLowerCase()}`,
    rang: 1,
    nom,
    baseUrl: serveur.url,
    apiKey: scenario,
    modele: "faux",
    contexte: 32_000,
    payant: false,
    famille: "generique",
    ...extra,
  };
}

interface Sortie {
  chunks: UIMessageChunk[];
  texte: string;
  meta: MetaMessage;
  erreur?: string;
  bascules: Array<{ de: string; vers: string; continuation: boolean }>;
  regenerations: number;
}

async function executer(liste: Fournisseur[], opts: Partial<DepsOrchestrateur> = {}, question = "Bonjour", conversationId = "conv-1"): Promise<Sortie> {
  const deps: DepsOrchestrateur = { fournisseurs: liste, kv, creerModele, delaiInactiviteMs: 400, ...opts };
  const chunks: UIMessageChunk[] = [];
  const flux = createUIMessageStream<MessageUI>({
    execute: async ({ writer }) => {
      await executerChat(deps, { writer, messages: [{ role: "user", content: question }], reglages: REGLAGES_DEFAUT, conversationId });
    },
    onError: (e) => String(e),
  });
  const lecteur = flux.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    chunks.push(value as UIMessageChunk);
  }
  // Reconstitue le texte visible : seules les parties après le dernier marqueur de régénération comptent.
  const parts: Array<{ type: string; texte?: string }> = [];
  let meta: MetaMessage = {};
  let erreur: string | undefined;
  for (const c of chunks) {
    if (c.type === "text-start") parts.push({ type: "text", texte: "" });
    else if (c.type === "text-delta") parts[parts.length - 1].texte += c.delta;
    else if (c.type === "data-regeneration") parts.push({ type: "regeneration" });
    else if (c.type === "message-metadata") meta = { ...meta, ...(c.messageMetadata as MetaMessage) };
    else if (c.type === "error") erreur = c.errorText;
  }
  const dernierMarqueur = parts.map((p) => p.type).lastIndexOf("regeneration");
  const texte = parts
    .slice(dernierMarqueur + 1)
    .map((p) => p.texte ?? "")
    .join("");
  const bascules = chunks.filter((c) => c.type === "data-bascule").map((c) => (c as { data: Sortie["bascules"][number] }).data);
  return { chunks, texte, meta, erreur, bascules, regenerations: parts.filter((p) => p.type === "regeneration").length };
}

describe("fusionnerContinuation", () => {
  it("supprime le chevauchement", () => {
    expect(fusionnerContinuation("Bonjour, voici le début de ", "le début de la suite")).toBe("la suite");
    expect(fusionnerContinuation("abc", "def")).toBe("def");
    expect(fusionnerContinuation("", "x")).toBe("x");
  });
});

describe("rotation des fournisseurs", () => {
  it("répond avec le premier disponible et mémorise le fournisseur de la conversation", async () => {
    const r = await executer([fournisseur("A", "ok"), fournisseur("B", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.meta.fournisseur).toBe("A");
    expect(r.meta.usage).toEqual({ entree: 30, sortie: 7, total: 37 });
    expect(r.meta.cout).toBeCloseTo(0.001);
    expect(await kv.get("conv:fournisseur:conv-1")).toBe("a");
    expect(serveur.appels).toHaveLength(1);
  });

  it("bascule sur 429 avant tout texte et mémorise l'heure de réessai", async () => {
    const t0 = Date.now();
    const r = await executer([fournisseur("A", "429"), fournisseur("B", "ok")]);
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.meta.fournisseur).toBe("B");
    expect(r.bascules).toEqual([{ de: "A", vers: "B", raison: "quota ou limite de débit atteint", continuation: false }]);
    const etatA = await kv.get<{ statut: string; reessaiA: number }>("fournisseur:etat:a");
    expect(etatA?.statut).toBe("epuise");
    expect(etatA!.reessaiA - t0).toBeGreaterThanOrEqual(119_000);
    expect(etatA!.reessaiA - t0).toBeLessThanOrEqual(121_000);
  });

  it("bascule sur 402, 401, 500 et quota journalier", async () => {
    const r = await executer([fournisseur("A", "402"), fournisseur("B", "401"), fournisseur("C", "500"), fournisseur("D", "429-quotidien"), fournisseur("E", "cf-3036"), fournisseur("F", "ok")]);
    expect(r.meta.fournisseur).toBe("F");
    expect(r.bascules.map((b) => b.de)).toEqual(["A", "B", "C", "D", "E"]);
    const minuit = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
    expect((await kv.get<{ reessaiA: number }>("fournisseur:etat:d"))?.reessaiA).toBe(minuit);
    expect((await kv.get<{ reessaiA: number }>("fournisseur:etat:e"))?.reessaiA).toBe(minuit);
    expect((await kv.get<{ statut: string }>("fournisseur:etat:a"))?.statut).toBe("epuise");
    expect((await kv.get<{ statut: string }>("fournisseur:etat:c"))?.statut).toBe("erreur");
  });

  it("conserve le texte affiché en cas de coupure en plein flux et fait continuer le suivant", async () => {
    const r = await executer([fournisseur("A", "coupe-flux"), fournisseur("B", "ok-continue")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Bonjour, voici le début de la réponse complète.");
    expect(r.bascules).toEqual([{ de: "A", vers: "B", raison: "erreur 502", continuation: true }]);
    expect(r.regenerations).toBe(0);
    // Le second appel contient bien l'instruction de reprise et le texte déjà émis.
    const second = serveur.appels[1].corps.messages as Array<{ role: string; content: string }>;
    expect(second.at(-2)).toEqual({ role: "assistant", content: "Bonjour, voici le début de " });
    expect(second.at(-1)?.content).toMatch(/Reprends EXACTEMENT/);
    expect(r.meta.fournisseur).toBe("B");
  });

  it("gère une coupure brutale de la connexion", async () => {
    const r = await executer([fournisseur("A", "coupe-socket"), fournisseur("B", "ok-continue")]);
    expect(r.texte).toBe("Première partie avant la coupurela réponse complète.");
    expect(r.bascules[0]).toMatchObject({ de: "A", continuation: true });
  });

  it("régénère entièrement si la reprise échoue", async () => {
    const r = await executer([fournisseur("A", "coupe-flux"), fournisseur("B", "500"), fournisseur("C", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.regenerations).toBe(1);
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.bascules.map((b) => [b.de, b.continuation])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(r.chunks.some((c) => c.type === "data-regeneration")).toBe(true);
  });

  it("bascule quand un fournisseur reste muet (chien de garde)", async () => {
    const r = await executer([fournisseur("A", "muet"), fournisseur("B", "ok")]);
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.bascules[0].de).toBe("A");
    expect((await kv.get<{ raison: string }>("fournisseur:etat:a"))?.raison).toMatch(/aucune donnée/);
  });

  it("signale clairement quand tout est épuisé, avec l'heure de réessai", async () => {
    const r = await executer([fournisseur("A", "429"), fournisseur("B", "402")]);
    expect(r.erreur).toMatch(/Tous les fournisseurs sont épuisés/);
    expect(r.erreur).toMatch(/réessai possible vers \d{2}:\d{2} \(A\)/);
    expect(r.chunks.some((c) => c.type === "data-tous-epuises")).toBe(true);
  });

  it("ignore les fournisseurs marqués épuisés et y revient une fois l'heure passée", async () => {
    await kv.set("fournisseur:etat:a", { statut: "epuise", reessaiA: Date.now() + 60_000, majA: Date.now() });
    const r1 = await executer([fournisseur("A", "ok"), fournisseur("B", "ok")], {}, "Bonjour", "conv-x");
    expect(r1.meta.fournisseur).toBe("B");
    await kv.set("fournisseur:etat:a", { statut: "epuise", reessaiA: Date.now() - 1, majA: Date.now() });
    const r2 = await executer([fournisseur("A", "ok"), fournisseur("B", "ok")], {}, "Bonjour", "conv-y");
    expect(r2.meta.fournisseur).toBe("A");
  });

  it("reste sur le fournisseur de la conversation tant qu'il répond", async () => {
    await kv.set("conv:fournisseur:conv-s", "b");
    const r = await executer([fournisseur("A", "ok"), fournisseur("B", "ok")], {}, "Bonjour", "conv-s");
    expect(r.meta.fournisseur).toBe("B");
  });

  it("n'utilise un fournisseur payant que si autorisé, et enregistre sa dépense", async () => {
    const payant = fournisseur("P", "ok", { payant: true, prixEntree: 1, prixSortie: 2 });
    const r1 = await executer([fournisseur("A", "429"), payant]);
    expect(r1.erreur).toMatch(/épuisés/);
    const depenses: Array<{ id: string; usage: { entree: number; sortie: number }; cout?: number }> = [];
    const r2 = await executer(
      [fournisseur("A", "429"), payant],
      { autoriserPayant: async () => true, enregistrerDepense: async (f, usage, cout) => void depenses.push({ id: f.id, usage, cout }) },
      "Bonjour",
      "conv-p",
    );
    expect(r2.meta.fournisseur).toBe("P");
    expect(depenses).toEqual([{ id: "p", usage: { entree: 30, sortie: 7, total: 37 }, cout: 0.001 }]);
  });

  it("résume les anciens messages quand le contexte du suivant est plus court", async () => {
    const deps: Partial<DepsOrchestrateur> = {};
    const petit = fournisseur("Petit", "ok", { contexte: 1200 });
    const long = "mot ".repeat(300);
    const chunks: UIMessageChunk[] = [];
    const flux = createUIMessageStream<MessageUI>({
      execute: async ({ writer }) => {
        await executerChat(
          { fournisseurs: [petit], kv, creerModele, ...deps },
          {
            writer,
            messages: [
              { role: "user", content: "A " + long },
              { role: "assistant", content: "B " + long },
              { role: "user", content: "C " + long },
              { role: "assistant", content: "D " + long },
              { role: "user", content: "Question finale ?" },
            ],
            reglages: { ...REGLAGES_DEFAUT, maxTokens: 200 },
            conversationId: "conv-r",
          },
        );
      },
    });
    const lecteur = flux.getReader();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      chunks.push(value as UIMessageChunk);
    }
    const metas = chunks.filter((c) => c.type === "message-metadata").map((c) => c.messageMetadata as MetaMessage);
    expect(metas.at(-1)?.resume).toBe(true);
    const appelResume = serveur.appels.find((a) => JSON.stringify(a.corps).includes("Résume fidèlement"));
    expect(appelResume).toBeDefined();
    const dernier = serveur.appels.at(-1)!.corps.messages as Array<{ role: string; content: string }>;
    expect(dernier[0].role).toBe("system");
    expect(dernier[0].content).toContain("RÉSUMÉ-DES-ANCIENS-MESSAGES");
    expect(dernier.at(-1)?.content).toBe("Question finale ?");
  });

  it("requête trop grande pour la fenêtre de débit : bascule si possible, sinon contexte réduit", async () => {
    const long = "mot ".repeat(400);
    const msgs = [
      { role: "user" as const, content: "A " + long },
      { role: "assistant" as const, content: "B " + long },
      { role: "user" as const, content: "C " + long },
      { role: "assistant" as const, content: "D " + long },
      { role: "user" as const, content: "Fin ?" },
    ];
    const lire = async (liste: Fournisseur[], conv: string) => {
      const chunks: UIMessageChunk[] = [];
      const flux = createUIMessageStream<MessageUI>({
        execute: async ({ writer }) => {
          await executerChat({ fournisseurs: liste, kv, creerModele }, { writer, messages: msgs, reglages: { ...REGLAGES_DEFAUT, maxTokens: 100 }, conversationId: conv });
        },
      });
      const lecteur = flux.getReader();
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        chunks.push(value as UIMessageChunk);
      }
      return chunks;
    };
    // Avec un autre fournisseur : bascule, sans marquer le premier épuisé.
    const c1 = await lire([fournisseur("G", "413-itpm"), fournisseur("B", "ok")], "conv-tg1");
    const metas1 = c1.filter((c) => c.type === "message-metadata").map((c) => c.messageMetadata as MetaMessage);
    expect(metas1.at(-1)?.fournisseur).toBe("B");
    expect(c1.filter((c) => c.type === "data-bascule")).toHaveLength(1);
    expect(await kv.get("fournisseur:etat:g")).toBeNull();
    // Seul : contexte réduit puis réponse.
    const c2 = await lire([fournisseur("G", "413-itpm")], "conv-tg2");
    expect(c2.filter((c) => c.type === "text-delta").map((c) => c.delta).join("")).toBe("Réponse courte.");
  });

  it("retente avec un contexte réduit si le fournisseur renvoie « contexte trop long »", async () => {
    const f = fournisseur("Ctx", "contexte", { contexte: 100_000 });
    const long = "mot ".repeat(400);
    const chunks: UIMessageChunk[] = [];
    const flux = createUIMessageStream<MessageUI>({
      execute: async ({ writer }) => {
        await executerChat(
          { fournisseurs: [f], kv, creerModele },
          {
            writer,
            messages: [
              { role: "user", content: "A " + long },
              { role: "assistant", content: "B " + long },
              { role: "user", content: "C " + long },
              { role: "assistant", content: "D " + long },
              { role: "user", content: "Fin ?" },
            ],
            reglages: { ...REGLAGES_DEFAUT, maxTokens: 100 },
            conversationId: "conv-c",
          },
        );
      },
    });
    const lecteur = flux.getReader();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      chunks.push(value as UIMessageChunk);
    }
    const texte = chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    expect(texte).toBe("Réponse courte.");
    expect(serveur.appels.filter((a) => a.scenario === "contexte").length).toBeGreaterThanOrEqual(2);
  });
});
