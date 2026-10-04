import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getKV } from "@/lib/kv";
import { parserBing, urlReelleBing } from "./bing";
import { parserDuckDuckGo } from "./duckduckgo";
import { blocRecherchePourModele, rechercherWeb } from "./index";

const fixture = readFileSync(path.join(import.meta.dirname, "duckduckgo.fixture.html"), "utf8");
const fixtureBing = readFileSync(path.join(import.meta.dirname, "bing.fixture.html"), "utf8");

describe("parserBing", () => {
  it("décode les redirections et extrait les résultats", () => {
    expect(urlReelleBing("https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9taW5lY3JhZnQud2lraS93L0phdmFfRWRpdGlvbl8xLjIxLjEx&ntb=1")).toBe("https://minecraft.wiki/w/Java_Edition_1.21.11");
    expect(urlReelleBing("https://www.bing.com/ck/a?u=zzz")).toBeNull();
    const r = parserBing(fixtureBing);
    expect(r.length).toBeGreaterThanOrEqual(5);
    expect(r.every((x) => /^https?:\/\//.test(x.url) && !x.url.includes("bing.com"))).toBe(true);
    expect(r.some((x) => /minecraft/i.test(x.titre))).toBe(true);
    expect(r.filter((x) => x.extrait.length > 20).length).toBeGreaterThanOrEqual(3);
  });
});

describe("parserDuckDuckGo", () => {
  it("extrait titres, URL réelles et extraits", () => {
    const r = parserDuckDuckGo(fixture);
    expect(r.length).toBeGreaterThanOrEqual(5);
    expect(r[0].url).toMatch(/^https:\/\/www\.minecraft\.net/);
    expect(r[0].titre).toMatch(/1\.21\.11/);
    expect(r.every((x) => x.url.startsWith("http"))).toBe(true);
    expect(r.some((x) => x.extrait.length > 20)).toBe(true);
  });
});

describe("rechercherWeb", () => {
  const fauxFetch = (reponses: Record<string, () => Response>): typeof fetch =>
    (async (entree: RequestInfo | URL) => {
      const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.toString() : entree.url;
      for (const [prefixe, fn] of Object.entries(reponses)) if (url.startsWith(prefixe)) return fn();
      return new Response("non", { status: 404 });
    }) as typeof fetch;

  it("utilise Bing puis DuckDuckGo et lit les premières pages", async () => {
    const f = fauxFetch({
      "https://www.bing.com": () => new Response("<html><body>vide</body></html>", { status: 200 }),
      "https://html.duckduckgo.com": () => new Response(fixture, { status: 200, headers: { "content-type": "text/html" } }),
      "https://www.minecraft.net": () =>
        new Response(`<html><head><title>Article</title></head><body><article><h1>Minecraft Java Edition 1.21.11</h1><p>${"Cette mise à jour corrige des bugs et apporte des nouveautés. ".repeat(20)}</p></article></body></html>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const r = await rechercherWeb("minecraft 1.21.11", { fetch: f, env: {}, pagesLues: 1, kv: getKV() });
    expect(r.moteur).toBe("duckduckgo");
    expect(r.resultats[0].contenu).toMatch(/corrige des bugs/);
    const bloc = blocRecherchePourModele(r);
    expect(bloc).toContain("<resultats_recherche");
    expect(bloc).toContain("[1] ");
    // cache
    const r2 = await rechercherWeb("minecraft 1.21.11", { fetch: fauxFetch({}), env: {}, kv: getKV() });
    expect(r2.resultats.length).toBe(r.resultats.length);
  });

  it("bascule sur Wikipédia si Bing et DuckDuckGo échouent", async () => {
    const f = fauxFetch({
      "https://www.bing.com": () => new Response("", { status: 429 }),
      "https://html.duckduckgo.com": () => new Response("challenge", { status: 202 }),
      "https://fr.wikipedia.org": () => new Response(JSON.stringify({ query: { search: [{ title: "Minecraft", snippet: "Jeu <span>vidéo</span>" }] } }), { status: 200 }),
    });
    const r = await rechercherWeb("minecraft wikipedia", { fetch: f, env: {}, pagesLues: 0 });
    expect(r.moteur).toBe("wikipedia");
    expect(r.resultats[0]).toMatchObject({ titre: "Minecraft", extrait: "Jeu vidéo" });
    expect(r.resultats[0].url).toContain("fr.wikipedia.org/wiki/Minecraft");
  });

  it("utilise Brave en priorité quand la clé existe", async () => {
    const f = fauxFetch({
      "https://api.search.brave.com": () => new Response(JSON.stringify({ web: { results: [{ title: "T", url: "https://ex.com", description: "D" }] } }), { status: 200 }),
    });
    const r = await rechercherWeb("x", { fetch: f, env: { BRAVE_API_KEY: "k" }, pagesLues: 0 });
    expect(r.moteur).toBe("brave");
  });

  it("échoue proprement si tout échoue", async () => {
    await expect(rechercherWeb("x", { fetch: fauxFetch({}), env: {}, pagesLues: 0 })).rejects.toThrow(/Recherche impossible/);
  });
});
