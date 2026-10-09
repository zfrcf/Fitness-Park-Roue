import { NextResponse } from "next/server";
import { avecAcces, exigerUtilisateur } from "@/lib/auth/utilisateur";
import { lireQuota } from "@/lib/comptes/quota";
import { getKV } from "@/lib/kv";

export const dynamic = "force-dynamic";

/** Compte connecté et son quota du jour. */
export const GET = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  const quota = u.admin ? null : await lireQuota(getKV(), u.id).catch(() => null);
  return NextResponse.json({ utilisateur: { id: u.id, nom: u.nom, email: u.email, admin: u.admin }, quota }, { headers: { "Cache-Control": "no-store" } });
});
