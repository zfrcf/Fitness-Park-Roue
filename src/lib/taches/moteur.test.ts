import { beforeEach, describe, expect, it } from "vitest";
import { getKV, type KV } from "@/lib/kv";
import type { MessageUI } from "@/lib/chat/types";
import type { Tache } from "@/lib/db/taches";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { executerTranche, ordonnerPourTache, type DepsMoteur, type EtatCompilation, type ResultatGeneration } from "./moteur";

const F = (id: string): Fournisseur => ({ id, rang: 1, nom: id, baseUrl: "http://x", apiKey: "k", modele: "m", contexte: 1000, payant: false, famille: "generique" });

const PROJET = "```groovy build.gradle\nplugins { id 'java' }\n```\n```java src/A.java\nclass A {}\n```";

interface Monde {
  kv: KV;
  taches: Map<string, Tache>;
  conversations: Map<string, MessageUI[]>;
  compilations: Map<string, EtatCompilation>;
  programmations: Array<{ id: string; delai: number }>;
  reponses: ResultatGeneration[]; // réponses successives du modèle
  issues: Array<EtatCompilation["statut"]>; // issues successives des compilations
  horloge: { t: number };
}

function monde(): Monde {
  return { kv: getKV(), taches: new Map(), conversations: new Map(), compilations: new Map(), programmations: [], reponses: [], issues: [], horloge: { t: 1_000_000 } };
}

function tache(m: Monde, extra: Partial<Tache> = {}): Tache {
  const t: Tache = {
    id: "t1",
    conversationId: "c1",
    titre: "Mod test",
    objectif: "Fais un mod",
    compiler: 1,
    auto: 0,
    statut: "en_attente",
    etape: "en attente",
    cycles: 0,
    maxCycles: 3,
    compilationId: null,
    empreinteCompilee: null,
    fournisseurId: null,
    tokensEntree: 0,
    tokensSortie: 0,
    jarNom: null,
    jarCompilationId: null,
    erreur: null,
    journal: [],
    repriseA: null,
    battementA: null,
    creeA: new Date(0),
    majA: new Date(0),
    ...extra,
  };
  m.taches.set(t.id, t);
  m.conversations.set(t.conversationId, [{ id: "u1", role: "user", parts: [{ type: "text", text: t.objectif }] }]);
  return t;
}

function deps(m: Monde, fournisseurs = [F("a"), F("b")]): DepsMoteur {
  let n = 0;
  return {
    kv: m.kv,
    fournisseurs,
    maintenant: () => m.horloge.t,
    attendre: async (ms) => {
      m.horloge.t += ms;
    },
    lireTache: async (id) => m.taches.get(id) ?? null,
    majTache: async (id, v) => {
      const t = m.taches.get(id);
      if (!t) return null;
      const maj = { ...t, ...v, majA: new Date(m.horloge.t) } as Tache;
      m.taches.set(id, maj);
      return maj;
    },
    journaliser: async (id, texte) => {
      const t = m.taches.get(id);
      if (t) t.journal = [...t.journal, { a: m.horloge.t, texte }];
    },
    lireMessages: async (c) => m.conversations.get(c) ?? [],
    ajouterMessageUtilisateur: async (c, texte) => {
      m.conversations.get(c)!.push({ id: `u${++n}`, role: "user", parts: [{ type: "text", text: texte }] });
    },
    generer: async ({ conversationId }) => {
      const r = m.reponses.shift() ?? { texte: "Réponse.", fournisseurId: "a", usage: { entree: 10, sortie: 5 } };
      m.horloge.t += 5_000;
      if (r.texte) m.conversations.get(conversationId)!.push({ id: `a${++n}`, role: "assistant", parts: [{ type: "text", text: r.texte }] });
      return r;
    },
    lancerCompilation: async () => {
      const id = `comp${++n}`;
      const c: EtatCompilation = { id, statut: "en_cours" };
      m.compilations.set(id, c);
      return c;
    },
    etatCompilation: async (id) => {
      const c = m.compilations.get(id);
      if (!c) return null;
      if (c.statut === "en_cours") {
        const issue = m.issues.shift();
        if (issue) {
          const fini = { ...c, statut: issue, journal: issue === "echouee" ? "error: cannot find symbol" : "BUILD SUCCESSFUL", jarNom: issue === "reussie" ? "mod-1.0.jar" : null };
          m.compilations.set(id, fini);
          return fini;
        }
      }
      return c;
    },
    programmer: async (id, delai) => {
      m.programmations.push({ id, delai });
    },
  };
}

beforeEach(async () => {
  const kv = getKV();
  for (const k of await kv.keys("")) await kv.del(k);
});

describe("moteur des tâches", () => {
  it("génère, compile, corrige après un échec puis termine avec le jar", async () => {
    const m = monde();
    tache(m);
    m.reponses = [
      { texte: PROJET, fournisseurId: "a", usage: { entree: 100, sortie: 400 } },
      { texte: "```java src/A.java\nclass A { int x; }\n```", fournisseurId: "b", usage: { entree: 200, sortie: 50 } },
    ];
    m.issues = ["echouee", "reussie"];
    const d = deps(m);
    // Une seule tranche suffit ici (horloge simulée) : génération, compilation échouée, correction
    // demandée au modèle, nouvelle génération, compilation réussie.
    await executerTranche(d, "t1");
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("terminee");
    expect(t.cycles).toBe(1);
    expect(t.jarNom).toBe("mod-1.0.jar");
    expect(t.tokensSortie).toBe(450);
    expect(t.fournisseurId).toBe("b");
    const conv = m.conversations.get("c1")!;
    const correction = conv.find((x) => x.role === "user" && (x.parts[0] as { text: string }).text.includes("cannot find symbol"));
    expect(correction).toBeDefined();
    expect(conv.at(-1)!.role).toBe("assistant");
    expect(t.journal.map((j) => j.texte).join("\n")).toMatch(/correction demandée/);
    expect(t.journal.map((j) => j.texte).join("\n")).toMatch(/compilation lancée/);
  });

  it("abandonne après le nombre maximal de cycles", async () => {
    const m = monde();
    tache(m, { maxCycles: 2 });
    m.reponses = [0, 1, 2, 3].map((i) => ({ texte: PROJET.replace("class A {}", `class A { int v = ${i}; }`), fournisseurId: "a" }));
    m.issues = ["echouee", "echouee", "echouee", "echouee"];
    const d = deps(m);
    for (let i = 0; i < 4 && m.taches.get("t1")!.statut !== "echouee"; i++) {
      m.horloge.t += 1000;
      await executerTranche(d, "t1");
    }
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("echouee");
    expect(t.erreur).toMatch(/maximal/);
  });

  it("#42 : maxCycles=1 tente bien UNE correction avant d'abandonner", async () => {
    const m = monde();
    tache(m, { maxCycles: 1 });
    m.reponses = [0, 1].map((i) => ({ texte: PROJET.replace("class A {}", `class A { int v = ${i}; }`), fournisseurId: "a" }));
    m.issues = ["echouee", "echouee"];
    const d = deps(m);
    for (let i = 0; i < 4 && m.taches.get("t1")!.statut !== "echouee"; i++) {
      m.horloge.t += 1000;
      await executerTranche(d, "t1");
    }
    expect(m.taches.get("t1")!.statut).toBe("echouee");
    const corrections = m.conversations.get("c1")!.filter((x) => x.role === "user" && (x.parts[0] as { text?: string }).text?.includes("La compilation a échoué"));
    expect(corrections.length).toBe(1); // exactement une correction tentée (pas zéro)
  });

  it("se met en attente de quota quand tous les fournisseurs sont épuisés, puis reprend", async () => {
    const m = monde();
    tache(m);
    m.reponses = [{ texte: "", erreur: "Tous épuisés", reessaiA: m.horloge.t + 30 * 60_000 }];
    const d = deps(m);
    await executerTranche(d, "t1");
    let t = m.taches.get("t1")!;
    expect(t.statut).toBe("en_attente");
    expect(t.etape).toBe("en attente de quota");
    expect(t.repriseA!.getTime()).toBe(m.horloge.t + 30 * 60_000 - 5_000);
    // Délai (30 min) bien plus long que le budget restant → relance immédiate ; l'attente est portée
    // par repriseA et reprise par une fonction fraîche / le cron (#7).
    expect(m.programmations.at(-1)!.delai).toBe(0);
    // Avant l'heure : rien ne se passe, juste une reprogrammation.
    await executerTranche(d, "t1");
    expect(m.taches.get("t1")!.statut).toBe("en_attente");
    // À l'heure : génération.
    m.horloge.t += 31 * 60_000;
    m.reponses = [{ texte: "Réponse simple.", fournisseurId: "a" }];
    m.taches.get("t1")!.compiler = 0;
    await executerTranche(d, "t1");
    t = m.taches.get("t1")!;
    expect(t.statut).toBe("terminee");
  });

  it("verrou atomique : ne lance pas deux tranches en même temps et ignore une tâche en pause", async () => {
    const m = monde();
    tache(m, { statut: "en_cours" });
    const d = deps(m);
    // Verrou déjà détenu par une autre tranche → celle-ci ne génère rien.
    await m.kv.incr("tache:tranche:t1", 300);
    await executerTranche(d, "t1");
    expect(m.conversations.get("c1")!.length).toBe(1); // rien généré
    await m.kv.del("tache:tranche:t1");
    // Tâche en pause → ignorée même sans verrou.
    m.taches.get("t1")!.statut = "pause";
    await executerTranche(d, "t1");
    expect(m.conversations.get("c1")!.length).toBe(1);
  });

  it("libère le verrou en fin de tranche (une tranche ultérieure peut reprendre)", async () => {
    const m = monde();
    tache(m, { compiler: 0 });
    const d = deps(m);
    await executerTranche(d, "t1"); // réponse simple, pas de compilation → terminée
    expect(m.taches.get("t1")!.statut).toBe("terminee");
    expect(await m.kv.get("tache:tranche:t1")).toBeNull(); // verrou libéré
  });

  it("respecte une pause demandée PENDANT la génération : pas d'écrasement ni de relance", async () => {
    const m = monde();
    tache(m, { compiler: 1 });
    const d = deps(m);
    // Le modèle « met en pause » la tâche au moment où il répond (simule un clic Pause concurrent).
    m.reponses = [
      {
        get texte() {
          m.taches.get("t1")!.statut = "pause";
          return "Réponse partielle.";
        },
        fournisseurId: "a",
        usage: { entree: 10, sortie: 5 },
      } as unknown as ResultatGeneration,
    ];
    await executerTranche(d, "t1");
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("pause"); // la pause n'est pas écrasée par en_attente/terminee
    expect(m.programmations).toHaveLength(0); // aucune relance programmée
    expect(await m.kv.get("tache:tranche:t1")).toBeNull(); // verrou tout de même libéré
    // Aucun message « coupée par la limite de temps » injecté.
    expect(m.conversations.get("c1")!.some((x) => (x.parts[0] as { text?: string }).text?.includes("coupée par une limite"))).toBe(false);
  });

  it("#27 : une tâche dont la conversation a été supprimée s'arrête sans la ressusciter", async () => {
    const m = monde();
    tache(m);
    m.conversations.set("c1", []); // conversation supprimée entre-temps
    await executerTranche(deps(m), "t1");
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("echouee");
    expect(m.conversations.get("c1")!.length).toBe(0); // aucun message recréé
  });

  it("#7 : un délai court qui tient dans le budget est attendu dans la fonction courante (pas de relance immédiate)", async () => {
    const m = monde();
    tache(m);
    m.reponses = [{ texte: "", erreur: "panne réseau" }];
    await executerTranche(deps(m), "t1");
    expect(m.taches.get("t1")!.statut).toBe("en_attente");
    expect(m.programmations.at(-1)!.delai).toBe(120_000); // budget ample → attendu en fonction
  });

  it("demande un projet complet si la réponse n'a pas de build.gradle, puis échoue si ça persiste", async () => {
    const m = monde();
    tache(m);
    m.reponses = [{ texte: "Voici une idée sans code.", fournisseurId: "a" }, { texte: "Toujours pas de code.", fournisseurId: "a" }];
    const d = deps(m);
    await executerTranche(d, "t1"); // génération → pas de projet → demande
    expect(m.taches.get("t1")!.statut).toBe("en_attente");
    expect((m.conversations.get("c1")!.at(-1)!.parts[0] as { text: string }).text).toMatch(/projet COMPLET/);
    m.horloge.t += 1000;
    await executerTranche(d, "t1"); // génération → toujours rien → échec
    expect(m.taches.get("t1")!.statut).toBe("echouee");
  });

  it("mode auto : continue à corriger au-delà de maxCycles jusqu'au jar", async () => {
    const m = monde();
    tache(m, { auto: 1, maxCycles: 2 }); // maxCycles bas : en mode normal il échouerait vite
    const PROJ = PROJET;
    m.reponses = [0, 1, 2, 3].map((i) => ({ texte: PROJ.replace("class A {}", `class A { int v = ${i}; }`), fournisseurId: "a" }));
    m.issues = ["echouee", "echouee", "echouee", "reussie"]; // 3 échecs (> maxCycles 2) puis succès
    const d = deps(m);
    for (let i = 0; i < 8 && m.taches.get("t1")!.statut !== "terminee" && m.taches.get("t1")!.statut !== "echouee"; i++) {
      m.horloge.t += 1000;
      await executerTranche(d, "t1");
    }
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("terminee");
    expect(t.jarNom).toBe("mod-1.0.jar");
    expect(t.cycles).toBeGreaterThanOrEqual(3); // a dépassé maxCycles=2 sans s'arrêter
  });

  it("ne recompile pas un projet strictement inchangé : correction redemandée sans run GitHub", async () => {
    const m = monde();
    tache(m, { maxCycles: 5 });
    // Cycle 1 : projet, échec. Cycle 2 : le modèle renvoie le MÊME projet (aucune modification).
    m.reponses = [{ texte: PROJET, fournisseurId: "a" }, { texte: "Je ne sais pas quoi changer.", fournisseurId: "a" }, { texte: PROJET.replace("class A {}", "class A { int v; }"), fournisseurId: "a" }];
    m.issues = ["echouee", "reussie"]; // une seule compilation en échec attendue, puis succès après vraie modif
    const d = deps(m);
    for (let i = 0; i < 8 && !["terminee", "echouee"].includes(m.taches.get("t1")!.statut); i++) {
      m.horloge.t += 1000;
      await executerTranche(d, "t1");
    }
    const t = m.taches.get("t1")!;
    // 2 compilations seulement (projet initial + projet réellement modifié), pas de recompilation à l'identique.
    expect(m.compilations.size).toBe(2);
    expect(t.journal.map((j) => j.texte).join("\n")).toMatch(/ne modifie aucun fichier/);
  });

  it("arrête une tâche qui dépasse le plafond de tokens (anti-emballement)", async () => {
    const m = monde();
    tache(m, { tokensEntree: 1_900_000, tokensSortie: 200_000 }); // 2,1 M > plafond de test 2 M
    const d = deps(m);
    await executerTranche(d, "t1");
    const t = m.taches.get("t1")!;
    expect(t.statut).toBe("echouee");
    expect(t.erreur).toMatch(/plafond|budget de tokens/i);
    expect(m.conversations.get("c1")!.length).toBe(1); // rien généré
  });

  it("met les fournisseurs occupés par une autre tâche en fin de liste", async () => {
    const m = monde();
    const d = deps(m);
    await m.kv.set("tache:fournisseur:a", "autre-tache", 60);
    expect((await ordonnerPourTache(d, "t1")).map((f) => f.id)).toEqual(["b", "a"]);
    await m.kv.set("tache:fournisseur:a", "t1", 60);
    expect((await ordonnerPourTache(d, "t1")).map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("tâche lancée pour une demande précise", () => {
  it("ne se déclare pas réussie tant qu'aucune réponse n'a modifié le projet (cas réel)", async () => {
    const m = monde();
    tache(m);
    // Projet déjà compilable avant la tâche, puis la demande de la tâche (message « tache-t1 »).
    m.conversations.set("c1", [
      { id: "u0", role: "user", parts: [{ type: "text", text: "Fais un mod" }] },
      { id: "a0", role: "assistant", parts: [{ type: "text", text: PROJET }] },
      { id: "tache-t1", role: "user", parts: [{ type: "text", text: "Ajoute une commande /heure" }] },
    ]);
    // Le modèle répond sans rien modifier (note recopiée, charabia…).
    m.reponses.push({ texte: "La commande est ajoutée.", fournisseurId: "a", usage: { entree: 10, sortie: 5 } });
    m.issues.push("reussie");
    await executerTranche(deps(m), "t1");
    const t = m.taches.get("t1")!;
    expect(t.statut).not.toBe("terminee");
    expect(t.cycles).toBe(1);
    const dernier = m.conversations.get("c1")!.at(-1)!;
    expect(dernier.role).toBe("user");
    expect((dernier.parts[0] as { text: string }).text).toMatch(/n'a modifié aucun fichier/);
  });

  it("se termine dès qu'une réponse a réellement modifié le projet et que ça compile", async () => {
    const m = monde();
    tache(m);
    m.conversations.set("c1", [
      { id: "u0", role: "user", parts: [{ type: "text", text: "Fais un mod" }] },
      { id: "a0", role: "assistant", parts: [{ type: "text", text: PROJET }] },
      { id: "tache-t1", role: "user", parts: [{ type: "text", text: "Ajoute un champ" }] },
    ]);
    m.reponses.push({ texte: "```modif src/A.java\n<<<<<<< CHERCHER\nclass A {}\n=======\nclass A { int x; }\n>>>>>>> REMPLACER\n```", fournisseurId: "a", usage: { entree: 10, sortie: 5 } });
    m.issues.push("reussie");
    await executerTranche(deps(m), "t1");
    expect(m.taches.get("t1")!.statut).toBe("terminee");
  });
});
