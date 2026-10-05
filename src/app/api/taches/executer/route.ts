/**
 * Exécute une tranche de travail d'une tâche. Appelée par le planificateur (jeton interne),
 * jamais par le navigateur. Répond tout de suite ; le travail continue en arrière-plan
 * (waitUntil) dans la limite de maxDuration.
 */
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { executerTacheMaintenant } from "@/lib/taches";
import { verifierJetonInterne } from "@/lib/taches/jeton";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!verifierJetonInterne(req.headers.get("x-tache-jeton"))) {
    return NextResponse.json({ erreur: "Jeton interne invalide." }, { status: 401 });
  }
  const { id } = ((await req.json().catch(() => ({}))) as { id?: string }) ?? {};
  if (typeof id !== "string" || !id) return NextResponse.json({ erreur: "id manquant" }, { status: 400 });
  const travail = executerTacheMaintenant(id).catch((e) => console.warn(`[taches] tranche ${id} :`, e instanceof Error ? e.message : e));
  try {
    waitUntil(travail);
  } catch {
    /* hors Vercel : la promesse tourne quand même */
  }
  return NextResponse.json({ ok: true, id }, { status: 202 });
}
