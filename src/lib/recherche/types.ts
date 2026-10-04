export interface ResultatRecherche {
  titre: string;
  url: string;
  extrait: string;
  /** Extrait du contenu de la page (lecture des premiers résultats). */
  contenu?: string;
}

export type MoteurRecherche = "bing" | "duckduckgo" | "brave" | "tavily" | "jina" | "wikipedia";

export interface Recherche {
  requete: string;
  moteur: MoteurRecherche;
  resultats: ResultatRecherche[];
  /** Date de la recherche (epoch ms). */
  a: number;
}
