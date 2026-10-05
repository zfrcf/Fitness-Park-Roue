/**
 * Réveil des tâches dues ou orphelines. Public (aucune donnée exposée, action idempotente) :
 * appelé par le workflow GitHub `.github/workflows/reveil.yml` toutes les 10 minutes.
 */
import { NextResponse } from "next/server";
import { reveillerTaches } from "@/lib/taches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function reveiller() {
  try {
    const relancees = await reveillerTaches();
    return NextResponse.json({ relancees: relancees.length });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "base indisponible" }, { status: 503 });
  }
}

export const GET = reveiller;
export const POST = reveiller;
