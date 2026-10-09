import { NextResponse } from "next/server";
import { journaliser, lireTache, majTache, supprimerTache, versPublic } from "@/lib/db/taches";
import { planificateurHTTP } from "@/lib/taches/planificateur";
import { AccesRefuse, avecAcces, exigerUtilisateur, proprietaire } from "@/lib/auth/utilisateur";

/** La tâche du compte connecté, sinon « introuvable » (sans révéler qu'elle existe). */
async function tacheDe(req: Request, id: string) {
  const u = await exigerUtilisateur(req);
  const t = await lireTache(id).catch(() => null);
  if (!t || t.utilisateurId !== proprietaire(u)) throw new AccesRefuse(404, "Tâche introuvable.");
  return t;
}

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const t = await tacheDe(req, id);
  return NextResponse.json({ tache: versPublic(t) });
});

/** Actions : pause, reprendre, arreter, maxCycles (nombre de corrections, modifiable à tout moment). */
export const PATCH = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const t = await tacheDe(req, id);
  const { action, maxCycles } = ((await req.json().catch(() => ({}))) as { action?: string; maxCycles?: number }) ?? {};
  let maj = t;
  if (action === "maxCycles") {
    const n = Math.min(50, Math.max(1, Math.round(Number(maxCycles) || 0)));
    if (!n) return NextResponse.json({ erreur: "Nombre de corrections invalide." }, { status: 400 });
    maj = (await majTache(id, { maxCycles: n })) ?? t;
    await journaliser(id, `corrections max : ${n}`);
  } else if (action === "pause" && (t.statut === "en_attente" || t.statut === "en_cours")) {
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
});

export const DELETE = avecAcces(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await tacheDe(req, id);
  const ok = await supprimerTache(id).catch(() => false);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Tâche introuvable." }, { status: 404 });
});
