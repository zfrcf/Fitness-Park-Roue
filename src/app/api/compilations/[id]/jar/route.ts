import { promises as fs } from "node:fs";
import { cheminJarLocal, estLocale } from "@/lib/compilation/locale";
import { lireCompilation } from "@/lib/db/compilations";
import { extraireArtefact } from "@/lib/github/compilation";
import { ErreurGitHub } from "@/lib/github/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function reponseJar(nom: string, contenu: Uint8Array): Response {
  return new Response(new Uint8Array(contenu), {
    headers: {
      "content-type": "application/java-archive",
      "content-disposition": `attachment; filename="${nom.replace(/[^\w.-]+/g, "_")}"`,
      "content-length": String(contenu.byteLength),
    },
  });
}

/**
 * Télécharge le .jar d'une compilation réussie : depuis le disque (atelier local) ou depuis
 * l'artefact GitHub (l'artefact lui-même exige une session GitHub, d'où ce relais).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await lireCompilation(id);
  if (!c || c.statut !== "reussie") return Response.json({ erreur: "Aucun .jar disponible." }, { status: 404 });
  if (estLocale(c)) {
    const chemin = cheminJarLocal(c);
    if (!chemin) return Response.json({ erreur: "Aucun .jar disponible." }, { status: 404 });
    try {
      return reponseJar(c.jarNom ?? "mod.jar", await fs.readFile(chemin));
    } catch {
      return Response.json({ erreur: "Le .jar n'est plus sur le disque : relancez la compilation." }, { status: 410 });
    }
  }
  if (!c.jarArtefactId) return Response.json({ erreur: "Aucun .jar disponible." }, { status: 404 });
  try {
    const fichiers = await extraireArtefact(c.jarArtefactId);
    const jar = fichiers.find((f) => f.nom === c.jarNom) ?? fichiers.find((f) => f.nom.endsWith(".jar"));
    if (!jar) return Response.json({ erreur: "Artefact sans .jar (expiré ?)." }, { status: 410 });
    return reponseJar(jar.nom, jar.contenu);
  } catch (e) {
    // Artefact expiré (14 jours) ou supprimé : GitHub répond 404/410 → message clair plutôt qu'un 502 brut. (#44)
    if (e instanceof ErreurGitHub && (e.statut === 404 || e.statut === 410)) {
      return Response.json({ erreur: "Artefact expiré ou supprimé (les artefacts GitHub durent 14 jours). Relancez la compilation." }, { status: 410 });
    }
    return Response.json({ erreur: e instanceof Error ? e.message : "téléchargement impossible" }, { status: 502 });
  }
}
