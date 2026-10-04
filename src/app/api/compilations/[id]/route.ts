import { NextResponse } from "next/server";
import { versPublic } from "@/lib/db/compilations";
import { rafraichirCompilation } from "@/lib/github/suivi";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{3,40}$/.test(id)) return NextResponse.json({ erreur: "Identifiant invalide." }, { status: 400 });
  const c = await rafraichirCompilation(id);
  if (!c) return NextResponse.json({ erreur: "Compilation introuvable." }, { status: 404 });
  return NextResponse.json({ compilation: versPublic(c) });
}
