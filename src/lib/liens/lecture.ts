/**
 * Lecture d'une page côté serveur, en cascade :
 *  1) téléchargement direct + Readability + conversion Markdown (ou extraction PDF) ;
 *  2) Jina Reader (pages rendues en JavaScript, sites qui bloquent) ;
 *  3) échec explicite.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { verifierUrl, type OptionsSecurite } from "./securite";

export type SourceLecture = "direct" | "jina" | "pdf";

export interface PageLue {
  ok: true;
  url: string;
  urlFinale: string;
  titre: string;
  contenu: string;
  source: SourceLecture;
  caracteres: number;
}

export interface EchecLecture {
  ok: false;
  url: string;
  erreur: string;
}

export type ResultatLecture = PageLue | EchecLecture;

export interface OptionsLecture extends OptionsSecurite {
  /** Taille maximale téléchargée (octets). */
  maxOctets?: number;
  /** Délai maximal par téléchargement (ms). */
  delaiMs?: number;
  /** Désactiver Jina (tests). */
  sansJina?: boolean;
  /** Base Jina (tests). */
  jinaBase?: string;
  fetch?: typeof fetch;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAX_OCTETS = 8 * 1024 * 1024;
const DELAI = 20_000;
const MAX_REDIRECTIONS = 5;

class ErreurHttp extends Error {
  constructor(
    public statut: number,
    message: string,
  ) {
    super(message);
  }
}

/** Téléchargement borné en taille et en durée, redirections revalidées une à une. */
async function telecharger(urlInitiale: URL, opts: OptionsLecture): Promise<{ octets: Uint8Array; type: string; urlFinale: string }> {
  const f = opts.fetch ?? fetch;
  const maxOctets = opts.maxOctets ?? MAX_OCTETS;
  const delai = opts.delaiMs ?? DELAI;
  let url = urlInitiale;
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    const r = await f(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*;q=0.8", "accept-language": "fr-FR,fr;q=0.9,en;q=0.7" },
      redirect: "manual",
      signal: AbortSignal.timeout(delai),
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = await verifierUrl(new URL(r.headers.get("location")!, url).toString(), opts);
      continue;
    }
    if (!r.ok) throw new ErreurHttp(r.status, `HTTP ${r.status}`);
    const taille = Number(r.headers.get("content-length") ?? 0);
    if (taille > maxOctets) throw new Error(`page trop volumineuse (${Math.round(taille / 1024 / 1024)} Mo)`);
    const lecteur = r.body?.getReader();
    if (!lecteur) throw new Error("réponse vide");
    const morceaux: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOctets) {
        await lecteur.cancel();
        throw new Error("page trop volumineuse");
      }
      morceaux.push(value);
    }
    const octets = new Uint8Array(total);
    let pos = 0;
    for (const m of morceaux) {
      octets.set(m, pos);
      pos += m.byteLength;
    }
    return { octets, type: (r.headers.get("content-type") ?? "").toLowerCase(), urlFinale: url.toString() };
  }
  throw new Error("trop de redirections");
}

function decoder(octets: Uint8Array, type: string): string {
  const m = /charset=([\w-]+)/i.exec(type);
  try {
    return new TextDecoder(m?.[1] ?? "utf-8", { fatal: false }).decode(octets);
  } catch {
    return new TextDecoder().decode(octets);
  }
}

function nettoyerMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(\s*)-\s{2,}/gm, "$1- ")
    .trim();
}

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
const BALISES_RETIREES = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "FORM", "BUTTON", "NAV", "FOOTER", "ASIDE", "TEMPLATE"]);
turndown.remove((node) => BALISES_RETIREES.has(node.nodeName));

export function htmlVersMarkdown(html: string, url: string): { titre: string; contenu: string } | null {
  const { document } = parseHTML(html);
  // Base pour les liens relatifs.
  const base = document.createElement("base");
  base.setAttribute("href", url);
  document.head?.appendChild(base);
  const titreDoc = document.querySelector("title")?.textContent?.trim() ?? "";
  let article: { title?: string | null; content?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  const texte = article?.textContent?.trim() ?? "";
  if (!article?.content || texte.length < 200) {
    // Repli : corps entier converti.
    const corps = document.body?.innerHTML ?? "";
    const md = nettoyerMarkdown(turndown.turndown(corps));
    if (md.replace(/\s+/g, " ").length < 200) return null;
    return { titre: titreDoc || url, contenu: md };
  }
  const titre = article.title?.trim() || titreDoc || url;
  let contenu = nettoyerMarkdown(turndown.turndown(article.content));
  // Readability retire souvent le titre principal : on le remet en tête.
  if (!/^#\s/.test(contenu)) contenu = `# ${titre}\n\n${contenu}`;
  return { titre, contenu };
}

async function pdfVersTexte(octets: Uint8Array): Promise<{ titre: string; contenu: string }> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  const doc = await getDocumentProxy(octets);
  const [{ text, totalPages }, meta] = await Promise.all([extractText(doc, { mergePages: true }), getMeta(doc).catch(() => null)]);
  const info = (meta as { info?: { Title?: string } } | null)?.info;
  const contenu = nettoyerMarkdown(text);
  if (!contenu) throw new Error("PDF sans texte extractible (scan ?)");
  return { titre: info?.Title?.trim() || `Document PDF (${totalPages} page${totalPages > 1 ? "s" : ""})`, contenu };
}

async function lireViaJina(url: string, opts: OptionsLecture): Promise<{ titre: string; contenu: string; urlFinale: string }> {
  const f = opts.fetch ?? fetch;
  const base = opts.jinaBase ?? "https://r.jina.ai/";
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-return-format": "markdown",
    "x-timeout": "30",
  };
  if (process.env.JINA_API_KEY) headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const r = await f(base + url, { headers, signal: AbortSignal.timeout((opts.delaiMs ?? DELAI) + 15_000) });
  if (!r.ok) {
    if (r.status === 429) throw new Error("Jina Reader : limite de requêtes atteinte, réessayez dans une minute");
    throw new Error(`Jina Reader : HTTP ${r.status}`);
  }
  const j = (await r.json()) as { data?: { title?: string; content?: string; url?: string } };
  const contenu = nettoyerMarkdown(j.data?.content ?? "");
  if (contenu.length < 50) throw new Error("Jina Reader : contenu vide");
  return { titre: j.data?.title?.trim() || url, contenu, urlFinale: j.data?.url || url };
}

export async function lirePage(brut: string, opts: OptionsLecture = {}): Promise<ResultatLecture> {
  let url: URL;
  try {
    url = await verifierUrl(brut, opts);
  } catch (e) {
    return { ok: false, url: brut, erreur: `lien refusé : ${e instanceof Error ? e.message : "invalide"}` };
  }

  let erreurDirecte = "";
  try {
    const { octets, type, urlFinale } = await telecharger(url, opts);
    const estPdf = type.includes("application/pdf") || /\.pdf($|\?)/i.test(urlFinale) || (octets[0] === 0x25 && octets[1] === 0x50 && octets[2] === 0x44 && octets[3] === 0x46);
    if (estPdf) {
      const { titre, contenu } = await pdfVersTexte(octets);
      return { ok: true, url: brut, urlFinale, titre, contenu, source: "pdf", caracteres: contenu.length };
    }
    const texte = decoder(octets, type);
    if (type.includes("text/html") || type.includes("application/xhtml") || /^\s*<(!doctype|html)/i.test(texte)) {
      const r = htmlVersMarkdown(texte, urlFinale);
      if (r) return { ok: true, url: brut, urlFinale, titre: r.titre, contenu: r.contenu, source: "direct", caracteres: r.contenu.length };
      erreurDirecte = "page sans contenu lisible (rendue en JavaScript ?)";
    } else if (type.includes("application/json")) {
      let contenu = texte;
      try {
        contenu = JSON.stringify(JSON.parse(texte), null, 2);
      } catch {
        /* brut */
      }
      return { ok: true, url: brut, urlFinale, titre: url.pathname.split("/").pop() || url.hostname, contenu: "```json\n" + contenu + "\n```", source: "direct", caracteres: contenu.length };
    } else if (type.startsWith("text/") || !type) {
      const contenu = nettoyerMarkdown(texte);
      if (contenu.length >= 50) {
        return { ok: true, url: brut, urlFinale, titre: url.pathname.split("/").pop() || url.hostname, contenu, source: "direct", caracteres: contenu.length };
      }
      erreurDirecte = "contenu vide";
    } else {
      erreurDirecte = `type de contenu non pris en charge (${type.split(";")[0]})`;
    }
  } catch (e) {
    erreurDirecte = e instanceof Error ? e.message : String(e);
    if (e instanceof ErreurHttp && (e.statut === 404 || e.statut === 410)) {
      return { ok: false, url: brut, erreur: "page introuvable (HTTP 404)" };
    }
  }

  if (opts.sansJina) return { ok: false, url: brut, erreur: erreurDirecte };

  try {
    const r = await lireViaJina(url.toString(), opts);
    return { ok: true, url: brut, urlFinale: r.urlFinale, titre: r.titre, contenu: r.contenu, source: "jina", caracteres: r.contenu.length };
  } catch (e) {
    const erreurJina = e instanceof Error ? e.message : String(e);
    return { ok: false, url: brut, erreur: `${erreurDirecte} ; ${erreurJina}` };
  }
}
