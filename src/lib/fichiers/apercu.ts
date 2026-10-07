/**
 * Aperçu d'un site statique produit dans la conversation : la page HTML est assemblée en un seul
 * document (feuilles de style, scripts et images SVG du projet insérés en ligne), affiché dans un
 * iframe isolé (srcdoc, sans accès à l'application).
 */
export interface FichierApercu {
  chemin: string;
  contenu: string;
}

/** Pages HTML du projet, index.html d'abord. */
export function pagesHtml(fichiers: FichierApercu[]): string[] {
  return fichiers
    .map((f) => f.chemin)
    .filter((c) => /\.html?$/i.test(c))
    .sort((a, b) => Number(!/(^|\/)index\.html?$/i.test(a)) - Number(!/(^|\/)index\.html?$/i.test(b)) || a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/** Résout un lien relatif (« ../css/a.css », « ./b.js », « /c.js ») depuis le dossier de la page. */
export function resoudre(page: string, lien: string): string | null {
  if (/^([a-z][\w+.-]*:|\/\/|#|data:)/i.test(lien)) return null; // externe ou ancre
  const propre = lien.split(/[?#]/)[0];
  const segments = propre.startsWith("/") ? [] : page.split("/").slice(0, -1);
  for (const s of propre.replace(/^\//, "").split("/")) {
    if (s === "..") segments.pop();
    else if (s && s !== ".") segments.push(s);
  }
  return segments.join("/");
}

const echapperAttribut = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function construireApercu(fichiers: FichierApercu[], page: string): string {
  const parChemin = new Map(fichiers.map((f) => [f.chemin, f.contenu]));
  const lire = (lien: string) => {
    const c = resoudre(page, lien);
    return c !== null ? parChemin.get(c) : undefined;
  };
  let html = parChemin.get(page) ?? "";
  // <link rel="stylesheet" href="…"> → <style>…</style>
  html = html.replace(/<link\b[^>]*>/gi, (balise) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(balise)) return balise;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1];
    const css = href ? lire(href) : undefined;
    return css === undefined ? balise : `<style data-source="${echapperAttribut(href!)}">\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
  });
  // <script src="…"></script> → <script>…</script> (type="module" conservé)
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (balise, avant: string, src: string, apres: string) => {
    const js = lire(src);
    if (js === undefined) return balise;
    return `<script${avant}${apres} data-source="${echapperAttribut(src)}">\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`;
  });
  // Images SVG du projet (seules images texte disponibles) en data: URL.
  html = html.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+\.svg)(["'])/gi, (tout, debut: string, src: string, fin: string) => {
    const svg = lire(src);
    return svg === undefined ? tout : `${debut}data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}${fin}`;
  });
  // Les liens entre pages ne peuvent pas naviguer dans un srcdoc : on les signale à l'application.
  const pont = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");if(!h||/^([a-z][\\w+.-]*:|\\/\\/|#)/i.test(h))return;e.preventDefault();parent.postMessage({atelierApercu:h},"*");});</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pont}</body>`) : html + pont;
}
