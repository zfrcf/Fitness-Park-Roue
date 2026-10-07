import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typeProjet } from "@/lib/fichiers/extraire";
import { SCRIPT_CONSTRUCTION } from "./script-construction";
import { fichierATelecharger, nomProduit } from "./sortie";

let racine: string;
let script: string;

beforeAll(async () => {
  racine = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-script-"));
  script = path.join(racine, "construire.sh");
  await fs.writeFile(script, SCRIPT_CONSTRUCTION, { mode: 0o755 });
});
afterAll(() => fs.rm(racine, { recursive: true, force: true }));

describe("script de construction", () => {
  it("est du bash valide", () => {
    expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
  });

  // La détection du script (bash) et celle de l'interface (typeProjet) doivent toujours concorder.
  const cas: Array<[string[], string]> = [
    [["build.gradle", "src/main/java/A.java"], "gradle"],
    [["pom.xml"], "maven"],
    [["Cargo.toml", "src/main.rs"], "rust"],
    [["go.mod", "main.go"], "go"],
    [["package.json", "index.js"], "node"],
    [["App.csproj", "Program.cs"], "dotnet"],
    [["CMakeLists.txt", "main.cpp"], "cmake"],
    [["Makefile", "main.c"], "make"],
    [["src/app.py"], "python"],
    [["requirements.txt"], "python"],
    [["src/main.cpp"], "cpp"],
    [["main.c"], "c"],
    [["index.html", "style.css"], "web"],
    [["notes.txt"], "inconnu"],
  ];
  it.each(cas)("détecte %j comme %s (script et interface)", async (fichiers, attendu) => {
    const dossier = await fs.mkdtemp(path.join(racine, "p-"));
    for (const f of fichiers) {
      await fs.mkdir(path.dirname(path.join(dossier, f)), { recursive: true });
      await fs.writeFile(path.join(dossier, f), "");
    }
    const sortie = execFileSync("bash", [script, "--detecter"], { cwd: dossier, encoding: "utf8" }).trim();
    expect(sortie).toBe(`type=${attendu}`);
    expect(typeProjet(fichiers.map((chemin) => ({ chemin })))).toBe(attendu);
  });
});

describe("fichiers produits", () => {
  it("nomme le téléchargement : fichier seul, jar principal, archive, ou rien", () => {
    expect(nomProduit(["ATELIER-RESULTAT.txt"], "x")).toBeNull();
    expect(nomProduit(["ATELIER-RESULTAT.txt", "programme"], "x")).toBe("programme");
    expect(nomProduit(["mod-1.0.jar", "mod-1.0-sources.jar", "ATELIER-RESULTAT.txt"], "x")).toBe("mod-1.0.jar");
    expect(nomProduit(["dist/a.js", "dist/index.html"], "mon site")).toBe("mon_site.zip");
  });

  it("regroupe plusieurs produits en .zip à la demande", async () => {
    const f = (nom: string) => ({ nom, contenu: new TextEncoder().encode(nom) });
    const zip = await fichierATelecharger([f("ATELIER-RESULTAT.txt"), f("dist/a.js"), f("dist/b.js")], "site.zip");
    expect(zip?.nom).toBe("site.zip");
    const { default: JSZip } = await import("jszip");
    expect(Object.keys((await JSZip.loadAsync(zip!.contenu)).files).sort()).toEqual(["dist/", "dist/a.js", "dist/b.js"]);
    expect((await fichierATelecharger([f("programme")], "programme"))?.nom).toBe("programme");
  });
});
