/**
 * Lecture des en-têtes de quota et des messages d'erreur des fournisseurs,
 * pour estimer l'heure de réessai.
 */
import type { QuotaInfo } from "./types";

type EnTetes = Headers | Record<string, string | undefined> | undefined;

function lire(h: EnTetes, nom: string): string | undefined {
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(nom) ?? undefined;
  const cle = Object.keys(h).find((k) => k.toLowerCase() === nom.toLowerCase());
  return cle ? h[cle] : undefined;
}

/** "2m59.56s", "7.66s", "285ms", "1h2m" (format durée Go) → millisecondes. */
export function parserDureeGo(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let trouve = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    trouve = true;
    const v = parseFloat(m[1]);
    total += m[2] === "h" ? v * 3_600_000 : m[2] === "m" ? v * 60_000 : m[2] === "s" ? v * 1000 : v;
  }
  if (!trouve) {
    const n = Number(t);
    return Number.isFinite(n) ? n * 1000 : undefined;
  }
  return total;
}

/** Retry-After : secondes ou date HTTP → délai en ms. */
export function parserRetryAfter(s: string | undefined, maintenant = Date.now()): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(s);
  return Number.isNaN(d) ? undefined : Math.max(0, d - maintenant);
}

/** Valeur de reset : epoch secondes, epoch ms ou durée → epoch ms. */
export function parserReset(s: string | undefined, maintenant = Date.now()): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n > 1e12) return n; // epoch ms
    if (n > 1e9) return n * 1000; // epoch s
    return maintenant + n * 1000; // délai en secondes
  }
  const d = parserDureeGo(s);
  return d === undefined ? undefined : maintenant + d;
}

/** Extrait "Please try again in 9m38.016s" d'un message d'erreur Groq. */
export function parserDelaiDansMessage(message: string | undefined): number | undefined {
  if (!message) return undefined;
  const m = /try again in\s+([0-9hms.]+)/i.exec(message);
  return m ? parserDureeGo(m[1]) : undefined;
}

export function lireQuota(h: EnTetes, maintenant = Date.now()): QuotaInfo | undefined {
  const q: QuotaInfo = {};
  const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
  q.requetesLimite = num(lire(h, "x-ratelimit-limit-requests")) ?? num(lire(h, "x-ratelimit-limit"));
  q.requetesRestantes = num(lire(h, "x-ratelimit-remaining-requests")) ?? num(lire(h, "x-ratelimit-remaining"));
  q.tokensLimite = num(lire(h, "x-ratelimit-limit-tokens"));
  q.tokensRestants = num(lire(h, "x-ratelimit-remaining-tokens"));
  q.resetRequetesA = parserReset(lire(h, "x-ratelimit-reset-requests") ?? lire(h, "x-ratelimit-reset"), maintenant);
  q.resetTokensA = parserReset(lire(h, "x-ratelimit-reset-tokens"), maintenant);
  const vide = Object.values(q).every((v) => v === undefined);
  return vide ? undefined : q;
}

export interface InfosErreur {
  statut?: number;
  message?: string;
  /** Type/code d'erreur renvoyé par le fournisseur ("tokens", "requests", 3036, …). */
  code?: string | number;
  enTetes?: EnTetes;
}

/** Fin du jour UTC (OpenRouter et Cloudflare remettent leurs compteurs à minuit UTC). */
export function prochainMinuitUTC(maintenant = Date.now()): number {
  const d = new Date(maintenant);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Estime l'instant (epoch ms) où réessayer un fournisseur après une erreur.
 * Ordre : Retry-After → en-têtes de reset → message → repli selon le statut.
 */
export function estimerReessai(e: InfosErreur, maintenant = Date.now()): number {
  const h = e.enTetes;
  const ra = parserRetryAfter(lire(h, "retry-after"), maintenant);
  if (ra !== undefined && ra > 0) return maintenant + ra;

  const msg = e.message ?? "";
  const msgMin = msg.toLowerCase();

  // Quota journalier atteint : attendre minuit UTC. Cloudflare (neurons) ne remet pas son
  // compteur à minuit UTC pile (observé) : on revérifie au plus tard dans une heure.
  if (
    e.code === 3036 ||
    e.code === 4006 ||
    /daily|per day|par jour|free allocation|quota journalier/.test(msgMin) ||
    (e.statut === 429 && /(^|\W)day(s)?\b/.test(msgMin) && !/minute/.test(msgMin))
  ) {
    const minuit = prochainMinuitUTC(maintenant);
    if (e.code === 3036 || e.code === 4006 || /neurons/.test(msgMin)) return Math.min(minuit, maintenant + 3_600_000);
    return minuit;
  }

  const q = lireQuota(h, maintenant);
  if (q) {
    const code = String(e.code ?? "");
    const candidats =
      code === "tokens"
        ? [q.resetTokensA]
        : code === "requests"
          ? [q.resetRequetesA]
          : [q.resetTokensA, q.resetRequetesA];
    const futur = candidats.filter((v): v is number => v !== undefined && v > maintenant);
    if (futur.length) return Math.max(...futur);
  }

  const dm = parserDelaiDansMessage(msg);
  if (dm !== undefined) return maintenant + dm;

  if (e.statut === 402) return maintenant + 24 * 3_600_000; // crédits épuisés
  if (e.statut === 429) return maintenant + 60_000;
  if (e.statut === 401 || e.statut === 403) return maintenant + 3_600_000; // clé invalide : vérifier la config
  return maintenant + 2 * 60_000; // 5xx, timeouts, réseau
}
