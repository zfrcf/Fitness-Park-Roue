import { desc, eq } from "drizzle-orm";
import { getDB } from "./index";
import { compilations } from "./schema";

export type Compilation = typeof compilations.$inferSelect;
export type StatutCompilation = "en_attente" | "en_cours" | "reussie" | "echouee" | "erreur";

export async function creerCompilation(c: typeof compilations.$inferInsert): Promise<Compilation> {
  const db = await getDB();
  const [l] = await db.insert(compilations).values(c).returning();
  return l;
}

export async function lireCompilation(id: string): Promise<Compilation | null> {
  const db = await getDB();
  const [l] = await db.select().from(compilations).where(eq(compilations.id, id)).limit(1);
  return l ?? null;
}

export async function compilationsDuMessage(messageId: string): Promise<Compilation[]> {
  const db = await getDB();
  return db.select().from(compilations).where(eq(compilations.messageId, messageId)).orderBy(desc(compilations.creeA));
}

export async function majCompilation(id: string, valeurs: Partial<typeof compilations.$inferInsert>): Promise<Compilation | null> {
  const db = await getDB();
  const [l] = await db
    .update(compilations)
    .set({ ...valeurs, majA: new Date() })
    .where(eq(compilations.id, id))
    .returning();
  return l ?? null;
}

/** Vue publique (sans journal complet si non demandé). */
export function versPublic(c: Compilation) {
  return {
    id: c.id,
    conversationId: c.conversationId,
    messageId: c.messageId,
    nom: c.nom,
    branche: c.branche,
    brancheUrl: c.brancheUrl,
    nbFichiers: c.nbFichiers,
    statut: c.statut as StatutCompilation,
    runUrl: c.runUrl,
    jarNom: c.jarNom,
    journal: c.journal,
    erreur: c.erreur,
    creeA: c.creeA.toISOString(),
    majA: c.majA.toISOString(),
  };
}
export type CompilationPublique = ReturnType<typeof versPublic>;
