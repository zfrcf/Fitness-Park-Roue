/**
 * Suivi des dépenses des fournisseurs payants (par mois, en USD) et plafond mensuel.
 */
import { eq, sql } from "drizzle-orm";
import { getDB } from "@/lib/db";
import { depenses } from "@/lib/db/schema";
import type { Fournisseur } from "@/lib/fournisseurs/types";

export interface Usage {
  entree: number;
  sortie: number;
}

export function moisCourant(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function plafondMensuel(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.PAID_MONTHLY_CAP ?? "");
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Coût d'un appel : montant rapporté par l'API si disponible, sinon estimation par les prix configurés. */
export function calculerCout(f: Pick<Fournisseur, "prixEntree" | "prixSortie">, usage: Usage, coutRapporte?: number): number {
  if (typeof coutRapporte === "number" && coutRapporte >= 0) return coutRapporte;
  const e = ((f.prixEntree ?? 0) * usage.entree) / 1_000_000;
  const s = ((f.prixSortie ?? 0) * usage.sortie) / 1_000_000;
  return e + s;
}

export interface Depense {
  mois: string;
  fournisseurId: string;
  montant: number;
  tokensEntree: number;
  tokensSortie: number;
  requetes: number;
}

export async function enregistrerDepense(fournisseurId: string, usage: Usage, montant: number, mois = moisCourant()): Promise<void> {
  const db = await getDB();
  await db
    .insert(depenses)
    .values({ mois, fournisseurId, montant, tokensEntree: usage.entree, tokensSortie: usage.sortie, requetes: 1 })
    .onConflictDoUpdate({
      target: [depenses.mois, depenses.fournisseurId],
      set: {
        montant: sql`${depenses.montant} + ${montant}`,
        tokensEntree: sql`${depenses.tokensEntree} + ${usage.entree}`,
        tokensSortie: sql`${depenses.tokensSortie} + ${usage.sortie}`,
        requetes: sql`${depenses.requetes} + 1`,
        majA: new Date(),
      },
    });
}

export async function depensesDuMois(mois = moisCourant()): Promise<Depense[]> {
  const db = await getDB();
  return db.select().from(depenses).where(eq(depenses.mois, mois));
}

export async function depenseDuMois(fournisseurId: string, mois = moisCourant()): Promise<number> {
  const liste = await depensesDuMois(mois);
  return liste.find((d) => d.fournisseurId === fournisseurId)?.montant ?? 0;
}

/** Un fournisseur payant n'est utilisé que si un plafond est défini et que la dépense du mois (tous payants confondus) est en dessous. */
export async function autoriserPayant(f: Fournisseur): Promise<boolean> {
  if (!f.payant) return true;
  const plafond = plafondMensuel();
  if (plafond <= 0) return false;
  const total = (await depensesDuMois()).reduce((s, d) => s + d.montant, 0);
  return total < plafond;
}
