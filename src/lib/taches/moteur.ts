/**
 * Moteur des tâches de fond. Une tâche pilote une conversation jusqu'à son résultat :
 *   génération (tour de chat) → compilation GitHub → lecture du journal → correction → …
 * Le travail est découpé en tranches (≤ ~4 min 30, limite Vercel Hobby) ; chaque tranche
 * programme la suivante. Toutes les dépendances externes sont injectables pour les tests.
 */
import type { MessageUI } from "@/lib/chat/types";
import { estProjetGradle, type FichierGenere } from "@/lib/fichiers/extraire";
import { createHash } from "node:crypto";
import { fusionnerProjet } from "@/lib/fichiers/projet";
import { validerFichiers } from "@/lib/github/compilation";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import type { KV } from "@/lib/kv";
import type { Tache } from "@/lib/db/taches";

export const BUDGET_TRANCHE_MS = 270_000;
/** Plafond de tokens (entrée + sortie) par tâche avant arrêt anti-emballement. */
export const PLAFOND_TOKENS_TACHE = 2_000_000;
/** Une génération commence seulement si la tranche est encore « fraîche » (budget complet). */
const MARGE_GENERATION_MS = 25_000;
const INTERVALLE_SONDAGE_MS = 15_000;
const TTL_OCCUPATION_S = 300;
/** TTL du verrou de tranche : couvre une tranche entière + marge, auto-libéré si le process meurt. */
const TTL_VERROU_TRANCHE_S = Math.ceil(BUDGET_TRANCHE_MS / 1000) + 60;
/** Pendant la génération : battement de cœur + détection d'une pause/d'un arrêt demandés. */
const INTERVALLE_SURVEILLANCE_MS = 10_000;
/** Clé du verrou de tranche (un seul exécuteur à la fois par tâche). */
export const cleVerrouTranche = (id: string) => `tache:tranche:${id}`;

export interface EtatCompilation {
  id: string;
  statut: "en_attente" | "en_cours" | "reussie" | "echouee" | "erreur";
  journal?: string | null;
  jarNom?: string | null;
  erreur?: string | null;
  runUrl?: string | null;
}

export interface ResultatGeneration {
  texte: string;
  fournisseurId?: string;
  usage?: { entree: number; sortie: number };
  erreur?: string;
  /** Tous les fournisseurs épuisés : heure de reprise. */
  reessaiA?: number;
}

export interface DepsMoteur {
  kv: KV;
  fournisseurs: Fournisseur[];
  maintenant?: () => number;
  attendre?: (ms: number) => Promise<void>;
  lireTache: (id: string) => Promise<Tache | null>;
  majTache: (id: string, v: Partial<Tache>) => Promise<Tache | null>;
  journaliser: (id: string, texte: string) => Promise<void>;
  lireMessages: (conversationId: string) => Promise<MessageUI[]>;
  ajouterMessageUtilisateur: (conversationId: string, texte: string) => Promise<void>;
  /** Exécute un tour de chat sur la conversation (le message de l'assistant est persisté par le tour). */
  generer: (p: { conversationId: string; messages: MessageUI[]; fournisseurs: Fournisseur[]; signal: AbortSignal }) => Promise<ResultatGeneration>;
  lancerCompilation: (p: { conversationId: string; messageId: string; fichiers: FichierGenere[] }) => Promise<EtatCompilation>;
  etatCompilation: (id: string) => Promise<EtatCompilation | null>;
  programmer: (tacheId: string, delaiMs: number) => Promise<void>;
  /** Plafond de tokens par tâche (défaut PLAFOND_TOKENS_TACHE). */
  plafondTokens?: number;
  log?: (m: string) => void;
}

const PREFIXE_OCCUPE = "tache:fournisseur:";

/** Fournisseurs libres d'abord (rang), occupés par une autre tâche ensuite. */
export async function ordonnerPourTache(deps: DepsMoteur, tacheId: string): Promise<Fournisseur[]> {
  const libres: Fournisseur[] = [];
  const occupes: Fournisseur[] = [];
  for (const f of deps.fournisseurs) {
    const par = await deps.kv.get<string>(PREFIXE_OCCUPE + f.id);
    (par && par !== tacheId ? occupes : libres).push(f);
  }
  return [...libres, ...occupes];
}

/** Empreinte stable du projet (sha256 des fichiers triés) : détecte un projet strictement inchangé. */
export function empreinteProjet(fichiers: Array<{ chemin: string; contenu: string }>): string {
  const h = createHash("sha256");
  for (const f of [...fichiers].sort((a, b) => a.chemin.localeCompare(b.chemin))) h.update(f.chemin + "\0" + f.contenu + "\0");
  return h.digest("hex");
}

export function texteCorrection(journal: string): string {
  return `La compilation sur GitHub a échoué. Corrige le projet et renvoie chaque fichier modifié en entier, avec son chemin. Personne ne répondra à une question : si tu hésites sur une API, choisis la plus probable et livre les fichiers. Journal :\n\n\`\`\`text\n${journal}\n\`\`\``;
}

type Fin = "continuer" | "arreter";

/** Exécute une tranche de travail sur la tâche ; programme la suite si nécessaire. */
export async function executerTranche(deps: DepsMoteur, tacheId: string): Promise<void> {
  const maintenant = deps.maintenant ?? Date.now;
  const attendre = deps.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});
  const debut = maintenant();
  const restant = () => BUDGET_TRANCHE_MS - (maintenant() - debut);

  const t0 = await deps.lireTache(tacheId);
  if (!t0) return;
  if (t0.statut !== "en_attente" && t0.statut !== "en_cours") return;
  if (t0.repriseA && t0.repriseA.getTime() > maintenant()) {
    await deps.programmer(tacheId, t0.repriseA.getTime() - maintenant());
    return;
  }
  // Verrou atomique : une seule tranche à la fois par tâche. incr == 1 → on détient le verrou ;
  // sinon une autre tranche tourne déjà (le TTL le libère si le process meurt). Remplace l'ancien
  // garde-fou « battementA < 2 min » (lecture-puis-écriture non atomique → deux tranches parallèles).
  const verrou = cleVerrouTranche(tacheId);
  if ((await deps.kv.incr(verrou, TTL_VERROU_TRANCHE_S)) !== 1) {
    log(`[taches] ${tacheId} : une tranche est déjà en cours`);
    return;
  }
  let verrouTenu = true;
  const relacher = async () => {
    if (!verrouTenu) return;
    verrouTenu = false;
    await deps.kv.del(verrou).catch(() => {});
  };

  await deps.majTache(tacheId, { statut: "en_cours", battementA: new Date(maintenant()), repriseA: null });

  const battre = () => deps.majTache(tacheId, { battementA: new Date(maintenant()) });
  /** L'utilisateur a-t-il demandé une pause ou un arrêt entre-temps ? (ou la tâche supprimée) */
  const interrompue = async (): Promise<boolean> => {
    const a = await deps.lireTache(tacheId);
    return !a || a.statut === "pause" || a.statut === "arretee";
  };
  const terminer = async (statut: Tache["statut"], etape: string, extra: Partial<Tache> = {}) => {
    if (await interrompue()) return; // ne pas écraser une pause/un arrêt demandé par l'utilisateur
    await deps.majTache(tacheId, { statut, etape, battementA: null, ...extra });
    await deps.journaliser(tacheId, etape);
  };
  const suspendre = async (delaiMs: number, etape: string) => {
    if (await interrompue()) return; // respecter l'interruption plutôt que reprogrammer
    await deps.majTache(tacheId, { statut: "en_attente", etape, battementA: null, repriseA: delaiMs > 0 ? new Date(maintenant() + delaiMs) : null });
    await relacher(); // libérer AVANT la relance : une relance immédiate (delai 0) se heurterait sinon au verrou
    // Si le délai ne tient pas dans le budget restant de CETTE fonction, on relance tout de suite :
    // une fonction fraîche attendra le délai (via repriseA) dans son propre budget de 300 s. Sinon un
    // délai de 60-120 s en fin de tranche dépasse maxDuration, la relance n'a jamais lieu et la tâche
    // dort jusqu'au cron (#7).
    const delaiRelance = delaiMs > 0 && delaiMs > restant() ? 0 : delaiMs;
    await deps.programmer(tacheId, delaiRelance);
  };

  try {
    for (;;) {
      const t = await deps.lireTache(tacheId);
      if (!t || (t.statut !== "en_cours" && t.statut !== "en_attente")) return; // pause ou arrêt demandé entre-temps
      // Garde-fou anti-emballement : plafond de tokens par tâche, quelle que soit la cause.
      const tokensTotal = t.tokensEntree + t.tokensSortie;
      if (tokensTotal > (deps.plafondTokens ?? PLAFOND_TOKENS_TACHE)) {
        await terminer("echouee", "budget de tokens atteint", { erreur: `Tâche arrêtée après ${tokensTotal.toLocaleString("fr-FR")} tokens (plafond anti-emballement). Relancez-la en repartant d'une conversation plus courte.` });
        return;
      }
      const messages = await deps.lireMessages(t.conversationId);
      // Conversation supprimée entre-temps : aucun message. On arrête au lieu de la ressusciter en
      // boucle (le premier message recréerait la conversation et consommerait du quota) (#27).
      if (messages.length === 0) {
        await terminer("echouee", "conversation introuvable", { erreur: "La conversation de cette tâche a été supprimée." });
        return;
      }
      const dernier = messages.at(-1);

      // 1. Un message utilisateur attend une réponse : génération.
      if (!dernier || dernier.role === "user") {
        if (restant() < BUDGET_TRANCHE_MS - MARGE_GENERATION_MS) {
          await suspendre(0, "génération reportée à la tranche suivante");
          return;
        }
        const ordre = await ordonnerPourTache(deps, tacheId);
        const premier = ordre[0];
        if (premier) await deps.kv.set(PREFIXE_OCCUPE + premier.id, tacheId, TTL_OCCUPATION_S);
        await deps.majTache(tacheId, { etape: `génération (${t.cycles === 0 ? "projet initial" : t.auto === 1 ? `correction ${t.cycles} (auto)` : `correction ${t.cycles}/${t.maxCycles}`})` });
        const controleur = new AbortController();
        let abandonInterruption = false;
        const minuteur = setTimeout(() => controleur.abort(), Math.max(10_000, restant() - 5_000));
        // Surveillance : bat le cœur et, surtout, coupe la génération dès qu'une pause/un arrêt est demandé.
        const surveillance = setInterval(() => {
          void (async () => {
            await battre();
            if (await interrompue()) {
              abandonInterruption = true;
              controleur.abort();
            }
          })();
        }, INTERVALLE_SURVEILLANCE_MS);
        let r: ResultatGeneration;
        try {
          r = await deps.generer({ conversationId: t.conversationId, messages, fournisseurs: ordre, signal: controleur.signal });
        } finally {
          clearTimeout(minuteur);
          clearInterval(surveillance);
          if (premier) await deps.kv.del(PREFIXE_OCCUPE + premier.id);
        }
        // On enregistre la consommation réelle même en cas d'interruption.
        await deps.majTache(tacheId, {
          fournisseurId: r.fournisseurId ?? t.fournisseurId,
          tokensEntree: t.tokensEntree + (r.usage?.entree ?? 0),
          tokensSortie: t.tokensSortie + (r.usage?.sortie ?? 0),
        });
        // Pause/arrêt pendant la génération : on sort sans reprogrammer ni injecter de message de suite.
        if (abandonInterruption || (await interrompue())) {
          await deps.journaliser(tacheId, "interrompue par l'utilisateur pendant la génération");
          return;
        }
        if (r.reessaiA) {
          const delai = Math.max(60_000, r.reessaiA - maintenant());
          await deps.journaliser(tacheId, `tous les fournisseurs sont épuisés, reprise prévue dans ${Math.round(delai / 60_000)} min`);
          await suspendre(delai, "en attente de quota");
          return;
        }
        if (r.erreur && !r.texte) {
          await deps.journaliser(tacheId, `génération échouée : ${r.erreur}`);
          await suspendre(120_000, "nouvel essai dans 2 min");
          return;
        }
        if (controleur.signal.aborted) {
          await deps.journaliser(tacheId, "réponse coupée par la limite de temps, demande de suite");
          await deps.ajouterMessageUtilisateur(t.conversationId, "Ta réponse a été coupée par une limite de temps. Reprends exactement là où tu t'es arrêté, sans répéter ce qui est déjà écrit.");
          await suspendre(0, "suite de la réponse");
          return;
        }
        await deps.journaliser(tacheId, `réponse de ${r.fournisseurId ?? "?"} (${r.usage?.sortie ?? 0} tokens)`);
        if (t.compiler !== 1) {
          await terminer("terminee", "réponse livrée");
          return;
        }
        continue; // → compilation
      }

      // 2. Dernière réponse de l'assistant : compiler le projet (ou conclure).
      if (t.compiler !== 1) {
        await terminer("terminee", "réponse livrée");
        return;
      }
      let compilation: EtatCompilation | null = t.compilationId ? await deps.etatCompilation(t.compilationId) : null;
      if (!compilation) {
        const projet = fusionnerProjet(messages);
        if (!estProjetGradle(projet)) {
          // En mode automatique, on redemande le projet complet sans limite (borné par le plafond de tokens).
          if (t.cycles >= 1 && t.auto !== 1) {
            await terminer("echouee", "aucun projet Gradle compilable n'a été produit", { erreur: "Le modèle n'a pas livré de build.gradle." });
            return;
          }
          await deps.majTache(tacheId, { cycles: t.cycles + 1 });
          await deps.journaliser(tacheId, "pas de projet Gradle dans la réponse : demande du projet complet");
          await deps.ajouterMessageUtilisateur(
            t.conversationId,
            "Tu n'as pas livré de projet compilable. Livre maintenant le projet COMPLET (build.gradle, settings.gradle, gradle.properties, fabric.mod.json, sources), chaque fichier en entier dans son bloc de code avec son chemin.",
          );
          await suspendre(0, "demande du projet complet");
          return;
        }
        const fichiersProjet = projet.map(({ chemin, contenu }) => ({ chemin, contenu }));
        // (a) Projet refusé par la validation locale : correction SANS consommer de run GitHub.
        const refus = validerFichiers(fichiersProjet);
        if (refus.length) {
          const cycles = t.cycles + 1;
          if (t.auto !== 1 && cycles >= t.maxCycles) {
            await terminer("echouee", `projet refusé après ${cycles} tentatives`, { cycles, erreur: `Projet refusé : ${refus.join(" ; ")}` });
            return;
          }
          await deps.journaliser(tacheId, `projet refusé avant envoi (${refus.join(" ; ")}), correction demandée`);
          await deps.ajouterMessageUtilisateur(
            t.conversationId,
            `Le projet a été refusé avant l'envoi : ${refus.join(" ; ")}. Mets build.gradle, settings.gradle et gradle.properties à la RACINE, un seul projet Gradle sans sous-projet, un seul source set src/main ; renvoie en entier chaque fichier déplacé avec son nouveau chemin et « Supprimer : ancien/chemin ».`,
          );
          await deps.majTache(tacheId, { cycles, etape: `correction ${t.auto === 1 ? `${cycles} (auto)` : `${cycles}/${t.maxCycles}`}` });
          await suspendre(0, "projet refusé : correction");
          return;
        }
        // (b) Projet strictement identique au dernier compilé : le modèle n'a rien changé → ne pas recompiler.
        const empreinte = empreinteProjet(fichiersProjet);
        if (t.empreinteCompilee && empreinte === t.empreinteCompilee) {
          const cycles = t.cycles + 1;
          if (t.auto !== 1 && cycles >= t.maxCycles) {
            await terminer("echouee", `aucune correction livrée après ${cycles} cycles`, { cycles, erreur: "Le modèle n'a renvoyé aucun fichier modifié." });
            return;
          }
          await deps.journaliser(tacheId, "la réponse ne modifie aucun fichier : correction redemandée sans recompiler");
          await deps.ajouterMessageUtilisateur(
            t.conversationId,
            "Ta réponse ne contenait aucun fichier modifié. Personne ne peut répondre à tes questions : décide toi-même et renvoie EN ENTIER chaque fichier corrigé, chacun dans son bloc de code avec son chemin.",
          );
          await deps.majTache(tacheId, { cycles });
          await suspendre(0, "aucune modification : correction");
          return;
        }
        await deps.majTache(tacheId, { etape: `envoi de ${projet.length} fichiers à GitHub` });
        try {
          compilation = await deps.lancerCompilation({ conversationId: t.conversationId, messageId: dernier.id, fichiers: fichiersProjet });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "échec de l'envoi";
          await deps.journaliser(tacheId, `compilation impossible : ${msg}`);
          await terminer("echouee", "compilation impossible", { erreur: msg });
          return;
        }
        await deps.majTache(tacheId, { compilationId: compilation.id, empreinteCompilee: empreinte, etape: "compilation sur GitHub" });
        await deps.journaliser(tacheId, `compilation lancée (${projet.length} fichiers)`);
      }

      // 3. Suivi de la compilation jusqu'à son terme (ou jusqu'à la fin de la tranche).
      while (compilation && (compilation.statut === "en_attente" || compilation.statut === "en_cours")) {
        if (restant() < INTERVALLE_SONDAGE_MS + 5_000) {
          await suspendre(20_000, "compilation sur GitHub (suivi)");
          return;
        }
        await attendre(INTERVALLE_SONDAGE_MS);
        await battre();
        compilation = await deps.etatCompilation(compilation.id);
      }
      if (!compilation) {
        await terminer("echouee", "compilation introuvable");
        return;
      }
      if (compilation.statut === "reussie") {
        await terminer("terminee", `réussie : ${compilation.jarNom ?? "jar"} prêt`, { jarNom: compilation.jarNom ?? null, jarCompilationId: compilation.id, erreur: null });
        return;
      }
      // Échec : correction, dans la limite des cycles.
      const cycles = t.cycles + 1;
      if (compilation.statut === "erreur" && !compilation.journal) {
        await terminer("echouee", "erreur de la chaîne de compilation", { erreur: compilation.erreur ?? "erreur inconnue" });
        return;
      }
      // Mode automatique : on continue à corriger jusqu'au jar (seul le plafond de tokens arrête).
      if (t.auto !== 1 && cycles >= t.maxCycles) {
        await terminer("echouee", `échec après ${cycles} compilations`, { cycles, compilationId: null, erreur: "Nombre maximal de corrections atteint." });
        return;
      }
      const repere = t.auto === 1 ? `${cycles} (auto)` : `${cycles}/${t.maxCycles}`;
      await deps.journaliser(tacheId, `compilation échouée (cycle ${repere}), correction demandée`);
      await deps.ajouterMessageUtilisateur(t.conversationId, texteCorrection(compilation.journal ?? compilation.erreur ?? "journal indisponible"));
      await deps.majTache(tacheId, { cycles, compilationId: null, etape: `correction ${repere}` });
      const fin: Fin = restant() < BUDGET_TRANCHE_MS - MARGE_GENERATION_MS ? "arreter" : "continuer";
      if (fin === "arreter") {
        await suspendre(0, `correction ${repere}`);
        return;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[taches] ${tacheId} : ${msg}`);
    await deps.journaliser(tacheId, `erreur : ${msg}`);
    await suspendre(60_000, "erreur, nouvel essai dans 1 min");
  } finally {
    await relacher();
  }
}
