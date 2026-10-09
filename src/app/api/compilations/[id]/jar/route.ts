import { promises as fs } from "node:fs";
import path from "node:path";
import { dossierProduits, estLocale, listerFichiers } from "@/lib/compilation/locale";
import { fichierATelecharger, typeMime, type FichierProduit } from "@/lib/compilation/sortie";
import { lireCompilation } from "@/lib/db/compilations";
import { extraireArtefact } from "@/lib/github/compilation";
import { ErreurGitHub } from "@/lib/github/api";
import { avecAcces, exigerConversation, exigerUtilisateur } from "@/lib/auth/utilisateur";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function reponseFichier(f: FichierProduit): Response {
  return new Response(new Uint8Array(f.contenu), {
    headers: {
      "content-type": typeMime(f.nom),
      "content-disposition": `attachment; filename="${f.nom.replace(/[^\w.-]+/g, "_")}"`,
      "content-length": String(f.contenu.byteLength),
    },
  });
}

const AUCUN = () => Response.json({ erreur: "Aucun fichier à télécharger pour cette compilation." }, { status: 404 });

/**
 * Télécharge ce qu'a produit une compilation réussie (.jar, exécutable, ou archive .zip de
 * plusieurs fichiers) : depuis le disque (atelier local) ou depuis l'artefact GitHub (l'artefact
 * lui-même exige une session GitHub, d'où ce relais). La route garde son nom « jar » historique.
 */
export const GET = avecAcces(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await lireCompilation(id);
  if (!c || c.statut !== "reussie" || !c.jarNom) return AUCUN();
  await exigerConversation(await exigerUtilisateur(req), c.conversationId);
  if (estLocale(c)) {
    const dossier = dossierProduits(c.id);
    const noms = await listerFichiers(dossier);
    if (!noms.length) return Response.json({ erreur: "Les fichiers produits ne sont plus sur le disque : relancez la compilation." }, { status: 410 });
    const fichiers = await Promise.all(noms.map(async (nom) => ({ nom, contenu: new Uint8Array(await fs.readFile(path.join(dossier, nom))) })));
    const f = await fichierATelecharger(fichiers, c.jarNom);
    return f ? reponseFichier(f) : AUCUN();
  }
  if (!c.jarArtefactId) return AUCUN();
  try {
    const fichiers = (await extraireArtefact(c.jarArtefactId)).map((f) => ({ nom: f.nom, contenu: new Uint8Array(f.contenu) }));
    const f = await fichierATelecharger(fichiers, c.jarNom);
    if (!f) return Response.json({ erreur: "Artefact vide (expiré ?)." }, { status: 410 });
    return reponseFichier(f);
  } catch (e) {
    // Artefact expiré (14 jours) ou supprimé : GitHub répond 404/410 → message clair plutôt qu'un 502 brut. (#44)
    if (e instanceof ErreurGitHub && (e.statut === 404 || e.statut === 410)) {
      return Response.json({ erreur: "Artefact expiré ou supprimé (les artefacts GitHub durent 14 jours). Relancez la compilation." }, { status: 410 });
    }
    return Response.json({ erreur: e instanceof Error ? e.message : "téléchargement impossible" }, { status: 502 });
  }
});
