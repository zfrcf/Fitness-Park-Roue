import { NextResponse } from "next/server";
import { avecAcces, exigerAdmin, oublierCompte } from "@/lib/auth/utilisateur";
import { lireQuota } from "@/lib/comptes/quota";
import { modeVerification } from "@/lib/comptes/inscription";
import { supprimerConversationsDe } from "@/lib/db/conversations";
import { listerUtilisateurs, majUtilisateur, supprimerUtilisateur, versPublic } from "@/lib/db/utilisateurs";
import { getKV } from "@/lib/kv";

export const dynamic = "force-dynamic";

export const GET = avecAcces(async (req: Request) => {
  await exigerAdmin(req);
  const kv = getKV();
  const liste = await listerUtilisateurs();
  const comptes = await Promise.all(liste.map(async (u) => ({ ...versPublic(u), quota: await lireQuota(kv, u.id).catch(() => null) })));
  return NextResponse.json({ comptes, verification: modeVerification(), inscriptionsFermees: process.env.INSCRIPTIONS_FERMEES === "1" });
});

/** Actions : valider, bloquer, debloquer. */
export const PATCH = avecAcces(async (req: Request) => {
  await exigerAdmin(req);
  const { id, action } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: string; action?: string };
  if (!id) return NextResponse.json({ erreur: "Compte manquant." }, { status: 400 });
  const statut = action === "valider" || action === "debloquer" ? "actif" : action === "bloquer" ? "bloque" : null;
  if (!statut) return NextResponse.json({ erreur: "Action inconnue." }, { status: 400 });
  const u = await majUtilisateur(id, { statut });
  await oublierCompte(id);
  return u ? NextResponse.json({ compte: versPublic(u) }) : NextResponse.json({ erreur: "Compte introuvable." }, { status: 404 });
});

/** Suppression d'un compte et de ses conversations. */
export const DELETE = avecAcces(async (req: Request) => {
  await exigerAdmin(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ erreur: "Compte manquant." }, { status: 400 });
  await supprimerConversationsDe(id);
  const ok = await supprimerUtilisateur(id);
  await oublierCompte(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ erreur: "Compte introuvable." }, { status: 404 });
});
