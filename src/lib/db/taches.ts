import { desc, eq, sql } from "drizzle-orm";
import { getDB } from "./index";
import { taches } from "./schema";

export type Tache = typeof taches.$inferSelect;
export type StatutTache = "en_attente" | "en_cours" | "pause" | "terminee" | "echouee" | "arretee";
export const STATUTS_ACTIFS: StatutTache[] = ["en_attente", "en_cours"];

export async function creerTache(t: typeof taches.$inferInsert): Promise<Tache> {
  const db = await getDB();
  const [l] = await db.insert(taches).values(t).returning();
  return l;
}

export async function lireTache(id: string): Promise<Tache | null> {
  const db = await getDB();
  const [l] = await db.select().from(taches).where(eq(taches.id, id)).limit(1);
  return l ?? null;
}

/** Dernière tâche attachée à une conversation (active de préférence). */
export async function tacheDeConversation(conversationId: string): Promise<Tache | null> {
  const db = await getDB();
  const liste = await db.select().from(taches).where(eq(taches.conversationId, conversationId)).orderBy(desc(taches.majA)).limit(5);
  return liste.find((t) => t.statut === "en_cours" || t.statut === "en_attente") ?? liste[0] ?? null;
}

export async function listerTaches(limite = 100): Promise<Tache[]> {
  const db = await getDB();
  return db.select().from(taches).orderBy(desc(taches.majA)).limit(limite);
}

export async function majTache(id: string, valeurs: Partial<typeof taches.$inferInsert>): Promise<Tache | null> {
  const db = await getDB();
  const [l] = await db
    .update(taches)
    .set({ ...valeurs, majA: new Date() })
    .where(eq(taches.id, id))
    .returning();
  return l ?? null;
}

/** Ajoute une ligne au journal de la tâche (50 dernières conservées). */
export async function journaliser(id: string, texte: string): Promise<void> {
  const t = await lireTache(id);
  if (!t) return;
  const journal = [...t.journal, { a: Date.now(), texte }].slice(-50);
  await majTache(id, { journal });
}

export async function supprimerTache(id: string): Promise<boolean> {
  const db = await getDB();
  const r = await db.delete(taches).where(eq(taches.id, id)).returning({ id: taches.id });
  return r.length > 0;
}

/** Supprime toutes les tâches d'une conversation (appelé quand la conversation est supprimée). */
export async function supprimerTachesDeConversation(conversationId: string): Promise<number> {
  const db = await getDB();
  const r = await db.delete(taches).where(eq(taches.conversationId, conversationId)).returning({ id: taches.id });
  return r.length;
}

/** Tâches à (re)lancer : en attente et dues, ou en cours sans signe de vie depuis `orphelineMs`. */
export async function tachesAReveiller(maintenant = Date.now(), orphelineMs = 6 * 60_000): Promise<Tache[]> {
  const db = await getDB();
  const liste = await db
    .select()
    .from(taches)
    .where(sql`${taches.statut} IN ('en_attente', 'en_cours')`);
  return liste.filter((t) => {
    if (t.statut === "en_attente") return !t.repriseA || t.repriseA.getTime() <= maintenant;
    return !t.battementA || maintenant - t.battementA.getTime() > orphelineMs;
  });
}

export function versPublic(t: Tache) {
  return {
    id: t.id,
    conversationId: t.conversationId,
    titre: t.titre,
    objectif: t.objectif,
    compiler: t.compiler === 1,
    auto: t.auto === 1,
    statut: t.statut as StatutTache,
    etape: t.etape,
    cycles: t.cycles,
    maxCycles: t.maxCycles,
    compilationId: t.compilationId,
    fournisseurId: t.fournisseurId,
    tokensEntree: t.tokensEntree,
    tokensSortie: t.tokensSortie,
    jarNom: t.jarNom,
    jarCompilationId: t.jarCompilationId,
    erreur: t.erreur,
    journal: t.journal,
    repriseA: t.repriseA?.getTime() ?? null,
    battementA: t.battementA?.getTime() ?? null,
    creeA: t.creeA.getTime(),
    majA: t.majA.getTime(),
  };
}
export type TachePublique = ReturnType<typeof versPublic>;
