/** Jeton interne pour les appels de relance entre tranches (dérivé de SESSION_SECRET). */
import { createHmac, timingSafeEqual } from "node:crypto";

export function jetonInterne(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.APP_PASSWORD ?? "dev";
  return createHmac("sha256", secret).update("taches-de-fond").digest("base64url");
}

export function verifierJetonInterne(candidat: string | null): boolean {
  if (!candidat) return false;
  const a = Buffer.from(jetonInterne());
  const b = Buffer.from(candidat);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function appUrl(): string {
  const brut = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") || "http://localhost:3000";
  return brut.replace(/\/$/, "");
}

/**
 * URL à laquelle le serveur s'appelle lui-même pour relancer une tranche. En développement,
 * APP_URL pointe souvent vers la production : on vise alors le serveur local.
 */
export function urlInterne(): string {
  if (process.env.TACHES_URL_INTERNE) return process.env.TACHES_URL_INTERNE.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development" && !process.env.VERCEL) return `http://localhost:${process.env.PORT ?? 3000}`;
  return appUrl();
}
