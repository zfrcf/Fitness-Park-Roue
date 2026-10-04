/**
 * Recherche Bing via la page HTML (sans clé). Joignable depuis les centres de données,
 * contrairement à DuckDuckGo. Les liens sont des redirections Bing : l'URL réelle est
 * encodée en base64 dans le paramètre « u » (préfixe « a1 »).
 */
import { parseHTML } from "linkedom";
import type { ResultatRecherche } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function urlReelleBing(href: string): string | null {
  try {
    const u = new URL(href, "https://www.bing.com");
    if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/")) {
      const brut = u.searchParams.get("u");
      if (!brut || !brut.startsWith("a1")) return null;
      const b64 = brut.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const decode = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
      const cible = new URL(decode);
      return cible.protocol === "http:" || cible.protocol === "https:" ? cible.toString() : null;
    }
    if (u.hostname.endsWith("bing.com") || u.hostname.endsWith("microsoft.com")) return null;
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parserBing(html: string, max = 8): ResultatRecherche[] {
  const { document } = parseHTML(html);
  const resultats: ResultatRecherche[] = [];
  for (const bloc of document.querySelectorAll("li.b_algo")) {
    const lien = bloc.querySelector("h2 a");
    if (!lien) continue;
    const url = urlReelleBing(lien.getAttribute("href") ?? "");
    if (!url) continue;
    const titre = lien.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const extrait =
      bloc.querySelector(".b_caption p, p.b_lineclamp2, p.b_lineclamp3, p.b_lineclamp4, .b_algoSlug")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!titre) continue;
    resultats.push({ titre, url, extrait });
    if (resultats.length >= max) break;
  }
  return resultats;
}

export async function rechercherBing(requete: string, max = 8, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const u = new URL("https://www.bing.com/search");
  u.searchParams.set("q", requete);
  u.searchParams.set("setlang", "fr");
  u.searchParams.set("count", String(Math.max(10, max)));
  const r = await f(u, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "fr-FR,fr;q=0.9,en;q=0.7" },
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status !== 200) throw new Error(`Bing : HTTP ${r.status}`);
  const resultats = parserBing(await r.text(), max);
  if (!resultats.length) throw new Error("Bing : aucun résultat (page inattendue)");
  return resultats;
}
