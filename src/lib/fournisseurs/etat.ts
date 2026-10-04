import { getKV } from "@/lib/kv";
import type { EtatFournisseur, QuotaInfo } from "./types";

const PREFIXE = "fournisseur:etat:";
const TTL = 7 * 24 * 3600;

export async function lireEtat(id: string): Promise<EtatFournisseur> {
  const e = await getKV().get<EtatFournisseur>(PREFIXE + id);
  if (!e) return { statut: "inconnu", majA: 0 };
  // Un épuisement expiré redevient disponible.
  if ((e.statut === "epuise" || e.statut === "erreur") && e.reessaiA && e.reessaiA <= Date.now()) {
    return { ...e, statut: "disponible", reessaiA: undefined, raison: undefined };
  }
  return e;
}

async function ecrire(id: string, e: EtatFournisseur) {
  await getKV().set(PREFIXE + id, { ...e, majA: Date.now() }, TTL);
}

export function estDisponible(e: EtatFournisseur, maintenant = Date.now()): boolean {
  if (e.statut === "epuise" || e.statut === "erreur") return !e.reessaiA || e.reessaiA <= maintenant;
  return true;
}

export async function marquerReussite(id: string, quota?: QuotaInfo) {
  const actuel = await lireEtat(id);
  await ecrire(id, {
    ...actuel,
    statut: "disponible",
    reessaiA: undefined,
    raison: undefined,
    quota: quota ?? actuel.quota,
    derniereReussiteA: Date.now(),
  });
}

export async function marquerEpuise(id: string, reessaiA: number, raison: string, quota?: QuotaInfo) {
  const actuel = await lireEtat(id);
  await ecrire(id, {
    ...actuel,
    statut: "epuise",
    reessaiA,
    raison,
    quota: quota ?? actuel.quota,
    derniereErreurA: Date.now(),
  });
}

export async function marquerErreur(id: string, reessaiA: number, raison: string) {
  const actuel = await lireEtat(id);
  await ecrire(id, { ...actuel, statut: "erreur", reessaiA, raison, derniereErreurA: Date.now() });
}

export async function enregistrerTest(id: string, test: NonNullable<EtatFournisseur["dernierTest"]>) {
  const actuel = await lireEtat(id);
  await ecrire(id, { ...actuel, dernierTest: test });
}

export async function reinitialiserEtat(id: string) {
  await getKV().del(PREFIXE + id);
}
