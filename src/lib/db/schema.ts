import { index, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import type { MetaMessage } from "@/lib/chat/types";

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    titre: text("titre").notNull().default("Nouvelle conversation"),
    fournisseurId: text("fournisseur_id"),
    creeA: timestamp("cree_a", { withTimezone: true }).notNull().defaultNow(),
    majA: timestamp("maj_a", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_maj_idx").on(t.majA)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    ordre: integer("ordre").notNull(),
    role: text("role").notNull(), // user | assistant | system
    /** Texte brut (pour la recherche et l'export). */
    contenu: text("contenu").notNull().default(""),
    /** Parties UI (texte, pages lues, …). */
    parts: jsonb("parts").$type<unknown[]>().notNull().default([]),
    meta: jsonb("meta").$type<MetaMessage | null>(),
    creeA: timestamp("cree_a", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.ordre)],
);

export const reglages = pgTable("reglages", {
  id: text("id").primaryKey(), // "global"
  valeur: jsonb("valeur").$type<Record<string, unknown>>().notNull().default({}),
  majA: timestamp("maj_a", { withTimezone: true }).notNull().defaultNow(),
});

/** Dépenses des fournisseurs payants, par mois (AAAA-MM) et fournisseur. */
export const depenses = pgTable("depenses", {
  mois: text("mois").notNull(),
  fournisseurId: text("fournisseur_id").notNull(),
  montant: real("montant").notNull().default(0),
  tokensEntree: integer("tokens_entree").notNull().default(0),
  tokensSortie: integer("tokens_sortie").notNull().default(0),
  requetes: integer("requetes").notNull().default(0),
  majA: timestamp("maj_a", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("depenses_pk_idx").on(t.mois, t.fournisseurId)]);

/** DDL idempotent, exécuté au premier accès (pas de système de migration à gérer). */
export const DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  titre TEXT NOT NULL DEFAULT 'Nouvelle conversation',
  fournisseur_id TEXT,
  cree_a TIMESTAMPTZ NOT NULL DEFAULT now(),
  maj_a TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_maj_idx ON conversations (maj_a);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ordre INTEGER NOT NULL,
  role TEXT NOT NULL,
  contenu TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB,
  cree_a TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, ordre);
CREATE TABLE IF NOT EXISTS reglages (
  id TEXT PRIMARY KEY,
  valeur JSONB NOT NULL DEFAULT '{}'::jsonb,
  maj_a TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS depenses (
  mois TEXT NOT NULL,
  fournisseur_id TEXT NOT NULL,
  montant REAL NOT NULL DEFAULT 0,
  tokens_entree INTEGER NOT NULL DEFAULT 0,
  tokens_sortie INTEGER NOT NULL DEFAULT 0,
  requetes INTEGER NOT NULL DEFAULT 0,
  maj_a TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mois, fournisseur_id)
);
`;
