import { NextResponse } from "next/server";
import { journaliser, lireTache, majTache, supprimerTache, versPublic } from "@/lib/db/taches";
import { planificateurHTTP } from "@/lib/taches/planificateur";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const t = await lireTache(id).catch(() => null);
  if (!t) return NextResponse.json({ erreur: "Tâche introuvable." }, { status: 404 });
  return NextResponse.json({ tache: versPublic(t) });
}

/** Actions : pause, reprendre, arreter. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { action } = ((await req.json().catch(() => ({}))) as { action?: string }) ?? {};
  const t = await lireTache(id).catch(() => null);
  if (!t) return NextResponse.json({ erreur: "Tâche introuvable." }, { status: 404 });
  let maj = t;
  if (action === "pause" && (t.statut === "en_attente" || t.statut === "en_cours")) {
    maj = (await majTache(id, { statut: "pause", etape: "en pause", battementA: null, repriseA: null })) ?? t;
    await journaliser(id, "mise en pause");
  } else if (action === "reprendre" && (t.statut === "pause" || t.statut === "echouee" || t.statut === "arretee")) {
    maj = (await majTache(id, { statut: "en_attente", etape: "reprise", battementA: null, repriseA: null, erreur: null, compilationId: null })) ?? t;
    await journaliser(id, "reprise demandée");
    await planificateurHTTP.programmer(id, 0);
  } else if (action === "arreter" && t.statut !== "terminee") {
    maj = (await majTache(id, { statut: "arretee", etape: "arrêtée", battementA: null, repriseA: null })) ?? t;
    await journaliser(id, "arrêtée");
  } else {
    return NextResponse.json({ erreur: "Action impossible dans cet état." }, { status: 409 });
  }
  return NextResponse.json({ tache: versPublic(maj) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await supprimerTache(id).catch(() => false);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Tâche introuvable." }, { status: 404 });
}
