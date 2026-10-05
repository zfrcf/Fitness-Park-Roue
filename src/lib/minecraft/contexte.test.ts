import { describe, expect, it } from "vitest";
import { getKV } from "@/lib/kv";
import { blocContexteMinecraft, detecterDemandeMod, jeuNonObfusque, versionsMinecraft, type VersionsMinecraft } from "./contexte";

/** Extrait le contenu d'un bloc de code « ```lang chemin » du contexte. */
function fichier(bloc: string, chemin: string): string {
  const m = new RegExp("```\\w+ " + chemin.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "\\n([\\s\\S]*?)```").exec(bloc);
  if (!m) throw new Error(`bloc ${chemin} absent`);
  return m[1];
}

// Jeux de versions figés : ceux qui ont réellement compilé sur GitHub Actions (JDK 25, Gradle 9.7.1).
const V26: VersionsMinecraft = { jeu: "26.3", loader: "0.19.5", fabricApi: "0.161.0+26.3", loom: "1.18.2", neoforge: "21.11.45", java: 25, recupereA: Date.UTC(2026, 9, 5) };
const V121: VersionsMinecraft = { jeu: "1.21.11", loader: "0.19.5", fabricApi: "0.141.6+1.21.11", loom: "1.18.2", java: 21, recupereA: Date.UTC(2026, 9, 5) };

describe("detecterDemandeMod", () => {
  it("détecte une demande de mod et la version", () => {
    expect(detecterDemandeMod("Fais-moi un mod Minecraft 1.21.11 qui ajoute une épée")).toEqual({ mod: true, version: "1.21.11" });
    expect(detecterDemandeMod("un mod fabric pour la 26.3")).toEqual({ mod: true, version: "26.3" });
    expect(detecterDemandeMod("Explique la version 1.21 de Minecraft")).toEqual({ mod: false, version: "1.21" });
    expect(detecterDemandeMod("Rédige un email")).toEqual({ mod: false, version: undefined });
  });
});

describe("jeuNonObfusque", () => {
  it("sépare les deux générations : 1.x obfusqué, 26.x et au-delà non obfusqué", () => {
    expect(jeuNonObfusque("26.1")).toBe(true);
    expect(jeuNonObfusque("26.3")).toBe(true);
    expect(jeuNonObfusque("27.2")).toBe(true);
    expect(jeuNonObfusque("1.21.11")).toBe(false);
    expect(jeuNonObfusque("1.20.1")).toBe(false);
  });
});

describe("blocContexteMinecraft", () => {
  it("26.x : plugin fabric-loom, AUCUNE ligne mappings, implementation, Java 25", () => {
    const bloc = blocContexteMinecraft(V26);
    expect(bloc).toContain('<contexte_minecraft date="2026-10-05">');
    expect(bloc).toContain("Minecraft 26.3 · Fabric Loader 0.19.5 · Fabric API 0.161.0+26.3 · Loom 1.18.2 · Java 25 · NeoForge 21.11.45");
    expect(bloc).toContain("Minecraft 26.3 n'est PAS obfusqué");
    const gradle = fichier(bloc, "build.gradle");
    expect(gradle).toContain("id 'net.fabricmc.fabric-loom' version \"${loom_version}\"");
    expect(gradle).not.toContain("fabric-loom-remap");
    expect(gradle).not.toMatch(/\bmappings\b/);
    expect(gradle).not.toContain("modImplementation");
    expect(gradle).toContain('implementation "net.fabricmc:fabric-loader:${project.loader_version}"');
    expect(gradle).toContain('implementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_api_version}"');
    expect(gradle).toContain('minecraft "com.mojang:minecraft:${project.minecraft_version}"');
    expect(gradle).toContain("it.options.release = 25");
    expect(gradle).toContain("JavaVersion.VERSION_25");
    expect(fichier(bloc, "src/main/resources/monmod.mixins.json")).toContain('"compatibilityLevel": "JAVA_25"');
    expect(fichier(bloc, "src/main/resources/fabric.mod.json")).toContain('"java": ">=25"');
  });

  it("1.21.x : plugin fabric-loom-remap, mappings Mojang, modImplementation, Java 21", () => {
    const bloc = blocContexteMinecraft(V121);
    expect(bloc).toContain("Minecraft 1.21.11 est obfusqué");
    expect(bloc).not.toContain("NeoForge");
    const gradle = fichier(bloc, "build.gradle");
    expect(gradle).toContain("id 'net.fabricmc.fabric-loom-remap' version \"${loom_version}\"");
    expect(gradle).toContain("mappings loom.officialMojangMappings()");
    expect(gradle).not.toMatch(/yarn/i);
    expect(gradle).toContain('modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"');
    expect(gradle).toContain('modImplementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_api_version}"');
    expect(gradle).not.toMatch(/\n\s*implementation /);
    expect(gradle).toContain("it.options.release = 21");
    expect(gradle).toContain("JavaVersion.VERSION_21");
    expect(fichier(bloc, "src/main/resources/monmod.mixins.json")).toContain('"compatibilityLevel": "JAVA_21"');
    expect(fichier(bloc, "src/main/resources/fabric.mod.json")).toContain('"java": ">=21"');
  });

  it("interpole les versions dans gradle.properties et fabric.mod.json", () => {
    for (const v of [V26, V121]) {
      const bloc = blocContexteMinecraft(v);
      const props = fichier(bloc, "gradle.properties");
      expect(props).toContain(`minecraft_version=${v.jeu}`);
      expect(props).toContain(`loader_version=${v.loader}`);
      expect(props).toContain(`loom_version=${v.loom}`);
      expect(props).toContain(`fabric_api_version=${v.fabricApi}`);
      const modJson = JSON.parse(fichier(bloc, "src/main/resources/fabric.mod.json").replace("${version}", "1.0.0")) as { depends: Record<string, string>; mixins: string[]; id: string };
      expect(modJson.depends).toEqual({ fabricloader: `>=${v.loader}`, minecraft: `~${v.jeu}`, java: `>=${v.java}`, "fabric-api": "*" });
      expect(modJson.mixins).toEqual([`${modJson.id}.mixins.json`]);
      expect(bloc).toContain(`Version de Loom : exactement ${v.loom}`);
      // Aucun ancien id de dépendance ni de refmap.
      expect(bloc).not.toContain('"fabric":');
      expect(fichier(bloc, "src/main/resources/monmod.mixins.json")).not.toContain("refmap");
    }
  });

  it("énonce les consignes clés pour la chaîne GitHub Actions", () => {
    const bloc = blocContexteMinecraft(V26);
    expect(bloc).toContain("JDK 25 et Gradle 9.7.1");
    expect(bloc).toContain("Reprends le modèle ci-dessous tel quel pour build.gradle, settings.gradle et gradle.properties");
    expect(bloc).toContain("un seul source set");
    expect(bloc).toContain("Ne fournis NI gradlew, NI gradle-wrapper.jar, NI fichier sous .github/");
    expect(bloc).toContain("Mixins : sans refmap, cibles en noms Mojang");
    expect(bloc).toContain('dépends de "fabric-api"');
    expect(bloc).toContain("n'invente aucun numéro de version de Loom, Loader ou Fabric API");
    const settings = fichier(bloc, "settings.gradle");
    expect(settings).toContain("https://maven.fabricmc.net/");
    expect(settings).toContain("rootProject.name = 'monmod'");
  });
});

describe("versionsMinecraft", () => {
  const faux = ((entree: RequestInfo | URL) => {
    const url = String(entree);
    const rep = (o: unknown) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status: 200 });
    if (url.includes("/versions/game")) return rep([{ version: "26.4-snapshot-1", stable: false }, { version: "26.3", stable: true }]);
    if (url.includes("/versions/loader/")) return rep([{ loader: { version: "0.19.5", stable: true } }]);
    if (url.includes("modrinth")) return rep([{ version_number: url.includes("1.21.11") ? "0.141.6+1.21.11" : "0.161.0+26.3" }]);
    if (url.includes("maven-metadata")) return rep("<metadata><versioning><latest>1.18-SNAPSHOT</latest><release>1.18.2</release></versioning></metadata>");
    if (url.includes("neoforged")) return rep({ version: "21.11.45" });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  it("agrège les sources et met en cache", async () => {
    const v = await versionsMinecraft(undefined, { fetch: faux, kv: getKV() });
    expect(v).toMatchObject({ jeu: "26.3", loader: "0.19.5", fabricApi: "0.161.0+26.3", loom: "1.18.2", neoforge: "21.11.45", java: 25 });
    const v2 = await versionsMinecraft(undefined, { fetch: (() => Promise.reject(new Error("réseau"))) as unknown as typeof fetch, kv: getKV() });
    expect(v2.jeu).toBe("26.3"); // cache
  });

  it("interroge Modrinth pour la version demandée et choisit Java 21 en 1.21.x", async () => {
    const v = await versionsMinecraft("1.21.11", { fetch: faux });
    expect(v).toMatchObject({ jeu: "1.21.11", loader: "0.19.5", fabricApi: "0.141.6+1.21.11", loom: "1.18.2", java: 21 });
    // La version de Loom vient de <release>, jamais de <latest> (1.18-SNAPSHOT).
    expect(v.loom).not.toContain("SNAPSHOT");
  });

  it("replie sur des valeurs sûres si tout échoue", async () => {
    const v = await versionsMinecraft("1.21.4", { fetch: (() => Promise.reject(new Error("réseau"))) as unknown as typeof fetch });
    expect(v).toMatchObject({ jeu: "1.21.4", loader: "0.19.5", fabricApi: "*", java: 21 });
    expect(blocContexteMinecraft(v)).toContain("mappings loom.officialMojangMappings()");
  });
});
