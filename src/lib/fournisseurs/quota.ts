import { getKV } from "@/lib/kv";
import { lireEtat } from "./etat";
import type { Fournisseur, QuotaInfo } from "./types";

/**
 * Informations de quota complémentaires, propres à certains fournisseurs.
 * OpenRouter expose GET /key (requêtes gratuites du jour). Mise en cache 60 s.
 */
export async function quotaComplementaire(f: Fournisseur): Promise<QuotaInfo | undefined> {
  if (f.famille !== "openrouter") return undefined;
  const kv = getKV();
  const cle = `fournisseur:quota:${f.id}`;
  const cache = await kv.get<QuotaInfo>(cle);
  if (cache) return cache;
  try {
    const r = await fetch(`${f.baseUrl}/key`, {
      headers: { Authorization: `Bearer ${f.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as {
      data?: { free_model_daily_requests?: { used: number; limit: number; remaining: number }; usage_monthly?: number };
    };
    const d = j.data?.free_model_daily_requests;
    if (!d) return undefined;
    const q: QuotaInfo = { journalierUtilise: d.used, journalierLimite: d.limit };
    await kv.set(cle, q, 60);
    return q;
  } catch {
    return undefined;
  }
}

export async function etatComplet(f: Fournisseur) {
  const [etat, complement] = await Promise.all([lireEtat(f.id), quotaComplementaire(f)]);
  return { ...etat, quota: complement ? { ...etat.quota, ...complement } : etat.quota };
}
