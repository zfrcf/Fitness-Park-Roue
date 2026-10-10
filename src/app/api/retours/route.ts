import { NextResponse } from "next/server";
import { avecAcces, exigerConversation, exigerUtilisateur, proprietaire } from "@/lib/auth/utilisateur";
import { ajouterLecon, compterPoints, retirerLecon, retoursDeConversation } from "@/lib/db/lecons";
import { nettoyerNote, type TypeRetour } from "@/lib/comptes/lecons";

export const dynamic = "force-dynamic";

/** Points du compte, et (avec ?conversationId) les votes déjà posés dans cette conversation. */
export const GET = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  const points = await compterPoints(proprietaire(u)).catch(() => ({ bons: 0, mauvais: 0 }));
  if (conversationId) {
    await exigerConversation(u, conversationId);
    const votes = await retoursDeConversation(proprietaire(u), conversationId).catch(() => ({}));
    return NextResponse.json({ points, votes });
  }
  return NextResponse.json({ points });
});

/** Enregistre (ou retire) un bon/mauvais point sur une réponse, avec une note facultative. */
export const POST = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  const corps = ((await req.json().catch(() => ({}))) ?? {}) as { conversationId?: string; messageId?: string; note?: string; commentaire?: string };
  const { conversationId, messageId } = corps;
  if (typeof conversationId !== "string" || typeof messageId !== "string") return NextResponse.json({ erreur: "Requête invalide." }, { status: 400 });
  await exigerConversation(u, conversationId);
  const note = corps.note;
  if (note === "annuler") {
    await retirerLecon(proprietaire(u), messageId);
  } else if (note === "bon" || note === "mauvais") {
    await ajouterLecon({ proprietaire: proprietaire(u), type: note as TypeRetour, texte: nettoyerNote(corps.commentaire ?? ""), conversationId, messageId });
  } else {
    return NextResponse.json({ erreur: "Note invalide." }, { status: 400 });
  }
  return NextResponse.json({ points: await compterPoints(proprietaire(u)) });
});
