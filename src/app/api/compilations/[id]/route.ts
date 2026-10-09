import { NextResponse } from "next/server";
import { versPublic } from "@/lib/db/compilations";
import { rafraichirCompilation } from "@/lib/github/suivi";
import { lireCompilation } from "@/lib/db/compilations";
import { avecAcces, exigerConversation, exigerUtilisateur } from "@/lib/auth/utilisateur";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = avecAcces(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!/^[a-z0-9-]{3,40}$/.test(id)) return NextResponse.json({ erreur: "Identifiant invalide." }, { status: 400 });
  const avant = await lireCompilation(id);
  if (!avant) return NextResponse.json({ erreur: "Compilation introuvable." }, { status: 404 });
  await exigerConversation(await exigerUtilisateur(req), avant.conversationId);
  const c = await rafraichirCompilation(id);
  if (!c) return NextResponse.json({ erreur: "Compilation introuvable." }, { status: 404 });
  return NextResponse.json({ compilation: versPublic(c) });
});
