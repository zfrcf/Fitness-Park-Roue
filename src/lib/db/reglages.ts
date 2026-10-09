import { eq } from "drizzle-orm";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { Reglages } from "@/lib/chat/types";
import { getDB } from "./index";
import { reglages } from "./schema";

/** Réglages de l'administrateur : « global » ; ceux d'un membre : « u:<id> ». */
export function cleReglages(proprietaire: string | null = null): string {
  return proprietaire === null ? "global" : `u:${proprietaire}`;
}

export async function lireReglages(proprietaire: string | null = null): Promise<Reglages> {
  const db = await getDB();
  const [l] = await db.select().from(reglages).where(eq(reglages.id, cleReglages(proprietaire))).limit(1);
  return normaliserReglages((l?.valeur ?? {}) as Partial<Reglages>);
}

export async function ecrireReglages(partiel: Partial<Reglages>, proprietaire: string | null = null): Promise<Reglages> {
  const db = await getDB();
  const ID = cleReglages(proprietaire);
  const actuels = await lireReglages(proprietaire);
  const nouveaux = normaliserReglages({ ...actuels, ...partiel });
  await db
    .insert(reglages)
    .values({ id: ID, valeur: nouveaux as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: reglages.id, set: { valeur: nouveaux as unknown as Record<string, unknown>, majA: new Date() } });
  return nouveaux;
}
