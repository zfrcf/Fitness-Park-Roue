import { NextResponse } from "next/server";
import { avecAcces, exigerUtilisateur, proprietaire } from "@/lib/auth/utilisateur";
import { lireQuota } from "@/lib/comptes/quota";
import { compterPoints } from "@/lib/db/lecons";
import { getKV } from "@/lib/kv";

export const dynamic = "force-dynamic";

/** Compte connecté et son quota du jour. */
export const GET = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  const quota = u.admin ? null : await lireQuota(getKV(), u.id).catch(() => null);
  const points = await compterPoints(proprietaire(u)).catch(() => ({ bons: 0, mauvais: 0 }));
  return NextResponse.json({ utilisateur: { id: u.id, nom: u.nom, email: u.email, admin: u.admin }, quota, points }, { headers: { "Cache-Control": "no-store" } });
});
