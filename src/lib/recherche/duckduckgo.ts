/**
 * Recherche DuckDuckGo via la page HTML (sans clé). Fragile par nature : si DuckDuckGo
 * renvoie un défi anti-robot (HTTP 202), on renvoie une liste vide et la cascade continue.
 */
import { parseHTML } from "linkedom";
import type { ResultatRecherche } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function urlReelle(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const cible = u.searchParams.get("uddg");
      return cible ? decodeURIComponent(cible) : null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parserDuckDuckGo(html: string, max = 8): ResultatRecherche[] {
  const { document } = parseHTML(html);
  const resultats: ResultatRecherche[] = [];
  for (const bloc of document.querySelectorAll(".result")) {
    if (bloc.classList.contains("result--ad")) continue;
    const lien = bloc.querySelector("a.result__a");
    if (!lien) continue;
    const url = urlReelle(lien.getAttribute("href") ?? "");
    if (!url) continue;
    const titre = lien.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const extrait = bloc.querySelector(".result__snippet")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!titre) continue;
    resultats.push({ titre, url, extrait });
    if (resultats.length >= max) break;
  }
  return resultats;
}

export async function rechercherDuckDuckGo(requete: string, max = 8, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const corps = new URLSearchParams({ q: requete, b: "", kl: "fr-fr" });
  const r = await f("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.7",
      "content-type": "application/x-www-form-urlencoded",
      referer: "https://html.duckduckgo.com/",
    },
    body: corps.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status !== 200) throw new Error(`DuckDuckGo : HTTP ${r.status}${r.status === 202 ? " (défi anti-robot)" : ""}`);
  return parserDuckDuckGo(await r.text(), max);
}
