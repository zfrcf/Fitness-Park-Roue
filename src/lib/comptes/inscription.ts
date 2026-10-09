/**
 * Inscription : validations, anti-doublons et création du compte.
 *
 * Doubles comptes empêchés par :
 *  - l'adresse normalisée unique (alias Gmail, « +suffixe », majuscules) ;
 *  - le refus des adresses jetables et des domaines sans serveur de messagerie ;
 *  - un seul compte par appareil sur 30 jours (cookie httpOnly + identifiant du navigateur) ;
 *  - un nombre limité de comptes par adresse IP sur 30 jours (empreinte HMAC, jamais l'IP en clair).
 */
import { createHmac, randomBytes, createHash, randomUUID } from "node:crypto";
import { getKV } from "@/lib/kv";
import { comptesRecents, creerUtilisateur, utilisateurParEmail, type Utilisateur } from "@/lib/db/utilisateurs";
import { courrielDisponible } from "./courriel";
import { domaineRecoitCourrier, emailValide, estJetable, normaliserEmail } from "./email";
import { hacherMotDePasse, refusMotDePasse } from "./motdepasse";

export type ModeVerification = "email" | "admin" | "aucune";

/** E-mail si un service d'envoi est configuré, sinon validation par l'administrateur. */
export function modeVerification(env: Record<string, string | undefined> = process.env): ModeVerification {
  const choisi = env.INSCRIPTION_VERIFICATION;
  if (choisi === "aucune" || choisi === "admin") return choisi;
  if (choisi === "email" && courrielDisponible(env)) return "email";
  return courrielDisponible(env) ? "email" : "admin";
}

export function empreinteIp(ip: string): string | null {
  if (!ip || ip === "inconnue") return null;
  const secret = `${process.env.SESSION_SECRET ?? ""}:${process.env.APP_PASSWORD ?? ""}:ip`;
  return createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);
}

export interface EntreeInscription {
  nom: string;
  email: string;
  motDePasse: string;
  /** Identifiants d'appareil : cookie httpOnly et identifiant gardé par le navigateur. */
  appareils: string[];
  ip: string;
}

export class RefusInscription extends Error {
  constructor(message: string, public readonly statut = 400, public readonly code = "refuse") {
    super(message);
  }
}

const JOURS_30 = 30 * 24 * 3600_000;

export async function inscrire(e: EntreeInscription, options: { verifierDomaine?: (email: string) => Promise<boolean>; maintenant?: number } = {}): Promise<{ utilisateur: Utilisateur; mode: ModeVerification }> {
  const nom = e.nom.trim().replace(/\s+/g, " ").slice(0, 60);
  const email = e.email.trim().slice(0, 254);
  if (nom.length < 2) throw new RefusInscription("Indiquez votre nom (2 caractères au moins).");
  if (!emailValide(email)) throw new RefusInscription("Adresse e-mail invalide.");
  const refus = refusMotDePasse(e.motDePasse, email);
  if (refus) throw new RefusInscription(refus);
  if (estJetable(email)) throw new RefusInscription("Les adresses e-mail jetables ne sont pas acceptées.");
  const normalise = normaliserEmail(email);
  if (await utilisateurParEmail(normalise)) {
    throw new RefusInscription("Un compte existe déjà avec cette adresse e-mail (ou une variante de celle-ci). Connectez-vous.", 409, "doublon_email");
  }
  if (!(await (options.verifierDomaine ?? domaineRecoitCourrier)(email))) {
    throw new RefusInscription("Ce domaine ne reçoit pas d'e-mails : vérifiez l'adresse.");
  }
  const appareils = [...new Set(e.appareils.filter((a) => /^[\w-]{16,64}$/.test(a)))];
  const ipHash = empreinteIp(e.ip);
  const depuis = new Date((options.maintenant ?? Date.now()) - JOURS_30);
  const recents = await comptesRecents(appareils, ipHash, depuis);
  if (recents.parAppareil > 0) {
    throw new RefusInscription("Un compte a déjà été créé depuis cet appareil. Connectez-vous avec ce compte.", 409, "doublon_appareil");
  }
  const maxParIp = Math.max(1, Number(process.env.INSCRIPTIONS_PAR_IP) || 1);
  if (recents.parIp >= maxParIp) {
    throw new RefusInscription("Un compte a déjà été créé depuis cette connexion internet ces 30 derniers jours.", 409, "doublon_ip");
  }
  const mode = modeVerification();
  try {
    const utilisateur = await creerUtilisateur({
      id: randomUUID().replace(/-/g, "").slice(0, 20),
      email,
      emailNormalise: normalise,
      nom,
      hash: await hacherMotDePasse(e.motDePasse),
      role: "membre",
      statut: mode === "aucune" ? "actif" : "en_attente",
      appareils,
      ipHash,
    });
    return { utilisateur, mode };
  } catch (err) {
    // Deux inscriptions simultanées avec la même adresse : l'index unique tranche.
    if (/duplicate key|unique/i.test(err instanceof Error ? err.message : String(err))) {
      throw new RefusInscription("Un compte existe déjà avec cette adresse e-mail.", 409, "doublon_email");
    }
    throw err;
  }
}

/** Jeton de vérification d'adresse (48 h), stocké haché dans le KV. */
export async function creerJetonVerification(uid: string): Promise<string> {
  const jeton = randomBytes(32).toString("base64url");
  await getKV().set(`verif:${createHash("sha256").update(jeton).digest("hex")}`, uid, 48 * 3600);
  return jeton;
}

export async function consommerJetonVerification(jeton: string): Promise<string | null> {
  if (!/^[\w-]{20,100}$/.test(jeton)) return null;
  const kv = getKV();
  const cle = `verif:${createHash("sha256").update(jeton).digest("hex")}`;
  const uid = await kv.get<string>(cle);
  if (uid) await kv.del(cle);
  return uid ?? null;
}

/** Limite d'inscriptions tentées par IP (10 par heure), contre les robots. */
export async function inscriptionsTentees(ip: string): Promise<number> {
  return getKV().incr(`inscription:essais:${empreinteIp(ip) ?? "inconnue"}`, 3600);
}
