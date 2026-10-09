/** Mots de passe : scrypt (Node), sel aléatoire, comparaison en temps constant. */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384, R = 8, P = 1, LONGUEUR = 64;

function scrypt(mdp: string, sel: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, ko) => scryptCb(mdp.normalize("NFKC"), sel, LONGUEUR, options, (e, cle) => (e ? ko(e) : ok(cle))));
}

export async function hacherMotDePasse(mdp: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await scrypt(mdp, sel, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${sel.toString("base64")}$${cle.toString("base64")}`;
}

export async function verifierMotDePasse(mdp: string, stocke: string): Promise<boolean> {
  const [algo, n, r, p, sel, cle] = stocke.split("$");
  if (algo !== "scrypt" || !sel || !cle) return false;
  const attendu = Buffer.from(cle, "base64");
  const calcule = await scrypt(mdp, Buffer.from(sel, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return calcule.length === attendu.length && timingSafeEqual(calcule, attendu);
}

const TROP_COURANTS = new Set(["123456789", "1234567890", "motdepasse", "motdepasse1", "password1", "azertyuiop", "qwertyuiop", "0123456789", "aaaaaaaaaa", "password123", "azerty1234", "1234567891"]);

/** Raison du refus, ou null si le mot de passe convient. */
export function refusMotDePasse(mdp: string, email: string): string | null {
  if (mdp.length < 10) return "Le mot de passe doit faire au moins 10 caractères.";
  if (mdp.length > 200) return "Le mot de passe est trop long (200 caractères au plus).";
  if (TROP_COURANTS.has(mdp.toLowerCase()) || /^(.)\1+$/.test(mdp)) return "Ce mot de passe est trop courant.";
  if (email && mdp.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  return null;
}
