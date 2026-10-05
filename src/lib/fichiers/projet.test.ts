import { describe, expect, it } from "vitest";
import { remplacerBlocsFichiers } from "./extraire";
import { blocProjetPourModele, fichiersModifiesPar, fusionnerProjet, masquerFichiersConnus, suppressionsDemandees } from "./projet";

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
    expect(r).toContain("[fichier `build.gradle` : voir l'état du projet]");
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
