/**
 * Application de la modération aux messages des MEMBRES (jamais aux administrateurs).
 *
 *  - contenu sexuel explicite / fabrication d'armes réelles → message refusé (403), rien d'autre ;
 *  - déclaration d'être mineur → compte bloqué + IP bannie, accès coupé (« sauf pour les admins »).
 *
 * Volontairement tolérant : en cas d'erreur interne (base, KV), on laisse passer plutôt que de
 * couper l'accès à tort — le filtre est un garde-fou, pas une barrière infaillible.
 */
import type { UtilisateurCourant } from "@/lib/auth/utilisateur";
import { ipDepuisRequete } from "@/lib/auth/tentatives";
import { categoriserMessage, messageRefus, type Categorie } from "./categorise";
import { bannirIp } from "./banip";

export interface ResultatModeration {
  /** true si le message doit être refusé. */
  bloque: boolean;
  statut?: number;
  message?: string;
  categorie?: Categorie;
  /** true si l'IP a été bannie et le compte bloqué (cas mineur). */
  banni?: boolean;
}

const OK: ResultatModeration = { bloque: false };

/** Partie texte d'un message (parts `text`) ; tolère les formes anciennes `content: string`. */
function texteMessage(m: unknown): string {
  if (!m || typeof m !== "object") return "";
  const msg = m as { content?: unknown; parts?: Array<{ type?: string; text?: unknown }> };
  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.parts)) return "";
  return msg.parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ");
}

/** Texte du dernier message « user » d'une liste de messages d'UI. */
export function texteDernierUtilisateur(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string } | undefined;
    if (m?.role === "user") return texteMessage(m);
  }
  return "";
}

/** Bloque le compte et bannit l'IP (cas mineur). Tolérant aux pannes. */
async function bannirMineur(req: Request, u: UtilisateurCourant): Promise<void> {
  await bannirIp(ipDepuisRequete(req), { uid: u.id, raison: "mineur" });
  const [{ majUtilisateur }, { oublierCompte }] = await Promise.all([
    import("@/lib/db/utilisateurs"),
    import("@/lib/auth/utilisateur"),
  ]);
  await majUtilisateur(u.id, { statut: "bloque" }).catch(() => null);
  await oublierCompte(u.id).catch(() => {});
}

/**
 * Applique la modération au texte fourni (dernier message de l'utilisateur, objectif de tâche…).
 * Les administrateurs ne sont jamais filtrés.
 */
export async function modererTexte(req: Request, u: UtilisateurCourant, texte: string): Promise<ResultatModeration> {
  if (u.admin) return OK;
  const verdict = categoriserMessage(texte);
  if (!verdict.categorie) return OK;
  if (verdict.categorie === "mineur") {
    await bannirMineur(req, u).catch(() => {});
    return { bloque: true, statut: 403, categorie: "mineur", message: messageRefus("mineur"), banni: true };
  }
  return { bloque: true, statut: 403, categorie: verdict.categorie, message: messageRefus(verdict.categorie) };
}
