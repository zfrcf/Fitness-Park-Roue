/**
 * Liste de bannissement par adresse IP (contenu dans le KV).
 *
 * L'IP n'est jamais stockée en clair : on garde son empreinte HMAC (même procédé que l'anti-doublon
 * d'inscription). Un bannissement est permanent jusqu'à ce que l'administrateur débloque le compte
 * correspondant (voir `debannirIpDe`). Les administrateurs ne sont jamais bannis.
 */
import { getKV } from "@/lib/kv";
import { empreinteIp } from "@/lib/comptes/inscription";

const PREFIXE = "ip:banni:";

export interface BanIp {
  /** Compte à l'origine du bannissement, s'il est connu (permet à l'administrateur de le lever). */
  uid: string | null;
  /** Motif technique, ex. « mineur ». */
  raison: string;
  /** Date du bannissement (epoch ms). */
  date: number;
}

/** L'adresse IP est-elle bannie ? (empreinte HMAC, jamais l'IP en clair). */
export async function estIpBannie(ip: string): Promise<boolean> {
  const emp = empreinteIp(ip);
  if (!emp) return false;
  const b = await getKV().get<BanIp>(`${PREFIXE}${emp}`).catch(() => null);
  return b != null;
}

/** Bannit l'adresse IP (permanent, jusqu'à levée par l'administrateur). */
export async function bannirIp(ip: string, info: { uid: string | null; raison: string; maintenant?: number }): Promise<void> {
  const emp = empreinteIp(ip);
  if (!emp) return;
  const valeur: BanIp = { uid: info.uid, raison: info.raison, date: info.maintenant ?? Date.now() };
  await getKV().set(`${PREFIXE}${emp}`, valeur).catch(() => {});
}

/**
 * Lève tous les bannissements IP liés à un compte (faux positif débloqué par l'administrateur).
 * Parcourt les clés de bannissement et supprime celles qui citent ce compte.
 */
export async function debannirIpDe(uid: string): Promise<number> {
  const kv = getKV();
  const cles = await kv.keys(PREFIXE).catch(() => [] as string[]);
  let leves = 0;
  for (const cle of cles) {
    const b = await kv.get<BanIp>(cle).catch(() => null);
    if (b && b.uid === uid) {
      await kv.del(cle).catch(() => {});
      leves++;
    }
  }
  return leves;
}
