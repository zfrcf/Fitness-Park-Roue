import { eq } from "drizzle-orm";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { Reglages } from "@/lib/chat/types";
import { getDB } from "./index";
import { reglages } from "./schema";

const ID = "global";

export async function lireReglages(): Promise<Reglages> {
  const db = await getDB();
  const [l] = await db.select().from(reglages).where(eq(reglages.id, ID)).limit(1);
  return normaliserReglages((l?.valeur ?? {}) as Partial<Reglages>);
}

export async function ecrireReglages(partiel: Partial<Reglages>): Promise<Reglages> {
  const db = await getDB();
  const actuels = await lireReglages();
  const nouveaux = normaliserReglages({ ...actuels, ...partiel });
  await db
    .insert(reglages)
    .values({ id: ID, valeur: nouveaux as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: reglages.id, set: { valeur: nouveaux as unknown as Record<string, unknown>, majA: new Date() } });
  return nouveaux;
}
