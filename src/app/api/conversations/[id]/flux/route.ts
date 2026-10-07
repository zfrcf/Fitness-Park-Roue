import { NextResponse } from "next/server";
import { getKV } from "@/lib/kv";
import { cleFlux, type FluxTache } from "@/lib/taches/flux";

export const dynamic = "force-dynamic";

/** Réponse en cours d'écriture par une tâche de fond (null s'il n'y en a pas). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ flux: null }, { status: 400 });
  const flux = await getKV()
    .get<FluxTache>(cleFlux(id))
    .catch(() => null);
  return NextResponse.json({ flux: flux && typeof flux.texte === "string" ? flux : null }, { headers: { "Cache-Control": "no-store" } });
}
