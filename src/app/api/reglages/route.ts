import { NextResponse } from "next/server";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { Reglages } from "@/lib/chat/types";
import { ecrireReglages, lireReglages } from "@/lib/db/reglages";
import { avecAcces, exigerUtilisateur, proprietaire } from "@/lib/auth/utilisateur";

export const dynamic = "force-dynamic";

export const GET = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  try {
    return NextResponse.json({ reglages: await lireReglages(proprietaire(u)) });
  } catch {
    // Base absente (par exemple DATABASE_URL non connectée) : valeurs par défaut, non persistantes.
    return NextResponse.json({ reglages: normaliserReglages(undefined), persistants: false });
  }
});

export const PUT = avecAcces(async (req: Request) => {
  const u = await exigerUtilisateur(req);
  const corps = (await req.json().catch(() => ({}))) as Partial<Reglages>;
  try {
    return NextResponse.json({ reglages: await ecrireReglages(corps, proprietaire(u)) });
  } catch (e) {
    return NextResponse.json(
      { erreur: `Réglages non enregistrés : ${e instanceof Error ? e.message : "base de données indisponible"}` },
      { status: 503 },
    );
  }
});
