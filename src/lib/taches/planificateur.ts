/**
 * Relance des tranches de travail. Vercel Hobby ne permet ni fonction longue (300 s) ni cron
 * fréquent : chaque tranche programme la suivante elle-même (appel HTTP différé, maintenu en vie
 * par waitUntil), ou via QStash si QSTASH_TOKEN est défini. Les reprises lointaines (quota) sont
 * assurées par /api/taches/reveiller (appelé par la page Tâches et par un workflow GitHub cron).
 */
import { waitUntil } from "@vercel/functions";
import { appUrl, jetonInterne, urlInterne } from "./jeton";

/** Au-delà, on ne maintient pas de fonction en vie : le réveil périodique s'en charge. */
export const DELAI_MAX_CHAINE_MS = 240_000;

const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Planificateur {
  programmer: (tacheId: string, delaiMs: number) => Promise<void>;
}

async function appelerExecuteur(tacheId: string): Promise<void> {
  try {
    const r = await fetch(`${urlInterne()}/api/taches/executer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tache-jeton": jetonInterne() },
      body: JSON.stringify({ id: tacheId }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) console.warn(`[taches] relance ${tacheId} : HTTP ${r.status}`);
  } catch (e) {
    console.warn(`[taches] relance ${tacheId} impossible :`, e instanceof Error ? e.message : e);
  }
}

async function viaQStash(tacheId: string, delaiMs: number): Promise<boolean> {
  const jeton = process.env.QSTASH_TOKEN;
  if (!jeton) return false;
  try {
    const r = await fetch(`https://qstash.upstash.io/v2/publish/${appUrl()}/api/taches/executer`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jeton}`,
        "content-type": "application/json",
        "upstash-delay": `${Math.max(1, Math.ceil(delaiMs / 1000))}s`,
        "upstash-retries": "3",
        "upstash-forward-x-tache-jeton": jetonInterne(),
      },
      body: JSON.stringify({ id: tacheId }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export const planificateurHTTP: Planificateur = {
  async programmer(tacheId, delaiMs) {
    if (await viaQStash(tacheId, delaiMs)) return;
    if (delaiMs > DELAI_MAX_CHAINE_MS) return; // reprise par le réveil périodique
    const promesse = (async () => {
      if (delaiMs > 0) await attendre(delaiMs);
      await appelerExecuteur(tacheId);
    })();
    try {
      waitUntil(promesse);
    } catch {
      /* hors Vercel : la promesse tourne quand même */
    }
  },
};
