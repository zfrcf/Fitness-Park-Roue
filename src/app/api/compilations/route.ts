import { NextResponse } from "next/server";
import { compilationsDuMessage, versPublic } from "@/lib/db/compilations";
import type { FichierGenere } from "@/lib/fichiers/extraire";
import { ErreurGitHub } from "@/lib/github/api";
import { lancerCompilationProjet, ProjetRefuse } from "@/lib/github/lancer";

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
  try {
    const c = await lancerCompilationProjet({ conversationId: corps.conversationId, messageId: corps.messageId, fichiers });
    return NextResponse.json({ compilation: versPublic(c) });
  } catch (e) {
    if (e instanceof ProjetRefuse) return NextResponse.json({ erreur: e.message }, { status: 400 });
    const message = e instanceof Error ? e.message : "échec";
    // Base indisponible (création impossible) → 503 ; envoi GitHub impossible → 502 avec la compilation en erreur.
    if (e instanceof ErreurGitHub) {
      const derniere = (await compilationsDuMessage(corps.messageId).catch(() => []))[0];
      return NextResponse.json(derniere ? { compilation: versPublic(derniere) } : { erreur: message }, { status: 502 });
    }
    return NextResponse.json({ erreur: `Base de données indisponible : ${message}` }, { status: 503 });
  }
}
