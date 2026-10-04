/** Moteurs avec clé (facultatifs) et repli Wikipédia (sans clé). */
import type { ResultatRecherche } from "./types";

export async function rechercherBrave(requete: string, max: number, cle: string, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", requete);
  u.searchParams.set("count", String(max));
  u.searchParams.set("search_lang", "fr");
  const r = await f(u, { headers: { accept: "application/json", "x-subscription-token": cle }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Brave : HTTP ${r.status}`);
  const j = (await r.json()) as { web?: { results?: Array<{ title: string; url: string; description?: string }> } };
  return (j.web?.results ?? []).slice(0, max).map((x) => ({ titre: x.title, url: x.url, extrait: x.description ?? "" }));
}

export async function rechercherTavily(requete: string, max: number, cle: string, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const r = await f("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cle}` },
    body: JSON.stringify({ query: requete, max_results: max, include_answer: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Tavily : HTTP ${r.status}`);
  const j = (await r.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
  return (j.results ?? []).slice(0, max).map((x) => ({ titre: x.title, url: x.url, extrait: (x.content ?? "").slice(0, 400) }));
}

export async function rechercherJina(requete: string, max: number, cle: string, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const r = await f(`https://s.jina.ai/${encodeURIComponent(requete)}`, {
    headers: { accept: "application/json", authorization: `Bearer ${cle}`, "x-respond-with": "no-content" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!r.ok) throw new Error(`Jina Search : HTTP ${r.status}`);
  const j = (await r.json()) as { data?: Array<{ title: string; url: string; description?: string; content?: string }> };
  return (j.data ?? []).slice(0, max).map((x) => ({ titre: x.title, url: x.url, extrait: (x.description ?? x.content ?? "").slice(0, 400) }));
}

/** Repli sans clé : recherche Wikipédia (fr puis en). Couvre les sujets encyclopédiques seulement. */
export async function rechercherWikipedia(requete: string, max: number, f: typeof fetch = fetch): Promise<ResultatRecherche[]> {
  const resultats: ResultatRecherche[] = [];
  for (const langue of ["fr", "en"]) {
    const u = new URL(`https://${langue}.wikipedia.org/w/api.php`);
    u.search = new URLSearchParams({ action: "query", list: "search", srsearch: requete, format: "json", srlimit: String(max), utf8: "1" }).toString();
    try {
      const r = await f(u, { headers: { "user-agent": "ChatIA/1.0 (assistant personnel)" }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { query?: { search?: Array<{ title: string; snippet: string }> } };
      for (const s of j.query?.search ?? []) {
        resultats.push({
          titre: s.title,
          url: `https://${langue}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
          extrait: s.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
        });
      }
    } catch {
      /* langue suivante */
    }
    if (resultats.length >= max) break;
  }
  return resultats.slice(0, max);
}
