import { describe, expect, it } from "vitest";
import { cheminDepuisInfo, estProjetGradle, extraireFichiers, nomArchive } from "./extraire";

describe("cheminDepuisInfo", () => {
  it("reconnaît les formes courantes", () => {
    expect(cheminDepuisInfo("java src/main/java/com/ex/Mod.java")).toEqual({ langue: "java", chemin: "src/main/java/com/ex/Mod.java" });
    expect(cheminDepuisInfo('json title="pack.mcmeta"')).toEqual({ langue: "json", chemin: "pack.mcmeta" });
    expect(cheminDepuisInfo("yaml:config/app.yml")).toEqual({ langue: "yaml", chemin: "config/app.yml" });
    expect(cheminDepuisInfo("src/x.kt")).toEqual({ chemin: "src/x.kt" });
    expect(cheminDepuisInfo("python")).toEqual({ langue: "python" });
    expect(cheminDepuisInfo("")).toEqual({});
  });
});

describe("extraireFichiers", () => {
  it("extrait les blocs nommés, ignore les autres, dédoublonne", () => {
    const md = [
      "Voici le projet :",
      "",
      "```json title=\"fabric.mod.json\"",
      '{ "id": "monmod", "version": "1.0.0" }',
      "```",
      "",
      "**src/main/java/com/ex/MonMod.java**",
      "```java",
      "public class MonMod {}",
      "```",
      "",
      "### `build.gradle`",
      "",
      "```groovy",
      "plugins { id 'fabric-loom' }",
      "```",
      "",
      "Un exemple sans nom :",
      "```bash",
      "./gradlew build",
      "```",
      "",
      "```",
      "// src/main/resources/monmod.mixins.json",
      '{ "mixins": [] }',
      "```",
      "",
      "```json title=\"fabric.mod.json\"",
      '{ "id": "monmod", "version": "2.0.0" }',
      "```",
    ].join("\n");
    const f = extraireFichiers(md);
    expect(f.map((x) => x.chemin)).toEqual(["fabric.mod.json", "src/main/java/com/ex/MonMod.java", "build.gradle", "src/main/resources/monmod.mixins.json"]);
    expect(f[0].contenu).toContain('"2.0.0"'); // le dernier bloc du même chemin l'emporte
    expect(f[3].contenu.trim()).toBe('{ "mixins": [] }');
    expect(estProjetGradle(f)).toBe(true);
    expect(nomArchive(f)).toBe("monmod");
  });
  it("refuse les chemins dangereux", () => {
    const md = "```txt ../../etc/passwd\nx\n```\n\n```txt /abs/olu.txt\ny\n```";
    expect(extraireFichiers(md)).toEqual([]);
  });
  it("renvoie vide sans fichier", () => {
    expect(extraireFichiers("Bonjour, voici `du code` inline.")).toEqual([]);
    expect(estProjetGradle([])).toBe(false);
    expect(nomArchive([], "x")).toBe("x");
  });
});
