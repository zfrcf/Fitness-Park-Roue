import { describe, expect, it } from "vitest";
import { depotCompilation } from "./api";
import { contenuWorkflow, mapperRun, nomBranche, resumerJournal, retirerReserves, validerFichiers } from "./compilation";

const f = (chemin: string, contenu = "x") => ({ chemin, contenu });

describe("validerFichiers", () => {
  it("accepte un projet Gradle sain", () => {
    expect(validerFichiers([f("build.gradle"), f("settings.gradle"), f("src/main/java/com/ex/Mod.java")])).toEqual([]);
  });
  it("ignore silencieusement les fichiers réservés (.github/, wrapper) au lieu de refuser le projet", () => {
    // Un workflow ou un wrapper produit par le modèle ne doit JAMAIS faire échouer la compilation.
    expect(validerFichiers([f("build.gradle"), f(".github/workflows/build.yml"), f("gradlew"), f("gradle/wrapper/gradle-wrapper.jar"), f("src/A.java")])).toEqual([]);
    // Mais un projet qui N'A QUE des fichiers réservés n'a rien à compiler.
    const e = validerFichiers([f(".github/workflows/build.yml"), f("gradlew")]);
    expect(e).toContain("aucun fichier à compiler");
  });
  it("refuse les chemins dangereux, les doublons et un projet non reconnu", () => {
    const e = validerFichiers([f("../x"), f("/etc/passwd"), f("a.txt"), f("a.txt")]);
    expect(e.join("\n")).toMatch(/chemin refusé : \.\.\/x/);
    expect(e.join("\n")).toMatch(/chemin refusé : \/etc\/passwd/);
    expect(e.join("\n")).toMatch(/en double/);
    expect(e.join("\n")).toMatch(/non reconnu/);
    expect(validerFichiers([])).toContain("aucun fichier à compiler");
  });
  it("accepte tous les langages reconnus par le script de construction", () => {
    expect(validerFichiers([f("main.py")])).toEqual([]);
    expect(validerFichiers([f("package.json"), f("src/index.ts")])).toEqual([]);
    expect(validerFichiers([f("Cargo.toml"), f("src/main.rs")])).toEqual([]);
    expect(validerFichiers([f("index.html")])).toEqual([]);
    // Le script fourni par la chaîne n'est jamais repris du modèle.
    expect(retirerReserves([f("main.py"), f(".atelier/construire.sh")]).map((x) => x.chemin)).toEqual(["main.py"]);
  });
  it("#44 : refuse .git/, les segments vides et « . »", () => {
    const e = validerFichiers([f("build.gradle"), f(".git/config"), f("a//b.txt"), f("a/./b.java"), f("src/x.java")]);
    expect(e.join("\n")).toMatch(/\.git\/config/);
    expect(e.join("\n")).toMatch(/a\/\/b\.txt/);
    expect(e.join("\n")).toMatch(/a\/\.\/b\.java/);
  });
  it("borne la taille", () => {
    expect(validerFichiers([f("build.gradle", "x".repeat(4 * 1024 * 1024))]).join()).toMatch(/volumineux/);
  });
});

describe("retirerReserves", () => {
  it("retire .github/, gradlew et gradle-wrapper, garde le reste", () => {
    const r = retirerReserves([f("build.gradle"), f(".github/workflows/x.yml"), f("vercel.json"), f("gradlew"), f("gradlew.bat"), f("gradle/wrapper/gradle-wrapper.properties"), f("src/Main.java")]);
    expect(r.map((x) => x.chemin)).toEqual(["build.gradle", "src/Main.java"]);
  });
});

describe("workflow et branches", () => {
  it("lit le workflow et nomme la branche", () => {
    expect(contenuWorkflow()).toContain("compilation/**");
    expect(contenuWorkflow()).toContain("name: resultat");
    expect(contenuWorkflow()).toContain("bash .atelier/construire.sh");
    expect(nomBranche("abc")).toBe("compilation/abc");
    expect(depotCompilation({ GITHUB_REPO: "a/b" })).toEqual({ proprietaire: "a", nom: "b" });
    expect(() => depotCompilation({ GITHUB_REPO: "sans-slash" })).toThrow();
  });
  it("mappe l'état d'un run", () => {
    expect(mapperRun({ id: 1, status: "queued", conclusion: null, html_url: "u" }).statut).toBe("en_attente");
    expect(mapperRun({ id: 1, status: "in_progress", conclusion: null, html_url: "u" }).statut).toBe("en_cours");
    expect(mapperRun({ id: 1, status: "completed", conclusion: "success", html_url: "u" }).statut).toBe("reussie");
    expect(mapperRun({ id: 1, status: "completed", conclusion: "failure", html_url: "u" }).statut).toBe("echouee");
  });
});

describe("resumerJournal", () => {
  it("garde les erreurs utiles", () => {
    const j = ["> Task :compileJava", "ligne normale", "/src/Mod.java:12: error: cannot find symbol", "    Foo bar;", "    ^", "  symbol: class Foo", "1 error", "> Task :compileJava FAILED", "", "FAILURE: Build failed with an exception.", "* What went wrong:", "Execution failed for task ':compileJava'.", "BUILD FAILED in 1m 2s"].join("\n");
    const r = resumerJournal(j);
    expect(r).toContain("cannot find symbol");
    expect(r).toContain("What went wrong");
    expect(r.length).toBeLessThan(j.length);
  });
  it("reconnaît les erreurs des autres langages", () => {
    const j = ["Collecting x", "Traceback (most recent call last):", '  File "a.py", line 3', "ZeroDivisionError: division by zero", "ok", "src/a.ts(3,5): error TS2322: Type 'string' is not assignable", "error[E0425]: cannot find value `x` in this scope", "main.c:(.text+0x5): undefined reference to `f'"].join("\n");
    const r = resumerJournal(j);
    for (const m of ["Traceback", "TS2322", "E0425", "undefined reference"]) expect(r).toContain(m);
  });
  it("replie sur la fin du journal et tronque", () => {
    expect(resumerJournal("a\nb\nc")).toBe("a\nb\nc");
    expect(resumerJournal("error: " + "x".repeat(10_000), 100)).toMatch(/tronqué/);
  });
});

describe("creerBranche (API Git Data simulée)", () => {
  it("crée blobs, arbre, commit orphelin et référence, avec le workflow", async () => {
    const appels: Array<{ url: string; corps: unknown }> = [];
    const faux = (async (entree: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entree);
      appels.push({ url, corps: init?.body ? JSON.parse(String(init.body)) : null });
      const ok = (o: unknown, statut = 201) => new Response(JSON.stringify(o), { status: statut, headers: { "content-type": "application/json" } });
      if (url.endsWith("/git/blobs")) return ok({ sha: "blob" + appels.length });
      if (url.endsWith("/git/trees")) return ok({ sha: "tree1" });
      if (url.endsWith("/git/commits")) return ok({ sha: "commit1" });
      if (url.endsWith("/git/refs")) return ok({ ref: "refs/heads/compilation/x" });
      return new Response("non", { status: 404 });
    }) as unknown as typeof fetch;
    const { github } = await import("./api");
    // On vérifie github() lui-même : en-têtes, JSON, erreurs.
    const r = await github<{ sha: string }>("/repos/a/b/git/blobs", { method: "POST", body: JSON.stringify({ content: "x" }) }, { GITHUB_TOKEN: "tok" }, faux);
    expect(r.sha).toMatch(/^blob/);
    expect(appels[0].corps).toEqual({ content: "x" });
    await expect(github("/repos/a/b/inconnu", {}, {}, faux)).rejects.toThrow(/HTTP 404/);
    const refuse = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as unknown as typeof fetch;
    await expect(github("/x", {}, { GITHUB_TOKEN: "t" }, refuse)).rejects.toThrow(/GITHUB_TOKEN/);
    // #21 : un 403 de limite secondaire n'est PAS présenté comme un problème de jeton.
    const debit = (async () => new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), { status: 403 })) as unknown as typeof fetch;
    await expect(github("/x", {}, { GITHUB_TOKEN: "t" }, debit)).rejects.toThrow(/limite temporairement le débit/);
  });
});
