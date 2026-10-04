import type { UIMessage } from "ai";
import type { NiveauRaisonnement } from "@/lib/fournisseurs/types";

export interface Reglages {
  systeme: string;
  temperature: number;
  maxTokens: number;
  raisonnement: NiveauRaisonnement;
  /** Le modèle peut déclencher lui-même une recherche web (outil). */
  rechercheAuto: boolean;
}

export const REGLAGES_DEFAUT: Reglages = {
  systeme:
    "Tu es un assistant utile, précis et concis. Tu réponds en français sauf si l'on te demande une autre langue. Tu utilises le Markdown quand c'est utile (listes, tableaux, blocs de code).",
  temperature: 0.7,
  maxTokens: 4096,
  raisonnement: "aucun",
  rechercheAuto: true,
};

export interface Bascule {
  de: string;
  vers: string;
  raison: string;
  /** true : le texte déjà affiché a été conservé et le suivant a continué. */
  continuation: boolean;
}

/** Métadonnées attachées à chaque réponse de l'assistant. */
export interface MetaMessage {
  fournisseur?: string;
  fournisseurId?: string;
  modele?: string;
  usage?: { entree: number; sortie: number; total: number };
  cout?: number;
  /** Cloudflare : neurons consommés par la réponse. */
  neurons?: number;
  bascules?: Bascule[];
  regenerations?: number;
  dureeMs?: number;
  /** Les anciens messages ont été résumés pour tenir dans le contexte. */
  resume?: boolean;
  creeA?: number;
}

/** Parties de données personnalisées envoyées pendant le flux. */
export type DonneesChat = {
  bascule: Bascule;
  /** Marqueur : tout ce qui précède dans le message doit être ignoré (réponse régénérée). */
  regeneration: { raison: string };
  info: { texte: string };
  "tous-epuises": { message: string; reessaiA?: number; fournisseur?: string };
  recherche: {
    requete: string;
    etat: "en-cours" | "ok" | "erreur";
    moteur?: string;
    resultats?: Array<{ titre: string; url: string; extrait: string }>;
    erreur?: string;
  };
  "page-lue": {
    url: string;
    titre: string;
    source: "direct" | "jina" | "pdf";
    caracteres: number;
    ok: boolean;
    erreur?: string;
    /** Contenu condensé, réinjecté dans le contexte des tours suivants (non affiché). */
    contenu?: string;
    condense?: boolean;
  };
};

export type MessageUI = UIMessage<MetaMessage, DonneesChat>;

export interface CorpsRequeteChat {
  messages: MessageUI[];
  conversationId: string;
  reglages?: Partial<Reglages>;
  /** Recherche web forcée sur le dernier message (bouton globe). */
  rechercheWeb?: boolean;
}
