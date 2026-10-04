import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
  const t = texte.replace(/\s+/g, " ").trim();
  if (!t) return "Nouvelle conversation";
  return t.length > 60 ? t.slice(0, 57).trimEnd() + "…" : t;
}

function texteDesParties(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: string; text: string } => !!p && typeof p === "object" && (p as { type?: unknown }).type === "text")
    .map((p) => p.text)
    .join("");
}

/** Parties visibles d'un message (après le dernier marqueur de régénération). */
function partiesVisibles(parts: MessageUI["parts"]): MessageUI["parts"] {
  const idx = parts.map((p) => p.type).lastIndexOf("data-regeneration");
  return idx >= 0 ? parts.slice(idx + 1) : parts;
}

export async function listerConversations(recherche?: string, limite = 200): Promise<ResumeConversation[]> {
  const db = await getDB();
  const q = recherche?.trim();
  // Identifiants qualifiés explicitement : Drizzle retire les noms de table dans les sous-requêtes de projection.
  const nb = sql<number>`(SELECT count(*) FROM messages m WHERE m.conversation_id = conversations.id)`.mapWith(Number);
  if (!q) {
    const lignes = await db
      .select({ id: conversations.id, titre: conversations.titre, fournisseurId: conversations.fournisseurId, creeA: conversations.creeA, majA: conversations.majA, nbMessages: nb })
      .from(conversations)
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
    .where(or(ilike(conversations.titre, motif), inArray(conversations.id, ids)))
    .orderBy(desc(conversations.majA))
    .limit(limite);
  // Extraits : premier message correspondant par conversation.
  const extraits = lignes.length
    ? await db
        .select({ conversationId: messages.conversationId, contenu: messages.contenu })
        .from(messages)
        .where(and(inArray(messages.conversationId, lignes.map((l) => l.id)), ilike(messages.contenu, motif)))
        .orderBy(messages.ordre)
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

export async function lireConversation(id: string): Promise<{ conversation: ResumeConversation; messages: MessageUI[] } | null> {
  const db = await getDB();
  const [c] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!c) return null;
  const lignes = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.ordre);
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
export async function enregistrerMessages(id: string, liste: MessageUI[], fournisseurId?: string): Promise<void> {
  const db = await getDB();
  const premierUtilisateur = liste.find((m) => m.role === "user");
  const titre = titreDepuisTexte(premierUtilisateur ? texteDesParties(premierUtilisateur.parts) : "");
  await db
    .insert(conversations)
    .values({ id, titre, fournisseurId: fournisseurId ?? null })
    .onConflictDoUpdate({
      target: conversations.id,
      set: { majA: new Date(), ...(fournisseurId ? { fournisseurId } : {}) },
    });
  await db.delete(messages).where(eq(messages.conversationId, id));
  if (liste.length === 0) return;
  await db.insert(messages).values(
    liste.map((m, i) => {
      const parts = partiesVisibles(m.parts);
      return {
        id: m.id || `${id}-${i}`,
        conversationId: id,
        ordre: i,
        role: m.role,
        contenu: texteDesParties(parts),
        parts: parts as unknown[],
        meta: (m.metadata as MetaMessage | undefined) ?? null,
      };
    }),
  );
}

/** Ajoute (ou remplace) un message en fin de conversation. */
export async function ajouterMessage(conversationId: string, m: MessageUI, fournisseurId?: string): Promise<void> {
  const db = await getDB();
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${messages.ordre}), -1)`.mapWith(Number) })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  const parts = partiesVisibles(m.parts);
  await db
    .insert(messages)
    .values({
      id: m.id,
      conversationId,
      ordre: max + 1,
      role: m.role,
      contenu: texteDesParties(parts),
      parts: parts as unknown[],
      meta: (m.metadata as MetaMessage | undefined) ?? null,
    })
    .onConflictDoUpdate({
      target: messages.id,
      set: { contenu: texteDesParties(parts), parts: parts as unknown[], meta: (m.metadata as MetaMessage | undefined) ?? null },
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

export async function toutExporter(): Promise<Array<{ conversation: ResumeConversation; messages: MessageUI[] }>> {
  const liste = await listerConversations(undefined, 10_000);
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
