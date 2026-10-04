import { lireCompilation } from "@/lib/db/compilations";
import { extraireArtefact } from "@/lib/github/compilation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Télécharge le .jar depuis l'artefact GitHub et le transmet (l'artefact lui-même exige une session GitHub). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await lireCompilation(id);
  if (!c || c.statut !== "reussie" || !c.jarArtefactId) return Response.json({ erreur: "Aucun .jar disponible." }, { status: 404 });
  try {
    const fichiers = await extraireArtefact(c.jarArtefactId);
    const jar = fichiers.find((f) => f.nom === c.jarNom) ?? fichiers.find((f) => f.nom.endsWith(".jar"));
    if (!jar) return Response.json({ erreur: "Artefact sans .jar (expiré ?)." }, { status: 410 });
    return new Response(new Uint8Array(jar.contenu), {
      headers: {
        "content-type": "application/java-archive",
        "content-disposition": `attachment; filename="${jar.nom.replace(/[^\w.-]+/g, "_")}"`,
        "content-length": String(jar.contenu.byteLength),
      },
    });
  } catch (e) {
    return Response.json({ erreur: e instanceof Error ? e.message : "téléchargement impossible" }, { status: 502 });
  }
}
