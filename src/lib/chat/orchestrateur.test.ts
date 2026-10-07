import { createUIMessageStream, tool, type ModelMessage, type UIMessageChunk } from "ai";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getKV, type KV } from "@/lib/kv";
import { creerModele } from "@/lib/fournisseurs/client";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { demarrerFauxServeur, type FauxServeur, type Scenario } from "./faux-serveur";
import { estDegenere, executerChat, fusionnerContinuation, type DepsOrchestrateur } from "./orchestrateur";
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
  bascules: Array<{ de: string; vers: string; raison: string; continuation: boolean }>;
  regenerations: number;
}

const outilRecherche = tool({
  description: "Recherche web",
  inputSchema: z.object({ requete: z.string() }),
  execute: async ({ requete }) => ({ requete, moteur: "faux", resultats: [{ titre: "Java Edition 1.21.11", url: "https://minecraft.wiki/w/Java_Edition_1.21.11", extrait: "Sortie en 2025" }] }),
});

async function executer(
  liste: Fournisseur[],
  opts: Partial<DepsOrchestrateur> = {},
  question = "Bonjour",
  conversationId = "conv-1",
  outils?: Record<string, typeof outilRecherche>,
  historique: ModelMessage[] = [],
): Promise<Sortie> {
  const deps: DepsOrchestrateur = { fournisseurs: liste, kv, creerModele, delaiInactiviteMs: 400, ...opts };
  const chunks: UIMessageChunk[] = [];
  const flux = createUIMessageStream<MessageUI>({
    execute: async ({ writer }) => {
      await executerChat(deps, { writer, messages: [...historique, { role: "user", content: question }], reglages: REGLAGES_DEFAUT, conversationId, outils });
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

  it("ne renvoie jamais le raisonnement des tours précédents (Groq refuse reasoning_content)", async () => {
    const historique: ModelMessage[] = [
      { role: "user", content: "Fais-moi un mod" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Je réfléchis longuement au mod..." },
          { type: "text", text: "Voici le mod." },
        ],
      },
    ];
    const r = await executer([fournisseur("A", "ok", { famille: "groq" })], {}, "Continue", "conv-1", undefined, historique);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    const envoyes = serveur.appels[0].corps.messages as Array<Record<string, unknown>>;
    const assistant = envoyes.find((m) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant).not.toHaveProperty("reasoning_content");
    expect(JSON.stringify(envoyes)).not.toContain("réfléchis longuement");
    expect(assistant?.content).toBe("Voici le mod.");
  });

  it("fait continuer le même fournisseur quand la réponse est coupée par max_tokens", async () => {
    const r = await executer([fournisseur("A", "long"), fournisseur("B", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Début de la réponse longue et la fin.");
    expect(r.meta.fournisseur).toBe("A");
    expect(r.bascules).toHaveLength(0);
    expect(serveur.appels).toHaveLength(2);
    expect(serveur.appels[1].scenario).toBe("long");
    const infos = r.chunks.filter((c) => c.type === "data-info");
    expect(infos).toHaveLength(1);
  });

  it("réponse dégénérée (!!!!) : nouvel essai sur place, texte régénéré", async () => {
    const r = await executer([fournisseur("A", "degenere"), fournisseur("B", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur degenere.");
    expect(r.meta.fournisseur).toBe("A");
    expect(r.regenerations).toBe(1);
    expect(r.bascules).toHaveLength(0);
    expect(serveur.appels.filter((a) => a.scenario === "degenere")).toHaveLength(2);
  });

  it("bascule quand le raisonnement a consommé toute la sortie (réponse vide), après un essai sur place", async () => {
    const r = await executer([fournisseur("A", "vide"), fournisseur("B", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.meta.fournisseur).toBe("B");
    expect(serveur.appels.filter((a) => a.scenario === "vide")).toHaveLength(2);
    expect(r.bascules[0].raison).toMatch(/réponse vide/);
    // A n'est pas marqué indisponible : une requête plus courte peut lui convenir.
    expect(await kv.get("fournisseur:etat:a")).toBeNull();
  });

  it("#16 : une réponse blanche sans token de sortie n'est pas prise pour un succès (bascule)", async () => {
    const r = await executer([fournisseur("A", "blanc"), fournisseur("B", "ok")]);
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur ok.");
    expect(r.meta.fournisseur).toBe("B");
    expect(serveur.appels.filter((a) => a.scenario === "blanc")).toHaveLength(2); // essai sur place puis bascule
    expect(r.bascules[0].raison).toMatch(/réponse vide/);
  });

  it("apprend la limite de sortie (OTPM) et évite ensuite le fournisseur, ou plafonne s'il est seul", async () => {
    const r1 = await executer([fournisseur("A", "otpm"), fournisseur("B", "ok")]);
    expect(r1.meta.fournisseur).toBe("B");
    expect(r1.bascules[0].raison).toMatch(/trop grande/);
    expect(await kv.get("fournisseur:limites:a")).toEqual({ otpm: 1000 });
    serveur.appels.length = 0;
    // Deuxième requête : A est évité d'emblée (B reste le fournisseur de la conversation).
    const r2 = await executer([fournisseur("A", "otpm"), fournisseur("B", "ok")], {}, "Bonjour", "conv-2");
    expect(r2.meta.fournisseur).toBe("B");
    expect(serveur.appels.map((a) => a.scenario)).toEqual(["ok"]);
    serveur.appels.length = 0;
    // Seul : utilisé avec la sortie plafonnée à sa limite.
    const r3 = await executer([fournisseur("A", "otpm")], {}, "Bonjour", "conv-3");
    expect(r3.erreur).toBeUndefined();
    expect(r3.texte).toBe("Réponse plafonnée.");
    expect(serveur.appels[0].corps.max_tokens).toBe(1000);
  });

  it("limite de débit courte : attend puis retente sur place au lieu de basculer", async () => {
    const r = await executer([fournisseur("A", "429-court"), fournisseur("B", "ok")], { attenteMaxReessaiMs: 1_200 });
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse entière du fournisseur 429-court.");
    expect(r.meta.fournisseur).toBe("A");
    expect(r.bascules).toHaveLength(0);
    expect(serveur.appels.map((a) => a.scenario)).toEqual(["429-court", "429-court"]);
    expect(r.chunks.some((c) => c.type === "data-info" && /limite de débit/.test((c as { data: { texte: string } }).data.texte))).toBe(true);
    // A n'est pas marqué épuisé : il a répondu.
    expect((await kv.get<{ statut: string }>("fournisseur:etat:a"))?.statut).toBe("disponible");
  });

  it("limiteur partagé : fournisseur saturé par d'autres tâches → suivant sans le marquer ; attend si la fenêtre est proche", async () => {
    const a = fournisseur("A", "ok", { rpm: 2 }); // 1 créneau utile par fenêtre
    const fenetre = 1000;
    // Sature A dans la fenêtre courante.
    await kv.incr(`fournisseur:rpm:${a.id}:${Math.floor(Date.now() / fenetre)}`, 10);
    const r = await executer([a, fournisseur("B", "ok")], { fenetreDebitMs: fenetre, attenteMaxReessaiMs: 0 });
    expect(r.meta.fournisseur).toBe("B");
    expect(r.bascules[0].raison).toMatch(/requêtes par minute/);
    expect(await kv.get("fournisseur:etat:a")).toBeNull();
    // Seul fournisseur : attend la fenêtre suivante puis répond.
    await kv.incr(`fournisseur:rpm:${a.id}:${Math.floor(Date.now() / fenetre)}`, 10);
    const r2 = await executer([a], { fenetreDebitMs: fenetre, attenteMaxReessaiMs: 2000 }, "Bonjour", "conv-9");
    expect(r2.erreur).toBeUndefined();
    expect(r2.meta.fournisseur).toBe("A");
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
    const reessaiE = (await kv.get<{ reessaiA: number }>("fournisseur:etat:e"))!.reessaiA;
    expect(reessaiE).toBeLessThanOrEqual(Math.min(minuit, Date.now() + 3_600_000));
    expect(reessaiE).toBeGreaterThan(Date.now() + 3_500_000 > minuit ? minuit - 1 : Date.now() + 3_500_000);
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

  it("laisse le modèle appeler l'outil de recherche et affiche les sources", async () => {
    const r = await executer([fournisseur("A", "outil")], {}, "Minecraft 1.21.11 existe ?", "conv-o", { recherche_web: outilRecherche });
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("D'après la recherche, la 1.21.11 existe.");
    const recherches = r.chunks.filter((c) => c.type === "data-recherche").map((c) => (c as { data: { etat: string; requete: string; resultats?: unknown[] } }).data);
    expect(recherches[0]).toMatchObject({ etat: "en-cours", requete: "minecraft 1.21.11" });
    expect(recherches.at(-1)).toMatchObject({ etat: "ok", requete: "minecraft 1.21.11" });
    expect(recherches.at(-1)?.resultats).toHaveLength(1);
    expect(r.meta.usage?.total).toBe(40 + 69);
  });

  it("termine toujours par une réponse écrite, même si le modèle voudrait chercher sans fin", async () => {
    const r = await executer([fournisseur("A", "outil-acharne")], {}, "Ajoute une commande /aurevoir", "conv-oa", { recherche_web: outilRecherche });
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse finale après les recherches.");
    const appels = serveur.appels.filter((a) => a.scenario === "outil-acharne");
    expect(appels.filter((a) => a.corps.tool_choice !== "none" && a.corps.tools).length).toBe(2); // au plus deux recherches
  });

  it("retente sans outils si le fournisseur les refuse", async () => {
    const r = await executer([fournisseur("R", "outil-refuse")], {}, "Bonjour", "conv-or", { recherche_web: outilRecherche });
    expect(r.erreur).toBeUndefined();
    expect(r.texte).toBe("Réponse sans outil.");
    expect(r.bascules).toHaveLength(0);
    expect(serveur.appels.filter((a) => a.scenario === "outil-refuse")).toHaveLength(2);
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

describe("estDegenere", () => {
  it("repère la salade multilingue et les jetons internes recrachés (cas réel Kimi K3)", () => {
    const salade =
      "<|close|>think力度 worthy运用了放风筝 for of S.splithopefully 0, highlighting of Sal. The weonga of the sw类比 in 全年 the let me just not pure. a search for modern of the maybe issue for the mix. for StatusClimate of the the po Upon of that the best of the most开车 of the the best of 26.3 of and rewrite for重整手部 at and rewrite Salut.java each toy of the the the state of the web for the need to of the of the meaning of the most of the context of the the state of the most of the best of the way to the直径净资产 the modern of the 200 the reality of the lower黄忠 of the math";
    expect(estDegenere(salade)).toBe(true);
    expect(estDegenere(salade.replace("<|close|>", ""))).toBe(true);
  });
  it("garde une réponse française qui cite un peu de chinois", () => {
    const t = "Le mot « 你好 » signifie bonjour en chinois. ".repeat(3) + "Voici la commande Fabric : ".repeat(20);
    expect(estDegenere(t)).toBe(false);
  });

  it("ne confond pas du code légitime avec une dégénérescence", () => {
    expect(estDegenere("// //////////////////////////////\npublic class A {}")).toBe(false);
    expect(estDegenere("long x = 100000000000000000000L; // ok")).toBe(false);
    expect(estDegenere("╔════════════════════════╗\n║ titre ║\n╚════════════════════════╝")).toBe(false);
    expect(estDegenere("~~~~~~~~~~~~~~~~~~~~~~~~\ndu texte normal ensuite")).toBe(false);
  });
  it("repère une vraie dégénérescence", () => {
    expect(estDegenere("!".repeat(40))).toBe(true);
    expect(estDegenere("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    // Défaut réel observé chez NVIDIA : court préfixe puis rafale de « ! » (84 % de répétition seulement).
    expect(estDegenere("```mod" + "!".repeat(32))).toBe(true);
    expect(estDegenere('System.out.println("Bonjour !!!");')).toBe(false);
  });
});
