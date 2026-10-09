import { NextResponse } from "next/server";
import { lireConversation, renommerConversation, supprimerConversation } from "@/lib/db/conversations";
import { supprimerTachesDeConversation } from "@/lib/db/taches";
import { avecAcces, exigerConversation, exigerUtilisateur, } from "@/lib/auth/utilisateur";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigerConversation(await exigerUtilisateur(req), id);
  const r = await lireConversation(id);
  if (!r) return NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
  return NextResponse.json(r);
});

export const PATCH = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigerConversation(await exigerUtilisateur(req), id);
  const { titre } = (await req.json().catch(() => ({}))) as { titre?: unknown };
  if (typeof titre !== "string" || !titre.trim()) return NextResponse.json({ erreur: "Titre manquant." }, { status: 400 });
  const ok = await renommerConversation(id, titre);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
});

export const DELETE = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await exigerConversation(await exigerUtilisateur(req), id);
  // On retire d'abord les tâches de fond liées : sinon une tâche active ressuscite la conversation
  // et consomme du quota en boucle (#27).
  await supprimerTachesDeConversation(id).catch(() => 0);
  const ok = await supprimerConversation(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
});
