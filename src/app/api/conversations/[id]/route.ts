import { NextResponse } from "next/server";
import { lireConversation, renommerConversation, supprimerConversation } from "@/lib/db/conversations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await lireConversation(id);
  if (!r) return NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
  return NextResponse.json(r);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { titre } = (await req.json().catch(() => ({}))) as { titre?: unknown };
  if (typeof titre !== "string" || !titre.trim()) return NextResponse.json({ erreur: "Titre manquant." }, { status: 400 });
  const ok = await renommerConversation(id, titre);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await supprimerConversation(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
}
