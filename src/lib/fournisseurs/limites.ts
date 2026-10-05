/**
 * Limites de débit apprises à partir des messages d'erreur (Groq : tokens d'entrée et de sortie
 * par minute). Elles servent à ne pas envoyer une requête vouée au refus, et à plafonner la
 * sortie demandée quand c'est le seul moyen d'utiliser le fournisseur.
 */
import type { KV } from "@/lib/kv";

export interface LimitesFournisseur {
  /** Tokens d'entrée par minute (Groq ITPM). */
  itpm?: number;
  /** Tokens de sortie par minute (Groq OTPM). */
  otpm?: number;
}

const PREFIXE = "fournisseur:limites:";
const TTL = 24 * 3600;

const RE_ITPM = /input tokens per minute[^:]*:\s*Limit\s+(\d+)/i;
const RE_OTPM = /output tokens per minute[^:]*:\s*Limit\s+(\d+)/i;

/** Extrait les limites présentes dans un message d'erreur (undefined si aucune). */
export function extraireLimites(message: string): LimitesFournisseur | undefined {
  const l: LimitesFournisseur = {};
  const i = RE_ITPM.exec(message);
  const o = RE_OTPM.exec(message);
  if (i) l.itpm = Number(i[1]);
  if (o) l.otpm = Number(o[1]);
  return i || o ? l : undefined;
}

export async function lireLimites(kv: KV, id: string): Promise<LimitesFournisseur> {
  return (await kv.get<LimitesFournisseur>(PREFIXE + id)) ?? {};
}

/** Mémorise les limites trouvées dans un message d'erreur ; renvoie true si quelque chose a été appris. */
export async function apprendreLimites(kv: KV, id: string, message: string): Promise<boolean> {
  const l = extraireLimites(message);
  if (!l) return false;
  const actuel = await lireLimites(kv, id);
  await kv.set(PREFIXE + id, { ...actuel, ...l }, TTL);
  return true;
}
