/** Assemblage du moteur avec les vraies dépendances (base, GitHub, fournisseurs, planificateur). */
import { consommerTour, executerTour } from "@/lib/chat/tour";
import { ajouterMessage, lireConversation } from "@/lib/db/conversations";
import { creerCompilation, lireCompilation, majCompilation } from "@/lib/db/compilations";
import { journaliser, lireTache, majTache, tachesAReveiller } from "@/lib/db/taches";
import { nomArchive } from "@/lib/fichiers/extraire";
import { creerBranche, validerFichiers } from "@/lib/github/compilation";
import { rafraichirCompilation } from "@/lib/github/suivi";
import { fournisseurs } from "@/lib/fournisseurs/registre";
import { getKV } from "@/lib/kv";
import { nettoyerBranchesCompilation } from "@/lib/github/menage";
import { executerTranche, type DepsMoteur, type EtatCompilation } from "./moteur";
import { planificateurHTTP } from "./planificateur";

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
      const r = await executerTour({ conversationId, messages, fournisseurs: ordre, ignorerPreference: true, signal, persister: true });
      if (!r.ok) return { texte: "", erreur: r.erreur };
      const c = await consommerTour(r.stream);
      return { texte: c.texte, fournisseurId: c.meta.fournisseurId, usage: c.meta.usage, erreur: c.erreur, reessaiA: c.reessaiA };
    },
    lancerCompilation: async ({ conversationId, messageId, fichiers }) => {
      const erreurs = validerFichiers(fichiers);
      if (erreurs.length) throw new Error(`Projet refusé : ${erreurs.join(" ; ")}`);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const nom = nomArchive(fichiers, "projet");
      let c = await creerCompilation({ id, conversationId, messageId, nom, branche: `compilation/${id}`, nbFichiers: fichiers.length });
      try {
        const b = await creerBranche(id, fichiers, nom);
        c = (await majCompilation(id, { brancheUrl: b.url })) ?? c;
      } catch (e) {
        await majCompilation(id, { statut: "erreur", erreur: e instanceof Error ? e.message : "échec de l'envoi sur GitHub" });
        throw e;
      }
      return versEtat(c);
    },
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
  const liste = await tachesAReveiller();
  for (const t of liste) {
    if (t.statut === "en_cours") await majTache(t.id, { statut: "en_attente", battementA: null });
    await planificateurHTTP.programmer(t.id, 0);
  }
  // Ménage des branches de compilation orphelines, au plus une fois toutes les 30 min.
  void menageThrottle();
  return liste.map((t) => t.id);
}

const CLE_MENAGE = "menage:branches:dernier";

async function menageThrottle(): Promise<void> {
  try {
    const kv = getKV();
    if (await kv.get<number>(CLE_MENAGE)) return; // un ménage récent tient encore
    await kv.set(CLE_MENAGE, Date.now(), 30 * 60); // verrou 30 min
    const r = await nettoyerBranchesCompilation();
    if (r.supprimees.length) console.warn(`[menage] branches supprimées : ${r.supprimees.join(", ")}`);
  } catch (e) {
    console.warn("[menage] échec :", e instanceof Error ? e.message : e);
  }
}
