import { APICallError } from "ai";
import { estimerReessai } from "./entetes";

export type Categorie =
  | "quota" // 429 : limite de débit ou quota épuisé → basculer
  | "credits" // 402 : crédits épuisés → basculer
  | "auth" // 401/403 : clé invalide ou modèle non autorisé → basculer
  | "temporaire" // 5xx, 408, réseau, timeout → basculer
  | "contexte" // 400 : contexte trop long → résumer puis réessayer
  | "trop-grand" // 413 : requête au-dessus de la limite de tokens par minute → basculer, sinon réduire
  | "requete" // 400/404/422 autre : erreur de notre côté → ne pas basculer
  | "abandon"; // annulé par l'utilisateur

export interface ErreurClassee {
  categorie: Categorie;
  statut?: number;
  code?: string | number;
  message: string;
  reessaiA: number;
  /** Faut-il passer au fournisseur suivant ? */
  basculer: boolean;
}

function texte(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "message" in v && typeof (v as { message: unknown }).message === "string") {
    return (v as { message: string }).message;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Extrait {message, code} d'un corps d'erreur OpenAI / OpenRouter / Cloudflare. */
function lireCorps(corps: unknown): { message?: string; code?: string | number } {
  let o: unknown = corps;
  if (typeof corps === "string") {
    try {
      o = JSON.parse(corps);
    } catch {
      return { message: corps };
    }
  }
  if (!o || typeof o !== "object") return {};
  const r = o as Record<string, unknown>;
  const err = r.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return { message: err };
  if (err && typeof err === "object") {
    const code = (err.code ?? err.type) as string | number | undefined;
    return { message: texte(err.message ?? err), code };
  }
  const errors = r.errors as Array<Record<string, unknown>> | undefined; // Cloudflare natif
  if (Array.isArray(errors) && errors[0]) {
    return { message: texte(errors[0].message), code: errors[0].code as string | number | undefined };
  }
  if (typeof r.message === "string") return { message: r.message as string, code: r.code as string | number | undefined };
  return {};
}

const RE_CONTEXTE =
  /context[_ ]length|context window|too (long|large)|maximum (context|number of tokens)|token limit|reduce the length|exceeds the|prompt is too long|input too long|max_tokens.*(exceed|greater)|request too large/i;

export function classerErreur(err: unknown, maintenant = Date.now()): ErreurClassee {
  // Annulation
  if (err instanceof Error && (err.name === "AbortError" || /aborted|abort/i.test(err.message))) {
    return { categorie: "abandon", message: "Requête annulée", reessaiA: maintenant, basculer: false };
  }
  if (err instanceof Error && (err.name === "TimeoutError" || /timeout|timed out/i.test(err.message))) {
    return {
      categorie: "temporaire",
      message: "Délai d'attente dépassé",
      reessaiA: maintenant + 2 * 60_000,
      basculer: true,
    };
  }

  let statut: number | undefined;
  let enTetes: Record<string, string | undefined> | undefined;
  let message = "";
  let code: string | number | undefined;

  if (APICallError.isInstance(err)) {
    statut = err.statusCode;
    enTetes = err.responseHeaders;
    const corps = lireCorps(err.responseBody ?? err.data);
    message = corps.message ?? err.message;
    code = corps.code;
  } else if (err && typeof err === "object") {
    // Erreur reçue en plein flux (chunk {error:{code,message}} OpenRouter, ou objet brut)
    const corps = lireCorps("error" in err ? err : { error: err });
    message = corps.message ?? texte(err);
    code = corps.code;
    const o = err as Record<string, unknown>;
    const brut = (o.error && typeof o.error === "object" ? (o.error as Record<string, unknown>) : o);
    if (typeof brut.code === "number" && brut.code >= 100 && brut.code < 600) statut = brut.code;
    if (typeof o.statusCode === "number") statut = o.statusCode;
  } else {
    message = texte(err);
  }
  if (!message) message = "Erreur inconnue";

  // Codes Cloudflare : 3036 quota journalier, 3040 capacité → 429 ; 5035 modèle payant → 403
  if (code === 3036 || code === 3040 || code === 4006 || /daily free allocation/i.test(message)) statut = statut ?? 429;
  if (code === 5035) statut = statut ?? 403;

  // Réseau (fetch échoué) sans statut
  if (statut === undefined && /fetch failed|ECONN|ENOTFOUND|network|socket|EAI_AGAIN/i.test(message)) {
    return { categorie: "temporaire", statut, code, message, reessaiA: maintenant + 2 * 60_000, basculer: true };
  }

  const reessaiA = estimerReessai({ statut, message, code, enTetes }, maintenant);

  // Groq : « Request too large … on input tokens per minute (ITPM): Limit 7000, Requested 12069 »
  if ((statut === 413 || statut === 429) && /per minute|TPM|ITPM/i.test(message) && /requested/i.test(message)) {
    return { categorie: "trop-grand", statut, code, message, reessaiA, basculer: true };
  }
  if (statut === 429) return { categorie: "quota", statut, code, message, reessaiA, basculer: true };
  if (statut === 402) return { categorie: "credits", statut, code, message, reessaiA, basculer: true };
  if (statut === 401 || statut === 403) return { categorie: "auth", statut, code, message, reessaiA, basculer: true };
  if (statut === 408 || statut === 498 || (statut !== undefined && statut >= 500)) {
    return { categorie: "temporaire", statut, code, message, reessaiA, basculer: true };
  }
  if ((statut === 400 || statut === 413 || statut === 422) && RE_CONTEXTE.test(message)) {
    return { categorie: "contexte", statut, code, message, reessaiA: maintenant, basculer: false };
  }
  if (statut !== undefined && statut >= 400 && statut < 500) {
    // Modèle introuvable (404) ou requête refusée : inutile d'insister sur ce fournisseur.
    return { categorie: "requete", statut, code, message, reessaiA: maintenant + 10 * 60_000, basculer: statut === 404 };
  }
  // Inconnu : on considère temporaire et on bascule.
  return { categorie: "temporaire", statut, code, message, reessaiA, basculer: true };
}
