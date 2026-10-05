import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Compilation } from "@/lib/db/compilations";

const etats = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/db/compilations", () => ({
  majCompilation: vi.fn(async (id: string, v: Record<string, unknown>) => {
    const c = { ...(etats.get(id) ?? { id }), ...v };
    etats.set(id, c);
    return c;
  }),
}));

import { cheminJarLocal, dossierEspace, lancerCompilationLocale, rafraichirLocale, synchroniserEspace } from "./locale";

let racine: string;
let gradle: string;

beforeAll(async () => {
  racine = await fs.mkdtemp(path.join(os.tmpdir(), "atelier-locale-"));
  process.env.ATELIER_COMPILATIONS_DIR = path.join(racine, "compilations");
  // Faux Gradle : échoue si src/Erreur.java existe, sinon produit build/libs/mod-1.0.jar (+ -sources).
  gradle = path.join(racine, "gradle");
  await fs.writeFile(
    gradle,
    [
      "#!/bin/sh",
      'echo "> Task :compileJava"',
      'if [ -f src/Erreur.java ]; then echo "src/Erreur.java:1: error: cannot find symbol" >&2; echo "BUILD FAILED"; exit 1; fi',
      "mkdir -p build/libs",
      'printf "JAR" > build/libs/mod-1.0.jar',
      'printf "SRC" > build/libs/mod-1.0-sources.jar',
      'echo "BUILD SUCCESSFUL"',
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterAll(async () => {
  await fs.rm(racine, { recursive: true, force: true });
  delete process.env.ATELIER_COMPILATIONS_DIR;
});

beforeEach(() => etats.clear());

function compilation(id: string, conversationId = "conv-1"): Compilation {
  const c = { id, conversationId, messageId: "m", branche: `local/${id}`, statut: "en_attente", jarNom: null } as unknown as Compilation;
  etats.set(id, { ...c });
  return c;
}

const resumer = (j: string) => j.split("\n").filter((l) => /error|FAILED/.test(l)).join("\n");

describe("synchroniserEspace", () => {
  it("écrit les fichiers, retire ceux en trop et garde build/.gradle", async () => {
    const dossier = path.join(racine, "sync");
    await synchroniserEspace(dossier, [
      { chemin: "a.txt", contenu: "A" },
      { chemin: "src/b.txt", contenu: "B" },
    ]);
    await fs.mkdir(path.join(dossier, "build"), { recursive: true });
    await fs.writeFile(path.join(dossier, "build", "cache"), "x");
    const avant = (await fs.stat(path.join(dossier, "a.txt"))).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await synchroniserEspace(dossier, [{ chemin: "a.txt", contenu: "A" }]);
    expect((await fs.stat(path.join(dossier, "a.txt"))).mtimeMs).toBe(avant); // inchangé → pas réécrit
    await expect(fs.stat(path.join(dossier, "src"))).rejects.toThrow(); // fichier et dossier vide retirés
    expect(await fs.readFile(path.join(dossier, "build", "cache"), "utf8")).toBe("x");
  });

  it("refuse un chemin hors de l'espace", async () => {
    await expect(synchroniserEspace(path.join(racine, "sync2"), [{ chemin: "../evasion.txt", contenu: "x" }])).rejects.toThrow(/hors de l'espace/);
  });
});

describe("lancerCompilationLocale", () => {
  it("réussite : jar principal copié, statut reussie", async () => {
    const c = compilation("c-ok");
    await lancerCompilationLocale(c, [{ chemin: "build.gradle", contenu: "// projet" }], { gradle, resumer });
    const e = etats.get("c-ok")!;
    expect(e.statut).toBe("reussie");
    expect(e.jarNom).toBe("mod-1.0.jar");
    const jar = cheminJarLocal({ id: "c-ok", jarNom: "mod-1.0.jar" })!;
    expect(await fs.readFile(jar, "utf8")).toBe("JAR");
  });

  it("échec : statut echouee avec le journal résumé", async () => {
    const c = compilation("c-ko", "conv-2");
    await lancerCompilationLocale(c, [{ chemin: "src/Erreur.java", contenu: "class X { Y y; }" }], { gradle, resumer });
    const e = etats.get("c-ko")!;
    expect(e.statut).toBe("echouee");
    expect(String(e.journal)).toMatch(/cannot find symbol/);
  });

  it("Gradle introuvable : statut echouee avec un message clair", async () => {
    const c = compilation("c-absent", "conv-3");
    await lancerCompilationLocale(c, [{ chemin: "a.txt", contenu: "a" }], { gradle: path.join(racine, "inexistant"), resumer: () => "" });
    const e = etats.get("c-absent")!;
    expect(e.statut).toBe("echouee");
    expect(String(e.journal)).toMatch(/Impossible de lancer Gradle/);
  });

  it("les compilations d'un même espace passent l'une après l'autre", async () => {
    const a = compilation("c-a", "conv-file");
    const b = compilation("c-b", "conv-file");
    const pa = lancerCompilationLocale(a, [{ chemin: "src/Erreur.java", contenu: "x" }], { gradle, resumer });
    const pb = lancerCompilationLocale(b, [{ chemin: "ok.txt", contenu: "ok" }], { gradle, resumer });
    await Promise.all([pa, pb]);
    expect(etats.get("c-a")!.statut).toBe("echouee");
    expect(etats.get("c-b")!.statut).toBe("reussie"); // l'espace a bien été resynchronisé (Erreur.java retiré)
    expect(dossierEspace("conv-file")).toContain(path.join("compilations", "espaces"));
  });
});

describe("rafraichirLocale", () => {
  it("marque en erreur une compilation en cours inconnue du processus (redémarrage)", async () => {
    const c = { ...compilation("c-orpheline"), statut: "en_cours" } as Compilation;
    const r = await rafraichirLocale(c);
    expect(r.statut).toBe("erreur");
    expect(String(r.erreur)).toMatch(/redémarrée/);
  });

  it("ne touche pas une compilation terminée", async () => {
    const c = { ...compilation("c-finie"), statut: "reussie" } as Compilation;
    expect(await rafraichirLocale(c)).toBe(c);
  });
});
