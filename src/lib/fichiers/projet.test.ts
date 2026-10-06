import { describe, expect, it } from "vitest";
import { remplacerBlocsFichiers } from "./extraire";
import { appliquerRemplacement, blocProjetPourModele, fichiersModifiesPar, fusionnerProjet, fusionnerProjetDetaille, masquerFichiersConnus, suppressionsDemandees } from "./projet";

const m = (id: string, role: string, text: string) => ({ id, role, parts: [{ type: "text", text }] });

const reponse1 = `Voici le projet.

\`\`\`groovy build.gradle
plugins { id 'fabric-loom' }
\`\`\`

\`\`\`java src/main/java/com/ex/Mod.java
public class Mod { int v = 1; }
\`\`\`
`;
const reponse2 = `Correction :

\`\`\`java src/main/java/com/ex/Mod.java
public class Mod { int v = 2; }
\`\`\`

\`\`\`json fabric.mod.json
{"id":"ex"}
\`\`\`
`;

describe("fusionnerProjet", () => {
  it("garde la dernière version de chaque fichier et l'ordre d'apparition", () => {
    const projet = fusionnerProjet([m("u1", "user", "fais"), m("a1", "assistant", reponse1), m("u2", "user", "corrige"), m("a2", "assistant", reponse2)]);
    expect(projet.map((f) => f.chemin)).toEqual(["build.gradle", "src/main/java/com/ex/Mod.java", "fabric.mod.json"]);
    expect(projet[1].contenu).toContain("v = 2");
    expect(projet[1].messageId).toBe("a2");
    expect(projet[0].messageId).toBe("a1");
    expect(fichiersModifiesPar(projet, "a2").map((f) => f.chemin)).toEqual(["src/main/java/com/ex/Mod.java", "fabric.mod.json"]);
  });
});

describe("fusionnerProjet : suppressions et chemins réservés", () => {
  it("applique « Supprimer : chemin » et ignore .github/ et le wrapper", () => {
    const r3 = "Nettoyage.\n\nSupprimer : `src/main/java/com/ex/Mod.java`\n\n```yaml .github/workflows/build.yml\nname: x\n```\n\n```text gradlew\n#!/bin/sh\n```\n\n```java src/Neuf.java\nclass Neuf {}\n```\n";
    const projet = fusionnerProjet([m("a1", "assistant", reponse1), m("a2", "assistant", reponse2), m("a3", "assistant", r3)]);
    expect(projet.map((f) => f.chemin)).toEqual(["build.gradle", "fabric.mod.json", "src/Neuf.java"]);
  });
  it("un fichier supprimé puis renvoyé revient", () => {
    const projet = fusionnerProjet([m("a1", "assistant", reponse1), m("a2", "assistant", "Supprimer : build.gradle"), m("a3", "assistant", reponse1)]);
    expect(projet.map((f) => f.chemin)).toContain("build.gradle");
  });
});

describe("blocProjetPourModele", () => {
  it("inclut le contenu dans la limite du budget, les plus récents d'abord", () => {
    const projet = fusionnerProjet([m("a1", "assistant", reponse1), m("a2", "assistant", reponse2)]);
    const complet = blocProjetPourModele(projet, 10_000);
    expect(complet).toContain("```groovy build.gradle");
    expect(complet).toContain("v = 2");
    expect(complet).not.toContain("v = 1");
    const serre = blocProjetPourModele(projet, 40);
    expect(serre).toContain("build.gradle (");
    expect(serre).toContain("contenu omis");
  });
});

describe("masquerFichiersConnus", () => {
  it("remplace les blocs des fichiers connus et garde le reste", () => {
    const r = masquerFichiersConnus(reponse1, new Set(["build.gradle"]));
    expect(r).toContain("Voici le projet.");
    expect(r).toContain("⟦note de l'application : fichier build.gradle ; contenu actuel dans l'état du projet ⟧");
    expect(r).not.toContain("fabric-loom");
    expect(r).toContain("int v = 1");
  });
  it("laisse intact un texte sans fichier", () => {
    expect(remplacerBlocsFichiers("Bonjour\n```js\nconsole.log(1)\n```", () => "X")).toBe("Bonjour\n```js\nconsole.log(1)\n```");
  });
});

describe("suppressionsDemandees", () => {
  it("lit les lignes « Supprimer : chemin »", () => {
    expect(suppressionsDemandees("- Supprimer : src/Old.java\nSupprimer: `a/b.txt`")).toEqual(["src/Old.java", "a/b.txt"]);
  });
});

const fichierJava = `\`\`\`java src/main/java/com/ex/Mod.java
public class Mod {
    public void init() {
        int v = 1;
        log("a");
    }
}
\`\`\`
`;
const modif = (chercher: string, remplacer: string, chemin = "src/main/java/com/ex/Mod.java") =>
  `\`\`\`modif ${chemin}\n<<<<<<< CHERCHER\n${chercher}\n=======\n${remplacer}\n>>>>>>> REMPLACER\n\`\`\`\n`;

describe("modifications partielles (blocs modif)", () => {
  it("applique une paire CHERCHER/REMPLACER exacte et marque le fichier comme modifié par ce message", () => {
    const { fichiers, echecs } = fusionnerProjetDetaille([m("a1", "assistant", fichierJava), m("a2", "assistant", modif("        int v = 1;", "        int v = 2;"))]);
    expect(echecs).toEqual([]);
    const f = fichiers.find((x) => x.chemin.endsWith("Mod.java"))!;
    expect(f.contenu).toContain("int v = 2;");
    expect(f.contenu).toContain('log("a");');
    expect(f.messageId).toBe("a2");
    expect(fichiersModifiesPar(fichiers, "a2").map((x) => x.chemin)).toEqual(["src/main/java/com/ex/Mod.java"]);
  });
  it("tolère les espaces de fin de ligne et une indentation différente (remplacement ré-indenté)", () => {
    const { fichiers, echecs } = fusionnerProjetDetaille([m("a1", "assistant", fichierJava), m("a2", "assistant", modif('int v = 1;\nlog("a");', 'int v = 3;\nlog("b");'))]);
    expect(echecs).toEqual([]);
    expect(fichiers[0].contenu).toContain('        int v = 3;\n        log("b");');
  });
  it("signale les échecs : fichier inconnu, texte introuvable, bloc mal formé", () => {
    const malForme = "```modif src/main/java/com/ex/Mod.java\nrien\n```\n";
    const { fichiers, echecs } = fusionnerProjetDetaille([
      m("a1", "assistant", fichierJava),
      m("a2", "assistant", modif("int v = 1;", "int v = 9;", "src/Inconnu.java") + modif("n'existe pas", "x") + malForme),
    ]);
    expect(fichiers[0].contenu).toContain("int v = 1;"); // inchangé
    expect(echecs.map((e) => e.raison)).toEqual([expect.stringMatching(/inconnu/), expect.stringMatching(/introuvable/), expect.stringMatching(/mal formé/)]);
    expect(echecs.every((e) => e.messageId === "a2")).toBe(true);
  });
  it("un bloc modif n'est pas pris pour un fichier entier", () => {
    const projet = fusionnerProjet([m("a1", "assistant", modif("a", "b", "src/Seul.java"))]);
    expect(projet).toEqual([]);
  });
  it("appliquerRemplacement : première occurrence, null si absent", () => {
    expect(appliquerRemplacement("a\nb\na\n", "a", "c")).toBe("c\nb\na\n");
    expect(appliquerRemplacement("a\nb\n", "z", "c")).toBeNull();
    expect(appliquerRemplacement("a\nb\n", "   ", "c")).toBeNull();
  });
});
