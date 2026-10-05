/**
 * Limiteur de débit partagé (requêtes par minute) par fournisseur, dans le KV : toutes les
 * fonctions serverless et toutes les tâches de fond comptent dans le même seau. Évite que des
 * tâches en parallèle se fassent rejeter en cascade (NVIDIA : ~40 req/min).
 */
import type { KV } from "@/lib/kv";
import type { FamilleAPI, Fournisseur } from "./types";

/** Limites connues des offres gratuites (requêtes par minute), surchargeables par PROVIDER_n_RPM. */
export const RPM_PAR_FAMILLE: Partial<Record<FamilleAPI, number>> = {
  nvidia: 40,
  groq: 30,
  openrouter: 20,
  cloudflare: 300,
};

export function rpmDe(f: Pick<Fournisseur, "famille" | "rpm">): number | undefined {
  return f.rpm ?? RPM_PAR_FAMILLE[f.famille];
}

export type Creneau = { ok: true; utilise: number; limite: number } | { ok: false; attenteMs: number; utilise: number; limite: number };

/**
 * Réserve une requête dans la fenêtre courante. Garde une requête de marge pour les tests manuels
 * de la page État. Renvoie l'attente jusqu'à la prochaine fenêtre si la limite est atteinte.
 */
export async function reserverCreneau(kv: KV, f: Pick<Fournisseur, "id" | "famille" | "rpm">, maintenant = Date.now(), fenetreMs = 60_000): Promise<Creneau> {
  const rpm = rpmDe(f);
  if (!rpm) return { ok: true, utilise: 0, limite: Infinity };
  const limite = Math.max(1, rpm - 1);
  const fenetre = Math.floor(maintenant / fenetreMs);
  const cle = `fournisseur:rpm:${f.id}:${fenetre}`;
  const utilise = await kv.incr(cle, Math.ceil((fenetreMs * 2) / 1000));
  if (utilise <= limite) return { ok: true, utilise, limite };
  const attenteMs = (fenetre + 1) * fenetreMs - maintenant + 250;
  return { ok: false, attenteMs, utilise, limite };
}

/** Requêtes déjà consommées dans la fenêtre courante (affichage). */
export async function creneauxUtilises(kv: KV, f: Pick<Fournisseur, "id" | "famille" | "rpm">, maintenant = Date.now(), fenetreMs = 60_000): Promise<{ utilise: number; limite?: number }> {
  const rpm = rpmDe(f);
  const n = (await kv.get<number>(`fournisseur:rpm:${f.id}:${Math.floor(maintenant / fenetreMs)}`)) ?? 0;
  return { utilise: n, limite: rpm ? Math.max(1, rpm - 1) : undefined };
}
