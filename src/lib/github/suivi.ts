/** Rafraîchit l'état d'une compilation depuis GitHub et persiste le résultat. */
import { lireCompilation, majCompilation, type Compilation } from "@/lib/db/compilations";
import { artefacts, extraireArtefact, resumerJournal, supprimerBranche, trouverRun } from "./compilation";
import { ErreurGitHub } from "./api";
import { estLocale, rafraichirLocale } from "@/lib/compilation/locale";
import { nomProduit } from "@/lib/compilation/sortie";

const TERMINAUX = new Set(["reussie", "echouee", "erreur"]);

export async function rafraichirCompilation(id: string): Promise<Compilation | null> {
  const c = await lireCompilation(id);
  if (!c) return null;
  if (TERMINAUX.has(c.statut)) return c;
  if (estLocale(c)) return rafraichirLocale(c);
  // Un run qui n'apparaît pas au bout de 10 minutes : GitHub n'a pas déclenché le workflow.
  const age = Date.now() - c.creeA.getTime();
  try {
    const run = await trouverRun(id);
    if (!run) {
      if (age > 10 * 60_000) {
        return (await majCompilation(id, { statut: "erreur", erreur: "Aucune exécution GitHub Actions trouvée pour cette branche : vérifiez que les Actions sont activées sur le dépôt." })) ?? c;
      }
      return c;
    }
    if (run.statut === "en_attente" || run.statut === "en_cours") {
      if (age > 40 * 60_000) {
        return (await majCompilation(id, { statut: "erreur", runId: run.id, runUrl: run.url, erreur: "La compilation dépasse 40 minutes : abandon du suivi." })) ?? c;
      }
      return (await majCompilation(id, { statut: run.statut, runId: run.id, runUrl: run.url })) ?? c;
    }
    // Terminé : artefacts.
    const liste = await artefacts(run.id);
    // « resultat » : fichiers produits par le script universel ; « jar » : branches lancées avant lui.
    const jar = liste.find((a) => a.name === "resultat" && !a.expired) ?? liste.find((a) => a.name === "jar" && !a.expired);
    const journalArt = liste.find((a) => a.name === "journal" && !a.expired);
    let journal: string | null = null;
    if (journalArt) {
      try {
        const fichiers = await extraireArtefact(journalArt.id);
        const brut = fichiers[0]?.contenu.toString("utf8") ?? "";
        journal = run.statut === "reussie" ? brut.split("\n").slice(-15).join("\n") : resumerJournal(brut);
      } catch (e) {
        journal = `Journal indisponible : ${e instanceof Error ? e.message : "erreur"}`;
      }
    }
    let jarNom: string | null = null;
    if (run.statut === "reussie" && jar) {
      try {
        const fichiers = await extraireArtefact(jar.id);
        jarNom = nomProduit(
          fichiers.map((f) => f.nom),
          c.nom,
        );
      } catch {
        jarNom = null;
      }
    }
    const sansJournal = run.statut === "echouee" && !journalArt;
    const statut = run.statut === "reussie" ? (jar ? "reussie" : "erreur") : sansJournal ? "erreur" : "echouee";
    const erreur =
      statut !== "erreur"
        ? null
        : !jar && run.statut === "reussie"
          ? "Construction réussie mais aucun résultat publié par GitHub."
          : `Le run GitHub s'est terminé (${run.conclusion ?? "sans conclusion"}) avant l'étape de compilation : aucun journal publié. Consultez le lien du run puis relancez.`;
    const maj = await majCompilation(id, { statut, runId: run.id, runUrl: run.url, journal, jarNom, jarArtefactId: jar?.id ?? null, erreur });
    void supprimerBranche(id);
    return maj ?? c;
  } catch (e) {
    // Une erreur passagère (5xx, timeout, 403 rate-limit) ne doit pas figer la compilation en « erreur ».
    const definitif = e instanceof ErreurGitHub && (e.statut === 401 || e.statut === 404 || (e.statut === 403 && !/rate limit|secondary|abuse/i.test(e.message)));
    if (!definitif && age <= 40 * 60_000) {
      console.warn("[compilation] sondage GitHub échoué, nouvel essai :", e instanceof Error ? e.message : e);
      return c;
    }
    const message = definitif ? (e instanceof Error ? e.message : "erreur GitHub") : `Suivi GitHub impossible depuis plus de 40 min : ${e instanceof Error ? e.message : "erreur"}`;
    return (await majCompilation(id, { statut: "erreur", erreur: message })) ?? c;
  }
}
