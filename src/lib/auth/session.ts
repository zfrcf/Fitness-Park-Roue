/**
 * Session signée (HMAC-SHA256 via Web Crypto) : fonctionne dans proxy.ts et
 * dans les route handlers. Le jeton ne contient aucune donnée sensible.
 */
export const NOM_COOKIE = "chat_session";
export const DUREE_SESSION_SECONDES = 60 * 60 * 24 * 30; // 30 jours

const encodeur = new TextEncoder();

function base64url(octets: ArrayBuffer | Uint8Array): string {
  const u8 = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let bin = "";
  for (const o of u8) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function depuisBase64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const u8 = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  const p = process.env.APP_PASSWORD ?? "";
  // La clé est TOUJOURS liée au mot de passe : changer APP_PASSWORD révoque les sessions existantes
  // (sinon un SESSION_SECRET fixe les laissait valides 30 jours malgré le changement). (#35)
  if (s && s.length >= 16) return `${s}:${p}`;
  if (!p) throw new Error("APP_PASSWORD et SESSION_SECRET sont absents.");
  return `derive:${p}`;
}

async function cle(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encodeur.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

interface Charge {
  exp: number; // epoch secondes
  iat: number;
  v: 1;
}

export async function creerJeton(): Promise<string> {
  const maintenant = Math.floor(Date.now() / 1000);
  const charge: Charge = { v: 1, iat: maintenant, exp: maintenant + DUREE_SESSION_SECONDES };
  const corps = base64url(encodeur.encode(JSON.stringify(charge)));
  const sig = await crypto.subtle.sign("HMAC", await cle(), encodeur.encode(corps));
  return `${corps}.${base64url(sig)}`;
}

export async function verifierJeton(jeton: string | undefined | null): Promise<boolean> {
  if (!jeton) return false;
  const [corps, sig] = jeton.split(".");
  if (!corps || !sig) return false;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await cle(),
      depuisBase64url(sig),
      encodeur.encode(corps),
    );
    if (!ok) return false;
    const charge = JSON.parse(
      new TextDecoder().decode(depuisBase64url(corps)),
    ) as Charge;
    return charge.v === 1 && charge.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** Comparaison en temps constant de deux chaînes. */
export function egalConstant(a: string, b: string): boolean {
  const ua = encodeur.encode(a);
  const ub = encodeur.encode(b);
  let diff = ua.length ^ ub.length;
  const n = Math.max(ua.length, ub.length);
  for (let i = 0; i < n; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0);
  return diff === 0;
}

export function optionsCookie(maxAge = DUREE_SESSION_SECONDES) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
