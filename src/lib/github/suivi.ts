/** Rafraîchit l'état d'une compilation depuis GitHub et persiste le résultat. */
import { lireCompilation, majCompilation, type Compilation } from "@/lib/db/compilations";
import { artefacts, extraireArtefact, resumerJournal, supprimerBranche, trouverRun } from "./compilation";

const TERMINAUX = new Set(["reussie", "echouee", "erreur"]);

export async function rafraichirCompilation(id: string): Promise<Compilation | null> {
  const c = await lireCompilation(id);
  if (!c) return null;
  if (TERMINAUX.has(c.statut)) return c;
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
    const jar = liste.find((a) => a.name === "jar" && !a.expired);
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
        jarNom = fichiers.find((f) => f.nom.endsWith(".jar") && !/-(sources|dev|javadoc)\.jar$/.test(f.nom))?.nom ?? fichiers[0]?.nom ?? null;
      } catch {
        jarNom = null;
      }
    }
    const statut = run.statut === "reussie" ? (jar ? "reussie" : "erreur") : "echouee";
    const maj = await majCompilation(id, {
      statut,
      runId: run.id,
      runUrl: run.url,
      journal,
      jarNom,
      jarArtefactId: jar?.id ?? null,
      erreur: statut === "erreur" ? "Compilation réussie mais aucun .jar publié (vérifiez build/libs)." : null,
    });
    void supprimerBranche(id);
    return maj ?? c;
  } catch (e) {
    return (await majCompilation(id, { statut: "erreur", erreur: e instanceof Error ? e.message : "erreur GitHub" })) ?? c;
  }
}
