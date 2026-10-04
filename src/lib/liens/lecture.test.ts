import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { condenserPage, reduireExtractif } from "./condenser";
import { htmlVersMarkdown, lirePage } from "./lecture";

let serveur: Server;
let base: string;

const HTML = `<!doctype html><html lang="fr"><head><title>Ouvrir une salle de sport</title></head><body>
<nav><a href="/">Accueil</a><a href="/blog">Blog</a></nav>
<article><h1>Ouvrir une salle de sport à Bordeaux</h1>
<p>${"Ouvrir une salle demande un business plan solide, un local adapté et une équipe formée. ".repeat(12)}</p>
<h2>Étapes</h2><ul><li>Étude de marché</li><li>Financement</li><li>Travaux</li></ul>
<pre><code>const prix = 29.90;</code></pre>
<p>Voir aussi <a href="/guide">le guide</a>.</p></article>
<footer>© 2026</footer></body></html>`;

beforeAll(async () => {
  serveur = createServer((req, res) => {
    const u = req.url ?? "/";
    if (u === "/article") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(HTML);
    }
    if (u === "/redirect") {
      res.writeHead(302, { location: "/article" });
      return res.end();
    }
    if (u === "/vide") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body><div id=app></div><script>render()</script></body></html>");
    }
    if (u === "/gros") {
      res.writeHead(200, { "content-type": "text/html", "content-length": String(50 * 1024 * 1024) });
      return res.end("x");
    }
    if (u === "/texte.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("Un simple fichier texte avec suffisamment de caractères pour être considéré comme du contenu.");
    }
    if (u === "/lent") return; // ne répond jamais
    if (u.startsWith("/jina/")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: 200, data: { title: "Rendu par Jina", content: "# Titre\n\nContenu rendu côté serveur par Jina Reader, suffisamment long pour passer.", url: u.slice(6) } }));
    }
    res.writeHead(404);
    res.end("non");
  });
  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => serveur.close(() => r())));

const opts = { autoriserPrive: true, sansJina: true } as const;

describe("htmlVersMarkdown", () => {
  it("extrait l'article et convertit en Markdown", () => {
    const r = htmlVersMarkdown(HTML, "https://exemple.fr/article");
    expect(r?.titre).toBe("Ouvrir une salle de sport");
    expect(r?.contenu).toMatch(/^# Ouvrir une salle de sport/);
    expect(r?.contenu).toContain("- Étude de marché");
    expect(r?.contenu).toContain("```");
    expect(r?.contenu).not.toContain("Accueil");
  });
});

describe("lirePage", () => {
  it("lit une page HTML directement", async () => {
    const r = await lirePage(`${base}/article`, opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("direct");
      expect(r.titre).toBe("Ouvrir une salle de sport");
      expect(r.caracteres).toBeGreaterThan(500);
    }
  });
  it("suit les redirections", async () => {
    const r = await lirePage(`${base}/redirect`, opts);
    expect(r.ok && r.urlFinale.endsWith("/article")).toBe(true);
  });
  it("lit un fichier texte", async () => {
    const r = await lirePage(`${base}/texte.txt`, opts);
    expect(r.ok && r.contenu).toMatch(/simple fichier/);
  });
  it("refuse les pages trop volumineuses et les délais dépassés", async () => {
    const g = await lirePage(`${base}/gros`, opts);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.erreur).toMatch(/volumineuse/);
    const l = await lirePage(`${base}/lent`, { ...opts, delaiMs: 300 });
    expect(l.ok).toBe(false);
  });
  it("signale clairement une 404", async () => {
    const r = await lirePage(`${base}/inconnu`, opts);
    expect(!r.ok && r.erreur).toMatch(/404/);
  });
  it("bascule sur Jina pour une page rendue en JavaScript", async () => {
    const r = await lirePage(`${base}/vide`, { autoriserPrive: true, jinaBase: `${base}/jina/` });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("jina");
      expect(r.titre).toBe("Rendu par Jina");
    }
  });
  it("échoue proprement sans Jina", async () => {
    const r = await lirePage(`${base}/vide`, opts);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erreur).toMatch(/JavaScript/);
  });
  it("bloque les adresses privées par défaut", async () => {
    const r = await lirePage(`${base}/article`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erreur).toMatch(/refusé/);
  });
});

describe("condenserPage", () => {
  it("laisse intact ce qui tient", async () => {
    const r = await condenserPage("court", 1000, async () => "x");
    expect(r).toEqual({ contenu: "court", condense: false, tronque: false });
  });
  it("découpe, résume et fusionne, avec un nombre d'appels borné", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `## Section ${i}\n\nParagraphe ${i} utile avec des faits précis. Suite du paragraphe qui développe longuement le sujet.`).join("\n\n"); // ≈ 15k tokens
    const appels: number[] = [];
    const r = await condenserPage(long, 1500, async (t, consigne) => {
      appels.push(t.length);
      expect(consigne).toContain("condenses");
      return "résumé de tranche";
    });
    expect(r.condense).toBe(true);
    expect(appels.length).toBeGreaterThan(1);
    expect(appels.length).toBeLessThanOrEqual(6);
    expect(r.contenu).toContain("résumé de tranche");
  });
  it("réduit d'abord sans modèle les pages énormes", async () => {
    const enorme = Array.from({ length: 3000 }, (_, i) => (i % 10 === 0 ? `## Titre ${i}` : `Première phrase du paragraphe ${i}. Deuxième phrase beaucoup plus longue qui n'est pas indispensable pour comprendre.`)).join("\n\n"); // ≈ 100k tokens
    const r = reduireExtractif(enorme, 5000);
    expect(r.length).toBeLessThan(5000 * 3.2 + 100);
    expect(r).toContain("## Titre 0");
    expect(r).toContain("[… suite de la page omise …]");
    expect(r).not.toContain("Deuxième phrase beaucoup plus longue qui n'est pas indispensable pour comprendre.\n\nPremière phrase du paragraphe 2999");
    let appels = 0;
    const c = await condenserPage(enorme, 2000, async () => {
      appels++;
      return "r";
    });
    expect(c.condense).toBe(true);
    expect(appels).toBeLessThanOrEqual(4);
  });
  it("tronque si le résumé échoue", async () => {
    const r = await condenserPage("x ".repeat(10_000), 500, async () => {
      throw new Error("429");
    });
    expect(r.tronque).toBe(true);
    expect(r.contenu.length).toBeLessThan(2000);
  });
});
