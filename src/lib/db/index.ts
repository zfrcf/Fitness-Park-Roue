/**
 * Base de données : Neon Postgres (DATABASE_URL) en production,
 * PGlite (Postgres embarqué, fichiers dans ./data/pglite) en local sans DATABASE_URL.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

declare global {
  var __db: Promise<DB> | undefined;
  var __dbType: "neon" | "pglite" | undefined;
}

async function creer(): Promise<DB> {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  let db: DB;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    db = drizzle(neon(url), { schema }) as unknown as DB;
    globalThis.__dbType = "neon";
  } else {
    if (process.env.VERCEL) {
      throw new Error("DATABASE_URL est absent : connectez une base Neon (Marketplace Vercel) au projet.");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dossier = process.env.PGLITE_DIR ?? (process.env.NODE_ENV === "test" ? undefined : "data/pglite");
    if (dossier) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dossier, { recursive: true });
    }
    const client = dossier ? new PGlite(dossier) : new PGlite();
    db = drizzle(client, { schema }) as unknown as DB;
    globalThis.__dbType = "pglite";
  }
  // Création idempotente des tables, instruction par instruction (neon-http n'accepte qu'une requête par appel).
  for (const instruction of schema.DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.execute(sql.raw(instruction));
  }
  return db;
}

export function getDB(): Promise<DB> {
  if (!globalThis.__db) {
    globalThis.__db = creer().catch((e) => {
      globalThis.__db = undefined;
      throw e;
    });
  }
  return globalThis.__db;
}

export function typeDB() {
  return globalThis.__dbType ?? (process.env.DATABASE_URL || process.env.POSTGRES_URL ? "neon" : "pglite");
}

export { schema };
