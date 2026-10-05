import { bigint, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
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
    id: text("id").notNull(),
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
  (t) => [primaryKey({ columns: [t.conversationId, t.id] }), index("messages_conversation_idx").on(t.conversationId, t.ordre)],
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

/** Compilations lancées sur GitHub Actions. */
export const compilations = pgTable("compilations", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id").notNull(),
  nom: text("nom").notNull(),
  branche: text("branche").notNull(),
  brancheUrl: text("branche_url"),
  nbFichiers: integer("nb_fichiers").notNull().default(0),
  statut: text("statut").notNull().default("en_attente"), // en_attente | en_cours | reussie | echouee | erreur
  // Les identifiants GitHub dépassent 2^31 : BIGINT obligatoire.
  runId: bigint("run_id", { mode: "number" }),
  runUrl: text("run_url"),
  jarNom: text("jar_nom"),
  jarArtefactId: bigint("jar_artefact_id", { mode: "number" }),
  journal: text("journal"),
  erreur: text("erreur"),
  creeA: timestamp("cree_a", { withTimezone: true }).notNull().defaultNow(),
  majA: timestamp("maj_a", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("compilations_message_idx").on(t.messageId)]);

/** Tâches de fond : une conversation pilotée par le serveur jusqu'à un résultat (ex. un .jar qui compile). */
export const taches = pgTable(
  "taches",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    titre: text("titre").notNull(),
    objectif: text("objectif").notNull(),
    /** Boucle génération → compilation → correction jusqu'au .jar ; sinon une seule réponse. */
    compiler: integer("compiler").notNull().default(1),
    statut: text("statut").notNull().default("en_attente"), // en_attente | en_cours | pause | terminee | echouee | arretee
    etape: text("etape").notNull().default("en attente"),
    cycles: integer("cycles").notNull().default(0),
    maxCycles: integer("max_cycles").notNull().default(8),
    compilationId: text("compilation_id"),
    fournisseurId: text("fournisseur_id"),
    tokensEntree: integer("tokens_entree").notNull().default(0),
    tokensSortie: integer("tokens_sortie").notNull().default(0),
    jarNom: text("jar_nom"),
    jarCompilationId: text("jar_compilation_id"),
    erreur: text("erreur"),
    journal: jsonb("journal").$type<Array<{ a: number; texte: string }>>().notNull().default([]),
    /** Heure de reprise automatique (quota épuisé) ; null = dès que possible. */
    repriseA: timestamp("reprise_a", { withTimezone: true }),
    /** Dernier signe de vie de la tranche en cours. */
    battementA: timestamp("battement_a", { withTimezone: true }),
    creeA: timestamp("cree_a", { withTimezone: true }).notNull().defaultNow(),
    majA: timestamp("maj_a", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("taches_statut_idx").on(t.statut)],
);

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
  id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ordre INTEGER NOT NULL,
  role TEXT NOT NULL,
  contenu TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB,
  cree_a TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, id)
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
CREATE TABLE IF NOT EXISTS compilations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  branche TEXT NOT NULL,
  branche_url TEXT,
  nb_fichiers INTEGER NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  run_id BIGINT,
  run_url TEXT,
  jar_nom TEXT,
  jar_artefact_id BIGINT,
  journal TEXT,
  erreur TEXT,
  cree_a TIMESTAMPTZ NOT NULL DEFAULT now(),
  maj_a TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compilations_message_idx ON compilations (message_id);
ALTER TABLE compilations ALTER COLUMN run_id TYPE BIGINT;
ALTER TABLE compilations ALTER COLUMN jar_artefact_id TYPE BIGINT;
CREATE TABLE IF NOT EXISTS taches (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  titre TEXT NOT NULL,
  objectif TEXT NOT NULL,
  compiler INTEGER NOT NULL DEFAULT 1,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  etape TEXT NOT NULL DEFAULT 'en attente',
  cycles INTEGER NOT NULL DEFAULT 0,
  max_cycles INTEGER NOT NULL DEFAULT 8,
  compilation_id TEXT,
  fournisseur_id TEXT,
  tokens_entree INTEGER NOT NULL DEFAULT 0,
  tokens_sortie INTEGER NOT NULL DEFAULT 0,
  jar_nom TEXT,
  jar_compilation_id TEXT,
  erreur TEXT,
  journal JSONB NOT NULL DEFAULT '[]'::jsonb,
  reprise_a TIMESTAMPTZ,
  battement_a TIMESTAMPTZ,
  cree_a TIMESTAMPTZ NOT NULL DEFAULT now(),
  maj_a TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS taches_statut_idx ON taches (statut);
`;
