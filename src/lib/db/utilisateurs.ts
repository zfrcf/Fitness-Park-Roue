/** Comptes utilisateurs (inscription, connexion, administration). */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDB } from "./index";
import { utilisateurs } from "./schema";

export type Utilisateur = typeof utilisateurs.$inferSelect;
export type StatutCompte = "en_attente" | "actif" | "bloque";

export async function creerUtilisateur(u: typeof utilisateurs.$inferInsert): Promise<Utilisateur> {
  const db = await getDB();
  const [cree] = await db.insert(utilisateurs).values(u).returning();
  return cree;
}

export async function lireUtilisateur(id: string): Promise<Utilisateur | null> {
  const db = await getDB();
  const [u] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, id)).limit(1);
  return u ?? null;
}

export async function utilisateurParEmail(emailNormalise: string): Promise<Utilisateur | null> {
  const db = await getDB();
  const [u] = await db.select().from(utilisateurs).where(eq(utilisateurs.emailNormalise, emailNormalise)).limit(1);
  return u ?? null;
}

/** Comptes créés depuis `depuis` avec l'un de ces appareils ou cette empreinte d'IP. */
export async function comptesRecents(appareils: string[], ipHash: string | null, depuis: Date): Promise<{ parAppareil: number; parIp: number }> {
  const db = await getDB();
  const recents = await db
    .select({ appareils: utilisateurs.appareils, ipHash: utilisateurs.ipHash })
    .from(utilisateurs)
    .where(gt(utilisateurs.creeA, depuis));
  const voulus = new Set(appareils.filter(Boolean));
  return {
    parAppareil: recents.filter((r) => (r.appareils ?? []).some((a) => voulus.has(a))).length,
    parIp: ipHash ? recents.filter((r) => r.ipHash === ipHash).length : 0,
  };
}

export async function majUtilisateur(id: string, valeurs: Partial<typeof utilisateurs.$inferInsert>): Promise<Utilisateur | null> {
  const db = await getDB();
  const [u] = await db.update(utilisateurs).set(valeurs).where(eq(utilisateurs.id, id)).returning();
  return u ?? null;
}

export async function listerUtilisateurs(): Promise<Utilisateur[]> {
  const db = await getDB();
  return db.select().from(utilisateurs).orderBy(desc(utilisateurs.creeA)).limit(1000);
}

export async function supprimerUtilisateur(id: string): Promise<boolean> {
  const db = await getDB();
  const r = await db.delete(utilisateurs).where(and(eq(utilisateurs.id, id), sql`role <> 'admin'`)).returning({ id: utilisateurs.id });
  return r.length > 0;
}

/** Vue publique d'un compte (jamais le hachage ni l'empreinte d'IP). */
export function versPublic(u: Utilisateur) {
  return { id: u.id, email: u.email, nom: u.nom, role: u.role, statut: u.statut as StatutCompte, creeA: u.creeA.toISOString(), derniereConnexion: u.derniereConnexion?.toISOString() ?? null };
}
