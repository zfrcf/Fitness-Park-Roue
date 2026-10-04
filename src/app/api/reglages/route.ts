import { NextResponse } from "next/server";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { Reglages } from "@/lib/chat/types";
import { ecrireReglages, lireReglages } from "@/lib/db/reglages";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ reglages: await lireReglages() });
  } catch {
    // Base absente (par exemple DATABASE_URL non connectée) : valeurs par défaut, non persistantes.
    return NextResponse.json({ reglages: normaliserReglages(undefined), persistants: false });
  }
}

export async function PUT(req: Request) {
  const corps = (await req.json().catch(() => ({}))) as Partial<Reglages>;
  try {
    return NextResponse.json({ reglages: await ecrireReglages(corps) });
  } catch (e) {
    return NextResponse.json(
      { erreur: `Réglages non enregistrés : ${e instanceof Error ? e.message : "base de données indisponible"}` },
      { status: 503 },
    );
  }
}
