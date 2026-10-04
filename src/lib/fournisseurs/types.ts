/** Famille d'API : permet d'adapter quelques paramètres (raisonnement, en-têtes). */
export type FamilleAPI = "groq" | "openrouter" | "cloudflare" | "generique";

export interface Fournisseur {
  /** Identifiant stable (slug du nom + rang). */
  id: string;
  rang: number;
  nom: string;
  baseUrl: string;
  apiKey: string;
  modele: string;
  /** Taille de la fenêtre de contexte, en tokens. */
  contexte: number;
  /** Fournisseur payant à l'usage (dernier recours, plafonné). */
  payant: boolean;
  famille: FamilleAPI;
}

/** Fournisseur sans secret, exposable au client. */
export type FournisseurPublic = Omit<Fournisseur, "apiKey">;

export type Statut = "disponible" | "epuise" | "erreur" | "inconnu";

export interface QuotaInfo {
  requetesRestantes?: number;
  requetesLimite?: number;
  tokensRestants?: number;
  tokensLimite?: number;
  /** Epoch ms où les compteurs de requêtes se réinitialisent. */
  resetRequetesA?: number;
  resetTokensA?: number;
  /** OpenRouter : requêtes gratuites du jour. */
  journalierUtilise?: number;
  journalierLimite?: number;
}

export interface EtatFournisseur {
  statut: Statut;
  /** Epoch ms à partir duquel on peut réessayer (si épuisé/erreur). */
  reessaiA?: number;
  raison?: string;
  quota?: QuotaInfo;
  /** Epoch ms de la dernière réponse réussie. */
  derniereReussiteA?: number;
  derniereErreurA?: number;
  dernierTest?: {
    a: number;
    ok: boolean;
    latenceMs: number;
    message: string;
    tokens?: { entree: number; sortie: number };
  };
  majA: number;
}

export type NiveauRaisonnement = "aucun" | "faible" | "moyen" | "eleve";
