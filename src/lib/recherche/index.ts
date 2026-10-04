/**
 * Recherche web en cascade : DuckDuckGo (sans clé) → Brave / Tavily / Jina (si clé) → Wikipédia.
 * Les deux premiers résultats sont lus (sans appel au modèle) pour donner du contenu, pas que des extraits.
 */
import type { KV } from "@/lib/kv";
import { reduireExtractif } from "@/lib/liens/condenser";
import { lirePage } from "@/lib/liens/lecture";
import { rechercherDuckDuckGo } from "./duckduckgo";
import { rechercherBrave, rechercherJina, rechercherTavily, rechercherWikipedia } from "./moteurs";
import type { MoteurRecherche, Recherche, ResultatRecherche } from "./types";

export type { Recherche, ResultatRecherche };

export interface OptionsRecherche {
  kv?: KV;
  max?: number;
  /** Nombre de pages lues en entier (extrait réduit). */
  pagesLues?: number;
  /** Budget de tokens par page lue. */
  budgetPage?: number;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  log?: (m: string) => void;
}

const TTL_CACHE = 3600;

export async function rechercherWeb(requeteBrute: string, opts: OptionsRecherche = {}): Promise<Recherche> {
  const requete = requeteBrute.replace(/\s+/g, " ").trim().slice(0, 300);
  const max = opts.max ?? 5;
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const cle = `recherche:${requete.toLowerCase()}`;
  const cache = await opts.kv?.get<Recherche>(cle);
  if (cache) return cache;

  const moteurs: Array<[MoteurRecherche, () => Promise<ResultatRecherche[]>]> = [
    ["duckduckgo", () => rechercherDuckDuckGo(requete, max, f)],
  ];
  if (env.BRAVE_API_KEY) moteurs.push(["brave", () => rechercherBrave(requete, max, env.BRAVE_API_KEY!, f)]);
  if (env.TAVILY_API_KEY) moteurs.push(["tavily", () => rechercherTavily(requete, max, env.TAVILY_API_KEY!, f)]);
  if (env.JINA_API_KEY) moteurs.push(["jina", () => rechercherJina(requete, max, env.JINA_API_KEY!, f)]);
  moteurs.push(["wikipedia", () => rechercherWikipedia(requete, max, f)]);

  let resultats: ResultatRecherche[] = [];
  let moteur: MoteurRecherche = "duckduckgo";
  const erreurs: string[] = [];
  for (const [nom, fn] of moteurs) {
    try {
      const r = await fn();
      if (r.length) {
        resultats = r;
        moteur = nom;
        break;
      }
      erreurs.push(`${nom} : aucun résultat`);
    } catch (e) {
      erreurs.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (!resultats.length) {
    log(`[recherche] échec pour « ${requete} » : ${erreurs.join(" ; ")}`);
    throw new Error(`Recherche impossible : ${erreurs.join(" ; ")}`);
  }

  // Lecture des premiers résultats (lecture directe seulement, courte, sans résumé par le modèle).
  const nbPages = opts.pagesLues ?? 2;
  const budget = opts.budgetPage ?? 800;
  await Promise.all(
    resultats.slice(0, nbPages).map(async (r) => {
      try {
        const page = await lirePage(r.url, { delaiMs: 8_000, maxOctets: 3 * 1024 * 1024, sansJina: true, fetch: f });
        if (page.ok) r.contenu = reduireExtractif(page.contenu, budget);
      } catch {
        /* extrait seul */
      }
    }),
  );

  const recherche: Recherche = { requete, moteur, resultats, a: Date.now() };
  await opts.kv?.set(cle, recherche, TTL_CACHE);
  return recherche;
}

/** Bloc texte donné au modèle. */
export function blocRecherchePourModele(r: Recherche): string {
  const lignes = r.resultats.map((x, i) => {
    const base = `[${i + 1}] ${x.titre}\nURL : ${x.url}\nExtrait : ${x.extrait}`;
    return x.contenu ? `${base}\nContenu :\n${x.contenu}` : base;
  });
  return (
    `<resultats_recherche requete="${r.requete.replace(/"/g, "'")}" moteur="${r.moteur}" date="${new Date(r.a).toISOString().slice(0, 10)}">\n` +
    lignes.join("\n\n") +
    `\n</resultats_recherche>\n` +
    "Appuie-toi sur ces résultats pour répondre, cite tes sources sous forme de liens Markdown [titre](url), " +
    "et signale ce qui reste incertain. Si les résultats ne répondent pas à la question, dis-le."
  );
}
