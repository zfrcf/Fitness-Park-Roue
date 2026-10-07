/**
 * Réponse qui parle au lieu d'agir : l'utilisateur demande une modification du projet et le modèle
 * répond « je corrige… », « je vais vérifier les noms exacts… » sans écrire un seul fichier (cas
 * réel, Kimi K3 sur un mod 26.2, trois fois de suite). On le relance alors une fois, sur place.
 */
import { extraireFichiers, extraireModifications } from "@/lib/fichiers/extraire";
import { INSTRUCTION_MODIFICATIONS } from "@/lib/fichiers/projet";

/** Demande d'action sur le code (et non une question ou une explication). */
const RE_DEMANDE =
  /\b(modifie|modifier|corrige|corriger|répare|réparer|change|changer|remplace|remplacer|ajoute|ajouter|supprime|supprimer|retire|retirer|renomme|renommer|implémente|implémenter|mets? à jour|mettre à jour|applique|appliquer|réécris|refais|refaire|fais[- ]le|fais[- ]les|vas[- ]y|continue|termine|code|crée|créer|écris|écrire|génère le code|fix)\b/i;
/** Question pure (« pourquoi… ? », « explique… ») : pas de relance, une réponse en texte est attendue. */
const RE_QUESTION = /^\s*(pourquoi|comment|qu'est-ce|est-ce que|explique|c'est quoi|que (fait|veut)|quel(le)?s?\b)[^]*\?\s*$/i;
/** Annonce d'un travail à venir dans la réponse (« je corrige », « je vais vérifier », « voici ce que je vais faire »). */
const RE_ANNONCE =
  /\b(je (vais |dois |m'apprête à )?(corrige|corriger|modifie|modifier|vérifie|vérifier|regarde|regarder|mets|mettre|applique|appliquer|ajoute|ajouter|remplace|remplacer|réécris|réécrire|refais|refaire|cherche|chercher|recherche|rechercher|commence|commencer|m'en occupe)|je corrige|voici (les|mes) (corrections|modifications)|étape suivante)/i;

export const CONSIGNE_RELANCE =
  "Tu viens de répondre SANS modifier aucun fichier, alors que la demande est de modifier le projet. " +
  "Personne ne va te répondre ni vérifier à ta place : écris MAINTENANT les modifications, directement, sans annonce " +
  "ni résumé préalable. Si un nom d'API est incertain, choisis le plus probable (la compilation te signalera l'erreur). " +
  INSTRUCTION_MODIFICATIONS;

export function consigneRelance(demande: string, reponse: string, aProjet: boolean): string | null {
  if (!aProjet || !demande.trim()) return null;
  if (extraireFichiers(reponse).length > 0 || extraireModifications(reponse).length > 0) return null;
  if (RE_QUESTION.test(demande) && !RE_ANNONCE.test(reponse)) return null;
  if (!RE_DEMANDE.test(demande) && !RE_ANNONCE.test(reponse)) return null;
  return CONSIGNE_RELANCE;
}
