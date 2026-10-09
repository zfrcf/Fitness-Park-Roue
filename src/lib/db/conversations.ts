import { and, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { MessageUI, MetaMessage } from "@/lib/chat/types";
import { getDB } from "./index";
import { conversations, messages } from "./schema";

export interface ResumeConversation {
  id: string;
  titre: string;
  fournisseurId: string | null;
  creeA: string;
  majA: string;
  nbMessages: number;
  /** Extrait du message correspondant à la recherche. */
  extrait?: string;
}

export function titreDepuisTexte(texte: string): string {
  const t = texte.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "Nouvelle conversation";
  return t.length > 60 ? t.slice(0, 57).trimEnd() + "…" : t;
}

/** Postgres rejette le caractère NUL (\u0000) ; on le retire des textes venus de PDF/pages lues. */
export function sansNul(v: string): string {
  return v.includes("\u0000") ? v.replace(/\u0000/g, "") : v;
}
export function assainirJson<T>(valeur: T): T {
  try {
    const s = JSON.stringify(valeur);
    // JSON.stringify échappe le NUL en « \u0000 » (6 caractères) : on retire cette séquence.
    return s.includes("\\u0000") ? (JSON.parse(s.replace(/\\u0000/g, "")) as T) : valeur;
  } catch {
    return valeur;
  }
}

function texteDesParties(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: string; text: string } => !!p && typeof p === "object" && (p as { type?: unknown }).type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Parties visibles d'un message : après le dernier marqueur de régénération, on jette le TEXTE
 * dégénéré qui précède, mais on garde les pastilles (pages lues, recherches) émises avant lui —
 * sinon elles seraient perdues à la persistance. (#23)
 */
function partiesVisibles(parts: MessageUI["parts"]): MessageUI["parts"] {
  const idx = parts.map((p) => p.type).lastIndexOf("data-regeneration");
  if (idx < 0) return parts;
  const avant = parts.slice(0, idx).filter((p) => p.type !== "text" && p.type !== "data-regeneration");
  return [...avant, ...parts.slice(idx + 1)];
}

/** Filtre « appartient à » : null = l'administrateur (conversations sans propriétaire). */
function duProprietaire(proprietaire: string | null) {
  return proprietaire === null ? isNull(conversations.utilisateurId) : eq(conversations.utilisateurId, proprietaire);
}

export async function listerConversations(recherche?: string, limite = 200, proprietaire: string | null = null): Promise<ResumeConversation[]> {
  const db = await getDB();
  const q = recherche?.trim();
  // Identifiants qualifiés explicitement : Drizzle retire les noms de table dans les sous-requêtes de projection.
  const nb = sql<number>`(SELECT count(*) FROM messages m WHERE m.conversation_id = conversations.id)`.mapWith(Number);
  if (!q) {
    const lignes = await db
      .select({ id: conversations.id, titre: conversations.titre, fournisseurId: conversations.fournisseurId, creeA: conversations.creeA, majA: conversations.majA, nbMessages: nb })
      .from(conversations)
      .where(duProprietaire(proprietaire))
      .orderBy(desc(conversations.majA))
      .limit(limite);
    return lignes.map((l) => ({ ...l, creeA: l.creeA.toISOString(), majA: l.majA.toISOString() }));
  }
  const motif = `%${q.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
  const ids = db
    .select({ id: messages.conversationId })
    .from(messages)
    .where(ilike(messages.contenu, motif));
  const lignes = await db
    .select({ id: conversations.id, titre: conversations.titre, fournisseurId: conversations.fournisseurId, creeA: conversations.creeA, majA: conversations.majA, nbMessages: nb })
    .from(conversations)
    .where(and(duProprietaire(proprietaire), or(ilike(conversations.titre, motif), inArray(conversations.id, ids))))
    .orderBy(desc(conversations.majA))
    .limit(limite);
  // Extraits : premier message correspondant par conversation.
  const extraits = lignes.length
    ? await db
        .select({ conversationId: messages.conversationId, contenu: messages.contenu })
        .from(messages)
        .where(and(inArray(messages.conversationId, lignes.map((l) => l.id)), ilike(messages.contenu, motif)))
        .orderBy(messages.ordre, messages.creeA, messages.id)
    : [];
  const parConv = new Map<string, string>();
  for (const e of extraits) {
    if (parConv.has(e.conversationId)) continue;
    const i = e.contenu.toLowerCase().indexOf(q.toLowerCase());
    const debut = Math.max(0, i - 40);
    parConv.set(e.conversationId, (debut > 0 ? "…" : "") + e.contenu.slice(debut, debut + 120).replace(/\s+/g, " ") + (e.contenu.length > debut + 120 ? "…" : ""));
  }
  return lignes.map((l) => ({ ...l, creeA: l.creeA.toISOString(), majA: l.majA.toISOString(), extrait: parConv.get(l.id) }));
}

/** Propriétaire d'une conversation (null = administrateur), ou `existe: false` si elle n'existe pas encore. */
export async function proprietaireConversation(id: string): Promise<{ existe: boolean; proprietaire: string | null }> {
  const db = await getDB();
  const [c] = await db.select({ u: conversations.utilisateurId }).from(conversations).where(eq(conversations.id, id)).limit(1);
  return c ? { existe: true, proprietaire: c.u } : { existe: false, proprietaire: null };
}

export async function lireConversation(id: string): Promise<{ conversation: ResumeConversation; messages: MessageUI[] } | null> {
  const db = await getDB();
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!c) return null;
  const lignes = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.ordre, messages.creeA, messages.id);
  return {
    conversation: { id: c.id, titre: c.titre, fournisseurId: c.fournisseurId, creeA: c.creeA.toISOString(), majA: c.majA.toISOString(), nbMessages: lignes.length },
    messages: lignes.map((l) => ({
      id: l.id,
      role: l.role as MessageUI["role"],
      parts: (l.parts as MessageUI["parts"]).length ? (l.parts as MessageUI["parts"]) : [{ type: "text", text: l.contenu }],
      metadata: l.meta ?? undefined,
    })),
  };
}

/** Crée la conversation si besoin et remplace ses messages par la liste fournie (source de vérité : le client). */
export async function enregistrerMessages(id: string, liste: MessageUI[], fournisseurId?: string, proprietaire: string | null = null): Promise<void> {
  const db = await getDB();
  const premierUtilisateur = liste.find((m) => m.role === "user");
  const titre = sansNul(titreDepuisTexte(premierUtilisateur ? texteDesParties(premierUtilisateur.parts) : ""));
  await db
    .insert(conversations)
    .values({ id, titre, fournisseurId: fournisseurId ?? null, utilisateurId: proprietaire })
    .onConflictDoUpdate({
      target: conversations.id,
      set: { majA: new Date(), ...(fournisseurId ? { fournisseurId } : {}) },
    });
  // Dédoublonnage par id (le dernier gagne), assainissement du caractère NUL.
  const parId = new Map<string, { ordre: number; row: typeof messages.$inferInsert }>();
  liste.forEach((m, i) => {
    const mid = m.id || `${id}-${i}`;
    const parts = assainirJson(partiesVisibles(m.parts));
    parId.set(mid, {
      ordre: i,
      row: {
        id: mid,
        conversationId: id,
        ordre: i,
        role: m.role,
        contenu: sansNul(texteDesParties(parts)),
        parts: parts as unknown[],
        meta: assainirJson((m.metadata as MetaMessage | undefined) ?? null),
      },
    });
  });
  const lignes = [...parId.values()].sort((a, b) => a.ordre - b.ordre).map((x) => x.row);
  const ids = lignes.map((l) => l.id!);
  // Upsert puis suppression des messages absents de la nouvelle liste : jamais de fenêtre « conversation vide ».
  if (lignes.length) {
    await db
      .insert(messages)
      .values(lignes)
      .onConflictDoUpdate({
        target: [messages.conversationId, messages.id],
        set: { ordre: sql`excluded.ordre`, role: sql`excluded.role`, contenu: sql`excluded.contenu`, parts: sql`excluded.parts`, meta: sql`excluded.meta` },
      });
    await db.delete(messages).where(and(eq(messages.conversationId, id), notInArray(messages.id, ids)));
  } else {
    await db.delete(messages).where(eq(messages.conversationId, id));
  }
}

/** Ajoute (ou remplace) un message en fin de conversation. */
export async function ajouterMessage(conversationId: string, m: MessageUI, fournisseurId?: string): Promise<void> {
  const db = await getDB();
  const parts = assainirJson(partiesVisibles(m.parts));
  const contenu = sansNul(texteDesParties(parts));
  const meta = assainirJson((m.metadata as MetaMessage | undefined) ?? null);
  // Ordre calculé dans l'INSERT (sous-requête) plutôt qu'en deux temps : réduit la fenêtre de course
  // où deux ajouts concurrents liraient le même max. Le tri de lecture départage par creeA+id. (#43)
  const ordre = sql<number>`(SELECT COALESCE(MAX(${messages.ordre}), -1) + 1 FROM ${messages} WHERE ${messages.conversationId} = ${conversationId})`;
  await db
    .insert(messages)
    .values({ id: m.id, conversationId, ordre, role: m.role, contenu, parts: parts as unknown[], meta })
    .onConflictDoUpdate({
      target: [messages.conversationId, messages.id],
      set: { contenu, parts: parts as unknown[], meta },
    });
  await db
    .update(conversations)
    .set({ majA: new Date(), ...(fournisseurId ? { fournisseurId } : {}) })
    .where(eq(conversations.id, conversationId));
}

export async function renommerConversation(id: string, titre: string): Promise<boolean> {
  const db = await getDB();
  const r = await db.update(conversations).set({ titre: titreDepuisTexte(titre) || "Sans titre" }).where(eq(conversations.id, id)).returning({ id: conversations.id });
  return r.length > 0;
}

export async function supprimerConversation(id: string): Promise<boolean> {
  const db = await getDB();
  const r = await db.delete(conversations).where(eq(conversations.id, id)).returning({ id: conversations.id });
  return r.length > 0;
}

/** Supprime toutes les conversations (et tâches) d'un compte membre. */
export async function supprimerConversationsDe(utilisateurId: string): Promise<number> {
  const db = await getDB();
  await db.execute(sql`DELETE FROM taches WHERE utilisateur_id = ${utilisateurId}`);
  const r = await db.delete(conversations).where(eq(conversations.utilisateurId, utilisateurId)).returning({ id: conversations.id });
  return r.length;
}

export async function toutExporter(proprietaire: string | null = null): Promise<Array<{ conversation: ResumeConversation; messages: MessageUI[] }>> {
  const liste = await listerConversations(undefined, 10_000, proprietaire);
  const resultat = [];
  for (const c of liste) {
    const r = await lireConversation(c.id);
    if (r) resultat.push(r);
  }
  return resultat;
}

/** Export Markdown d'une conversation. */
export function versMarkdown(c: ResumeConversation, liste: MessageUI[]): string {
  const lignes = [`# ${c.titre}`, "", `_Créée le ${new Date(c.creeA).toLocaleString("fr-FR")}_`, ""];
  for (const m of liste) {
    const texte = texteDesParties(m.parts);
    const meta = m.metadata as MetaMessage | undefined;
    lignes.push(`## ${m.role === "user" ? "Vous" : "Assistant"}`);
    if (m.role === "assistant" && meta?.fournisseur) {
      lignes.push(`_${meta.fournisseur} · ${meta.modele ?? ""}${meta.usage ? ` · ${meta.usage.entree}→${meta.usage.sortie} tokens` : ""}_`);
    }
    lignes.push("", texte, "");
  }
  return lignes.join("\n");
}
