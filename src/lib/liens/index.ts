/**
 * Lecture des liens d'un message : détection, lecture en cascade, condensation,
 * cache KV (24 h) et préparation du texte injecté dans le contexte du modèle.
 */
import type { KV } from "@/lib/kv";
import { estimerTokens } from "@/lib/chat/contexte";
import { condenserPage, type Resumeur } from "./condenser";
import { detecterLiens } from "./detecter";
import { lirePage, type OptionsLecture, type ResultatLecture } from "./lecture";

export { detecterLiens };

export interface PageLuePart {
  url: string;
  titre: string;
  source: "direct" | "jina" | "pdf";
  caracteres: number;
  ok: boolean;
  erreur?: string;
  /** Contenu (éventuellement condensé) réinjecté dans le contexte des tours suivants. */
  contenu?: string;
  condense?: boolean;
}

const TTL_CACHE = 24 * 3600;

export async function lireLiensDuMessage(
  texte: string,
  params: {
    kv: KV;
    resumer: Resumeur;
    /** Budget de tokens par page. */
    budgetParPage: number;
    options?: OptionsLecture;
    onPage?: (p: PageLuePart) => void;
  },
): Promise<PageLuePart[]> {
  const liens = detecterLiens(texte);
  if (liens.length === 0) return [];
  const resultats = await Promise.all(
    liens.map(async (url): Promise<PageLuePart> => {
      const cle = `lien:${url}`;
      const cache = await params.kv.get<ResultatLecture>(cle);
      const r = cache ?? (await lirePage(url, params.options));
      if (!cache && r.ok) await params.kv.set(cle, r, TTL_CACHE);
      if (!r.ok) {
        const p: PageLuePart = { url, titre: url, source: "direct", caracteres: 0, ok: false, erreur: r.erreur };
        params.onPage?.(p);
        return p;
      }
      const c = await condenserPage(r.contenu, params.budgetParPage, params.resumer);
      const p: PageLuePart = {
        url,
        titre: r.titre,
        source: r.source,
        caracteres: r.caracteres,
        ok: true,
        contenu: c.contenu,
        condense: c.condense || c.tronque,
      };
      params.onPage?.(p);
      return p;
    }),
  );
  return resultats;
}

/** Texte ajouté au message de l'utilisateur pour donner au modèle le contenu des pages. */
export function blocPagesPourModele(pages: PageLuePart[]): string {
  const lignes: string[] = [];
  for (const p of pages) {
    if (p.ok && p.contenu) {
      lignes.push(
        `<page_lue url="${p.url}" titre="${p.titre.replace(/"/g, "'")}"${p.condense ? ' condensee="oui"' : ""}>\n${p.contenu}\n</page_lue>`,
      );
    } else {
      lignes.push(`<page_non_lue url="${p.url}" raison="${(p.erreur ?? "inconnue").replace(/"/g, "'")}" />`);
    }
  }
  if (!lignes.length) return "";
  return (
    "\n\n---\nContenu des liens du message, lu par le serveur. Appuie-toi uniquement sur ce contenu pour parler de ces pages. " +
    "Pour une page non lue, dis clairement que tu n'as pas pu la lire et propose à l'utilisateur de coller le texte.\n" +
    lignes.join("\n")
  );
}

export function budgetPage(contexteMin: number): number {
  return Math.max(3000, Math.min(12_000, Math.floor(contexteMin * 0.25)));
}

export { estimerTokens };
