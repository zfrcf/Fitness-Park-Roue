/**
 * Texte en cours d'une réponse générée par une tâche de fond, publié dans le KV pour que la
 * conversation l'affiche en direct (sinon on ne voyait rien avant la fin de chaque réponse).
 * Écritures espacées (au plus une toutes les ~1,2 s) pour ménager le quota Upstash.
 */
import type { KV } from "@/lib/kv";

export const cleFlux = (conversationId: string) => `flux:${conversationId}`;

export interface FluxTache {
  texte: string;
  maj: number;
}

export function creerPublieurFlux(kv: KV, conversationId: string, intervalleMs = 1200, maintenant: () => number = Date.now) {
  let derniere = Number.NEGATIVE_INFINITY; // la première écriture part tout de suite
  let enAttente: string | null = null;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let termine = false;
  let ecriture: Promise<void> = Promise.resolve();

  const ecrire = (texte: string) => {
    derniere = maintenant();
    enAttente = null;
    ecriture = ecriture
      .then(() => (termine ? undefined : kv.set(cleFlux(conversationId), { texte, maj: derniere } satisfies FluxTache, 120)))
      .catch(() => {});
  };

  return {
    /** Nouveau texte complet de la réponse en cours (appelé à chaque morceau reçu). */
    publier(texte: string) {
      if (termine) return;
      const attente = intervalleMs - (maintenant() - derniere);
      if (attente <= 0) {
        if (minuteur) clearTimeout(minuteur);
        minuteur = undefined;
        ecrire(texte);
        return;
      }
      enAttente = texte;
      if (!minuteur)
        minuteur = setTimeout(() => {
          minuteur = undefined;
          if (enAttente !== null) ecrire(enAttente);
        }, attente);
    },
    /** Réponse finie (enregistrée en base) : le texte provisoire disparaît. */
    async terminer() {
      termine = true;
      if (minuteur) clearTimeout(minuteur);
      await ecriture;
      await kv.del(cleFlux(conversationId)).catch(() => {});
    },
  };
}
