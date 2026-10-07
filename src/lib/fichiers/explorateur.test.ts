import { describe, expect, it } from "vitest";
import { comparerLignes, construireArbre, decouperHtmlParLigne, dossiersParents, langageDuFichier, lignesModifiees, statsModifications, type Noeud } from "./explorateur";
import { blocOuvert } from "./extraire";

const noms = (n: Noeud[]): string[] => n.map((x) => (x.type === "dossier" ? `${x.nom}/` : x.nom));

describe("construireArbre", () => {
  it("dossiers d'abord, ordre alphabétique, dossiers à enfant unique compactés comme VS Code", () => {
    const arbre = construireArbre([
      "build.gradle",
      "src/main/java/com/exemple/Mod.java",
      "src/main/java/com/exemple/mixin/A.java",
      "src/main/resources/fabric.mod.json",
      "gradle.properties",
      "settings.gradle",
    ]);
    expect(noms(arbre)).toEqual(["src/main/", "build.gradle", "gradle.properties", "settings.gradle"]);
    const main = arbre[0] as Extract<Noeud, { type: "dossier" }>;
    expect(main.chemin).toBe("src/main");
    expect(noms(main.enfants)).toEqual(["java/com/exemple/", "resources/"]);
    const pkg = main.enfants[0] as Extract<Noeud, { type: "dossier" }>;
    expect(pkg.chemin).toBe("src/main/java/com/exemple");
    expect(noms(pkg.enfants)).toEqual(["mixin/", "Mod.java"]);
  });

  it("tri naturel des nombres", () => {
    expect(noms(construireArbre(["f10.txt", "f2.txt", "f1.txt"]))).toEqual(["f1.txt", "f2.txt", "f10.txt"]);
  });

  it("dossiers parents d'un fichier", () => {
    expect(dossiersParents("a/b/c.txt")).toEqual(["a", "a/b"]);
  });
});

describe("lignesModifiees", () => {
  it("nouveau fichier : toutes les lignes", () => {
    expect([...lignesModifiees(undefined, "a\nb")]).toEqual([1, 2]);
  });
  it("ne marque que les lignes ajoutées ou changées", () => {
    const ancien = "package x;\nclass A {\n  int a = 1;\n}\n";
    const nouveau = "package x;\nimport y;\nclass A {\n  int a = 2;\n}\n";
    expect([...lignesModifiees(ancien, nouveau)].sort()).toEqual([2, 4]);
  });
  it("identique : rien", () => {
    expect(lignesModifiees("a\nb\n", "a\nb\n").size).toBe(0);
  });
});

describe("decouperHtmlParLigne", () => {
  it("referme et rouvre les spans qui traversent un saut de ligne", () => {
    const html = 'int a;\n<span class="hljs-comment">/* un\ndeux */</span>\nfin';
    expect(decouperHtmlParLigne(html)).toEqual(['int a;', '<span class="hljs-comment">/* un</span>', '<span class="hljs-comment">deux */</span>', "fin"]);
  });
});

describe("langageDuFichier", () => {
  it("reconnaît les fichiers d'un mod", () => {
    expect(langageDuFichier("build.gradle")).toBe("groovy");
    expect(langageDuFichier("src/A.java")).toBe("java");
    expect(langageDuFichier("fabric.mod.json")).toBe("json");
    expect(langageDuFichier("gradle.properties")).toBe("properties");
    expect(langageDuFichier("LICENSE")).toBeUndefined();
  });
});

describe("blocOuvert (fichier en cours d'écriture)", () => {
  it("repère le bloc encore ouvert à la fin du flux", () => {
    expect(blocOuvert("Voici :\n```java src/A.java\nclass A {")).toEqual({ chemin: "src/A.java", modification: false });
    expect(blocOuvert("```modif src/A.java\n<<<<<<< CHERCHER\nx")).toEqual({ chemin: "src/A.java", modification: true });
    expect(blocOuvert("**build.gradle**\n```groovy\nplugins {")).toEqual({ chemin: "build.gradle", modification: false });
  });
  it("aucun bloc ouvert", () => {
    expect(blocOuvert("```java src/A.java\nclass A {}\n```\nFini.")).toBeNull();
    expect(blocOuvert("du texte")).toBeNull();
  });
});

describe("comparerLignes et statsModifications (+N −M)", () => {
  it("compte ajouts et suppressions comme git diff --stat", () => {
    const ancien = "a\nb\nc\nd\n";
    const nouveau = "a\nB\nc\nd\ne\n";
    const c = comparerLignes(ancien, nouveau);
    expect([c.ajouts, c.suppressions]).toEqual([2, 1]); // b → B (+1 −1), e ajouté (+1)
    expect([...c.modifiees].sort()).toEqual([2, 5]);
  });
  it("nouveau fichier : tout en ajout, sans ligne vide finale comptée", () => {
    expect(comparerLignes(undefined, "x\ny\n")).toMatchObject({ ajouts: 2, suppressions: 0 });
  });
  it("totaux par réponse : nouveaux, modifiés, supprimés ; inchangés ignorés", () => {
    const avant = new Map([["A.java", "1\n2\n3\n"], ["B.java", "x\n"], ["C.java", "c\nc\n"]]);
    const apres = new Map([["A.java", "1\n2bis\n3\n4\n"], ["B.java", "x\n"], ["D.java", "d\n"]]);
    const s = statsModifications(avant, apres);
    expect(s.fichiers.map((f) => `${f.chemin}:${f.statut}:+${f.ajouts}-${f.suppressions}`)).toEqual(["A.java:modifie:+2-1", "C.java:supprime:+0-2", "D.java:nouveau:+1-0"]);
    expect([s.ajouts, s.suppressions]).toEqual([3, 3]);
  });
});
