import { NextResponse } from "next/server";
import { compilationsDuMessage, creerCompilation, majCompilation, versPublic } from "@/lib/db/compilations";
import type { FichierGenere } from "@/lib/fichiers/extraire";
import { nomArchive } from "@/lib/fichiers/extraire";
import { creerBranche, retirerReserves, validerFichiers } from "@/lib/github/compilation";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const messageId = new URL(req.url).searchParams.get("messageId");
  if (!messageId) return NextResponse.json({ erreur: "messageId manquant." }, { status: 400 });
  try {
    return NextResponse.json({ compilations: (await compilationsDuMessage(messageId)).map(versPublic) });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "base indisponible" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const corps = (await req.json().catch(() => null)) as { conversationId?: string; messageId?: string; fichiers?: FichierGenere[] } | null;
  if (!corps || typeof corps.conversationId !== "string" || typeof corps.messageId !== "string" || !Array.isArray(corps.fichiers)) {
    return NextResponse.json({ erreur: "Requête invalide." }, { status: 400 });
  }
  const fichiers = corps.fichiers
    .filter((f) => f && typeof f.chemin === "string" && typeof f.contenu === "string")
    .map((f) => ({ chemin: f.chemin, contenu: f.contenu }));
  const fichiersPropres = retirerReserves(fichiers);
  const erreurs = validerFichiers(fichiersPropres);
  if (erreurs.length) return NextResponse.json({ erreur: `Projet refusé : ${erreurs.join(" ; ")}` }, { status: 400 });

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const nom = nomArchive(fichiersPropres, "projet");
  let c;
  try {
    c = await creerCompilation({ id, conversationId: corps.conversationId.slice(0, 64), messageId: corps.messageId.slice(0, 64), nom, branche: `compilation/${id}`, nbFichiers: fichiersPropres.length });
  } catch (e) {
    return NextResponse.json({ erreur: `Base de données indisponible : ${e instanceof Error ? e.message : ""}` }, { status: 503 });
  }
  try {
    const b = await creerBranche(id, fichiersPropres, nom);
    c = (await majCompilation(id, { brancheUrl: b.url })) ?? c;
  } catch (e) {
    c = (await majCompilation(id, { statut: "erreur", erreur: e instanceof Error ? e.message : "échec de l'envoi sur GitHub" })) ?? c;
    return NextResponse.json({ compilation: versPublic(c) }, { status: 502 });
  }
  return NextResponse.json({ compilation: versPublic(c) });
}
