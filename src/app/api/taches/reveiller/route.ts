/**
 * Réveil des tâches dues ou orphelines. Idempotent et verrouillé côté serveur. Dans PUBLICS du
 * proxy (le cron GitHub n'a pas de session) ; si REVEIL_TOKEN est défini, un jeton est exigé.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reveillerTaches } from "@/lib/taches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jetonOk(req: Request): boolean {
  const attendu = process.env.REVEIL_TOKEN?.trim();
  if (!attendu) return true; // pas de jeton configuré : on garde le cron fonctionnel
  const brut = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-reveil-jeton") ?? "";
  const a = Buffer.from(brut);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!jetonOk(req)) return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  try {
    const relancees = await reveillerTaches();
    return NextResponse.json({ relancees: relancees.length });
  } catch (e) {
    console.warn("[reveil]", e instanceof Error ? e.message : e);
    return NextResponse.json({ erreur: "base indisponible" }, { status: 503 });
  }
}
