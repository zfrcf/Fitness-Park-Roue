/** Stockage des retours (bons/mauvais points) et des leçons par compte. */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDB } from "./index";
import { lecons } from "./schema";
import type { Lecon, Points, TypeRetour } from "@/lib/comptes/lecons";

function filtre(proprietaire: string | null) {
  return proprietaire === null ? isNull(lecons.utilisateurId) : eq(lecons.utilisateurId, proprietaire);
}

export async function ajouterLecon(p: { proprietaire: string | null; type: TypeRetour; texte: string; conversationId?: string; messageId?: string }): Promise<void> {
  const db = await getDB();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(lecons).values({
    id,
    utilisateurId: p.proprietaire,
    type: p.type,
    texte: p.texte,
    conversationId: p.conversationId ?? null,
    messageId: p.messageId ?? null,
  });
  // Un seul retour par message : on retire les retours plus anciens du même message.
  if (p.messageId) {
    await db.delete(lecons).where(and(filtre(p.proprietaire), eq(lecons.messageId, p.messageId), sql`id <> ${id}`));
  }
}

/** Retire le retour d'un message précis (annulation d'un vote). */
export async function retirerLecon(proprietaire: string | null, messageId: string): Promise<void> {
  const db = await getDB();
  await db.delete(lecons).where(and(filtre(proprietaire), eq(lecons.messageId, messageId)));
}

/** Les leçons les plus récentes qui portent un texte (pour le prompt). */
export async function leconsPourPrompt(proprietaire: string | null, limite = 14): Promise<Lecon[]> {
  const db = await getDB();
  const lignes = await db
    .select({ type: lecons.type, texte: lecons.texte })
    .from(lecons)
    .where(and(filtre(proprietaire), sql`length(trim(texte)) > 0`))
    .orderBy(desc(lecons.creeA))
    .limit(limite);
  return lignes.map((l) => ({ type: l.type as TypeRetour, texte: l.texte })).reverse();
}

export async function compterPoints(proprietaire: string | null): Promise<Points> {
  const db = await getDB();
  const lignes = await db
    .select({ type: lecons.type, n: sql<number>`count(*)`.mapWith(Number) })
    .from(lecons)
    .where(filtre(proprietaire))
    .groupBy(lecons.type);
  return { bons: lignes.find((l) => l.type === "bon")?.n ?? 0, mauvais: lignes.find((l) => l.type === "mauvais")?.n ?? 0 };
}

/** Note d'un message précis pour un compte (pour réafficher l'état des boutons). */
export async function retoursDeConversation(proprietaire: string | null, conversationId: string): Promise<Record<string, TypeRetour>> {
  const db = await getDB();
  const lignes = await db
    .select({ messageId: lecons.messageId, type: lecons.type })
    .from(lecons)
    .where(and(filtre(proprietaire), eq(lecons.conversationId, conversationId)));
  const out: Record<string, TypeRetour> = {};
  for (const l of lignes) if (l.messageId) out[l.messageId] = l.type as TypeRetour;
  return out;
}
