import { describe, expect, it } from "vitest";
import { construireApercu, pagesHtml, resoudre } from "./apercu";

describe("aperçu web", () => {
  it("résout les liens relatifs et ignore les liens externes", () => {
    expect(resoudre("site/index.html", "css/a.css")).toBe("site/css/a.css");
    expect(resoudre("site/pages/b.html", "../js/app.js?v=2")).toBe("site/js/app.js");
    expect(resoudre("site/index.html", "/style.css")).toBe("style.css");
    expect(resoudre("index.html", "https://cdn.exemple/x.js")).toBeNull();
    expect(resoudre("index.html", "#haut")).toBeNull();
  });

  it("met index.html en premier", () => {
    expect(pagesHtml([{ chemin: "a.html", contenu: "" }, { chemin: "src/index.html", contenu: "" }, { chemin: "x.css", contenu: "" }])).toEqual(["src/index.html", "a.html"]);
  });

  it("insère CSS, JS et SVG du projet ; laisse les ressources externes", () => {
    const fichiers = [
      { chemin: "index.html", contenu: '<html><head><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="https://cdn/x.css"></head><body><img src="logo.svg"><script type="module" src="js/app.js"></script></body></html>' },
      { chemin: "style.css", contenu: "body{color:red}" },
      { chemin: "js/app.js", contenu: 'console.log("</script>")' },
      { chemin: "logo.svg", contenu: "<svg/>" },
    ];
    const html = construireApercu(fichiers, "index.html");
    expect(html).toContain("body{color:red}");
    expect(html).toContain('href="https://cdn/x.css"');
    expect(html).toContain('<script type="module"');
    expect(html).toContain("<\\/script>"); // pas de fermeture prématurée
    expect(html).toContain("data:image/svg+xml");
    expect(html).toContain("atelierApercu");
  });
});
