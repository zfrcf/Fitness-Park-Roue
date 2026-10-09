/**
 * Utilisateur de la requête : l'administrateur (mot de passe APP_PASSWORD, ou atelier local) ou un
 * membre inscrit. Un membre bloqué ou supprimé perd l'accès à la requête suivante (au plus 30 s de
 * cache), même avec une session encore valide.
 */
import { getKV } from "@/lib/kv";
import { modeLocal } from "@/lib/mode";
import { ID_ADMIN, lireJeton, NOM_COOKIE } from "./session";

export interface UtilisateurCourant {
  id: string;
  admin: boolean;
  nom: string;
  email: string | null;
}

export const ADMIN: UtilisateurCourant = { id: ID_ADMIN, admin: true, nom: "Administrateur", email: null };

/** Valeur de la colonne « propriétaire » : null pour l'administrateur (données d'avant les comptes). */
export function proprietaire(u: UtilisateurCourant): string | null {
  return u.admin ? null : u.id;
}

function lireCookie(entete: string | null, nom: string): string | undefined {
  if (!entete) return undefined;
  for (const morceau of entete.split(";")) {
    const i = morceau.indexOf("=");
    if (i > 0 && morceau.slice(0, i).trim() === nom) return decodeURIComponent(morceau.slice(i + 1).trim());
  }
  return undefined;
}

export async function utilisateurDepuisJeton(jeton: string | undefined): Promise<UtilisateurCourant | null> {
  if (modeLocal()) return ADMIN;
  const id = await lireJeton(jeton);
  if (!id) return null;
  if (id.role === "admin" && id.uid === ID_ADMIN) return ADMIN;
  const kv = getKV();
  const cle = `compte:actif:${id.uid}`;
  const cache = await kv.get<{ nom: string; email: string } | "non">(cle).catch(() => null);
  if (cache === "non") return null;
  if (cache) return { id: id.uid, admin: false, nom: cache.nom, email: cache.email };
  const { lireUtilisateur } = await import("@/lib/db/utilisateurs");
  const u = await lireUtilisateur(id.uid);
  if (!u || u.statut !== "actif") {
    await kv.set(cle, "non", 30).catch(() => {});
    return null;
  }
  await kv.set(cle, { nom: u.nom, email: u.email }, 30).catch(() => {});
  return { id: u.id, admin: false, nom: u.nom, email: u.email };
}

export async function utilisateurDepuisRequete(req: Request): Promise<UtilisateurCourant | null> {
  return utilisateurDepuisJeton(lireCookie(req.headers.get("cookie"), NOM_COOKIE));
}

/** Pages serveur (composants React serveur). */
export async function utilisateurServeur(): Promise<UtilisateurCourant | null> {
  const { cookies } = await import("next/headers");
  return utilisateurDepuisJeton((await cookies()).get(NOM_COOKIE)?.value);
}

/** Oublie l'état mis en cache d'un compte (blocage, suppression, validation). */
export async function oublierCompte(id: string): Promise<void> {
  await getKV().del(`compte:actif:${id}`).catch(() => {});
}

export class AccesRefuse extends Error {
  constructor(public readonly statut: 401 | 403 | 404, message: string) {
    super(message);
  }
  reponse(): Response {
    return Response.json({ erreur: this.message, code: this.statut === 401 ? "non_authentifie" : "acces_refuse" }, { status: this.statut });
  }
}

export async function exigerUtilisateur(req: Request): Promise<UtilisateurCourant> {
  const u = await utilisateurDepuisRequete(req);
  if (!u) throw new AccesRefuse(401, "Session expirée ou compte désactivé : reconnectez-vous.");
  return u;
}

export async function exigerAdmin(req: Request): Promise<UtilisateurCourant> {
  const u = await exigerUtilisateur(req);
  if (!u.admin) throw new AccesRefuse(403, "Réservé à l'administrateur.");
  return u;
}

/**
 * Accès à une conversation : la sienne, ou une conversation encore inexistante (elle sera créée
 * avec ce propriétaire). Une conversation d'un autre compte répond « introuvable », pour ne rien
 * révéler de son existence.
 */
export async function exigerConversation(u: UtilisateurCourant, conversationId: string): Promise<{ existe: boolean }> {
  const { proprietaireConversation } = await import("@/lib/db/conversations");
  const c = await proprietaireConversation(conversationId);
  if (c.existe && c.proprietaire !== proprietaire(u)) throw new AccesRefuse(404, "Conversation introuvable.");
  return { existe: c.existe };
}

/** Enveloppe une route : transforme AccesRefuse en réponse HTTP. */
export function avecAcces<A extends unknown[]>(gestionnaire: (...a: A) => Promise<Response>): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    try {
      return await gestionnaire(...a);
    } catch (e) {
      if (e instanceof AccesRefuse) return e.reponse();
      throw e;
    }
  };
}
