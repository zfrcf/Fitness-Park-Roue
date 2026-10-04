/** Limite de tentatives de connexion par adresse IP. */
import { getKV } from "@/lib/kv";

export const MAX_TENTATIVES = 5;
export const FENETRE_SECONDES = 15 * 60;

function cle(ip: string) {
  return `auth:tentatives:${ip}`;
}

export async function tentativesRestantes(ip: string) {
  const kv = getKV();
  const n = (await kv.get<number>(cle(ip))) ?? 0;
  const ttl = await kv.ttl(cle(ip));
  return { restantes: Math.max(0, MAX_TENTATIVES - n), reessaiDans: ttl > 0 ? ttl : 0 };
}

export async function enregistrerEchec(ip: string) {
  const kv = getKV();
  const n = await kv.incr(cle(ip), FENETRE_SECONDES);
  const ttl = await kv.ttl(cle(ip));
  return { restantes: Math.max(0, MAX_TENTATIVES - n), reessaiDans: ttl > 0 ? ttl : FENETRE_SECONDES };
}

export async function reinitialiser(ip: string) {
  await getKV().del(cle(ip));
}

export function ipDepuisRequete(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "inconnue"
  );
}
