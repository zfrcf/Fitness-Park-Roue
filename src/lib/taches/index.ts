/** Assemblage du moteur avec les vraies dépendances (base, GitHub, fournisseurs, planificateur). */
import { consommerTour, executerTour } from "@/lib/chat/tour";
import { ajouterMessage, lireConversation } from "@/lib/db/conversations";
import { lireCompilation } from "@/lib/db/compilations";
import { journaliser, lireTache, majTache, tachesAReveiller } from "@/lib/db/taches";
import { lancerCompilationProjet } from "@/lib/github/lancer";
import { rafraichirCompilation } from "@/lib/github/suivi";
import { fournisseurs } from "@/lib/fournisseurs/registre";
import { getKV } from "@/lib/kv";
import { nettoyerBranchesCompilation } from "@/lib/github/menage";
import { executerTranche, type DepsMoteur, type EtatCompilation } from "./moteur";
import { planificateurHTTP } from "./planificateur";
import { modeLocal } from "@/lib/mode";

function versEtat(c: { id: string; statut: string; journal: string | null; jarNom: string | null; erreur: string | null; runUrl: string | null }): EtatCompilation {
  return { id: c.id, statut: c.statut as EtatCompilation["statut"], journal: c.journal, jarNom: c.jarNom, erreur: c.erreur, runUrl: c.runUrl };
}

export function depsReelles(): DepsMoteur {
  return {
    kv: getKV(),
    fournisseurs: fournisseurs(),
    lireTache,
    majTache,
    journaliser,
    log: (m) => console.warn(m),
    lireMessages: async (conversationId) => (await lireConversation(conversationId))?.messages ?? [],
    ajouterMessageUtilisateur: (conversationId, texte) =>
      ajouterMessage(conversationId, { id: `tache-${Date.now().toString(36)}`, role: "user", parts: [{ type: "text", text: texte }] }),
    generer: async ({ conversationId, messages, fournisseurs: ordre, signal }) => {
      // persister: false → on ne réécrit pas l'historique déjà en base, et on ne garde la réponse
      // QUE si du texte visible a été produit (un message vide après quota fausserait la reprise).
      let reponse: import("@/lib/chat/types").MessageUI | undefined;
      let fidFin: string | undefined;
      const r = await executerTour({ conversationId, messages, fournisseurs: ordre, ignorerPreference: true, signal, persister: false, onFin: (msg, fid) => { reponse = msg; fidFin = fid; } });
      if (!r.ok) return { texte: "", erreur: r.erreur };
      const c = await consommerTour(r.stream);
      if (c.texte.trim() && reponse) {
        try {
          await ajouterMessage(conversationId, reponse, c.meta.fournisseurId ?? fidFin);
        } catch (e) {
          console.warn("[taches] persistance de la réponse impossible :", e instanceof Error ? e.message : e);
        }
      }
      return { texte: c.texte, fournisseurId: c.meta.fournisseurId ?? fidFin, usage: c.meta.usage, erreur: c.erreur, reessaiA: c.reessaiA };
    },
    lancerCompilation: async ({ conversationId, messageId, fichiers }) => versEtat(await lancerCompilationProjet({ conversationId, messageId, fichiers })),
    etatCompilation: async (id) => {
      const c = (await rafraichirCompilation(id)) ?? (await lireCompilation(id));
      return c ? versEtat(c) : null;
    },
    programmer: planificateurHTTP.programmer,
  };
}

export async function executerTacheMaintenant(id: string): Promise<void> {
  await executerTranche(depsReelles(), id);
}

/** Relance les tâches dues ou orphelines ; renvoie leurs identifiants. */
export async function reveillerTaches(): Promise<string[]> {
  // Verrou atomique : évite l'amplification (réveil appelé par le cron ET le sondage GET /api/taches).
  if ((await getKV().incr("reveil:verrou", 20)) !== 1) return [];
  const liste = await tachesAReveiller();
  for (const t of liste) {
    if (t.statut === "en_cours") await majTache(t.id, { statut: "en_attente", battementA: null });
    await planificateurHTTP.programmer(t.id, 0);
  }
  // Ménage des branches de compilation orphelines, au plus une fois toutes les 30 min (inutile en local).
  if (!modeLocal()) void menageThrottle();
  return liste.map((t) => t.id);
}

const CLE_MENAGE = "menage:branches:dernier";

async function menageThrottle(): Promise<void> {
  try {
    const kv = getKV();
    if ((await kv.incr(CLE_MENAGE, 30 * 60)) !== 1) return; // verrou atomique 30 min
    const r = await nettoyerBranchesCompilation();
    if (r.supprimees.length) console.warn(`[menage] branches supprimées : ${r.supprimees.join(", ")}`);
  } catch (e) {
    console.warn("[menage] échec :", e instanceof Error ? e.message : e);
  }
}
