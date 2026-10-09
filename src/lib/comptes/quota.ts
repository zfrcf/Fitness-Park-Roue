/**
 * Quota quotidien par compte (membres seulement ; l'administrateur n'en a pas) : nombre de messages
 * et tokens consommés, remis à zéro chaque jour à minuit (heure de Paris). Réglable par
 * QUOTA_MESSAGES_JOUR et QUOTA_TOKENS_JOUR ; 0 = illimité.
 */
import type { KV } from "@/lib/kv";
import { fuseauHoraire } from "@/lib/fuseau";

export interface EtatQuota {
  messages: number;
  tokens: number;
  limiteMessages: number;
  limiteTokens: number;
  jour: string;
}

function entier(v: string | undefined, defaut: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaut;
}

export function limitesQuota(env: Record<string, string | undefined> = process.env) {
  return { messages: entier(env.QUOTA_MESSAGES_JOUR, 60), tokens: entier(env.QUOTA_TOKENS_JOUR, 600_000) };
}

export function jourCourant(maintenant = Date.now()): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: fuseauHoraire(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(maintenant));
}

const cle = (uid: string, jour: string, quoi: "messages" | "tokens") => `quota:${uid}:${jour}:${quoi}`;
const TTL = 2 * 24 * 3600;

export async function lireQuota(kv: KV, uid: string, maintenant = Date.now()): Promise<EtatQuota> {
  const jour = jourCourant(maintenant);
  const l = limitesQuota();
  const [m, t] = await Promise.all([kv.get<number>(cle(uid, jour, "messages")), kv.get<number>(cle(uid, jour, "tokens"))]);
  return { messages: Number(m) || 0, tokens: Number(t) || 0, limiteMessages: l.messages, limiteTokens: l.tokens, jour };
}

/** Message d'erreur si le quota du jour est épuisé, sinon null. */
export function depassement(q: EtatQuota): string | null {
  if (q.limiteMessages > 0 && q.messages >= q.limiteMessages) {
    return `Quota du jour atteint (${q.limiteMessages} messages). Il se renouvelle à minuit.`;
  }
  if (q.limiteTokens > 0 && q.tokens >= q.limiteTokens) {
    return `Quota du jour atteint (${new Intl.NumberFormat("fr-FR").format(q.limiteTokens)} tokens). Il se renouvelle à minuit.`;
  }
  return null;
}

export async function compterMessage(kv: KV, uid: string, maintenant = Date.now()): Promise<number> {
  return kv.incr(cle(uid, jourCourant(maintenant), "messages"), TTL);
}

export async function compterTokens(kv: KV, uid: string, n: number, maintenant = Date.now()): Promise<void> {
  if (!(n > 0)) return;
  const k = cle(uid, jourCourant(maintenant), "tokens");
  const actuel = Number(await kv.get<number>(k)) || 0;
  await kv.set(k, actuel + Math.round(n), TTL);
}
