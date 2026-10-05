/**
 * Contexte Minecraft injecté quand l'utilisateur demande un mod : versions à jour
 * (Fabric meta, Modrinth, Maven Fabric, NeoForge) et modèle de projet Fabric compilable
 * par la chaîne GitHub Actions de l'application.
 */
import type { KV } from "@/lib/kv";

export interface VersionsMinecraft {
  jeu: string;
  loader: string;
  fabricApi: string;
  loom: string;
  neoforge?: string;
  java: number;
  recupereA: number;
}

const TTL = 6 * 3600;

function javaPour(jeu: string): number {
  // 1.20.5 → 1.21.x : Java 21 ; à partir de 26.x : Java 25 (voir fabricmc.net/develop).
  const m = /^(\d+)\.(\d+)/.exec(jeu);
  if (!m) return 25;
  const majeur = Number(m[1]);
  if (majeur >= 26) return 25;
  return 21;
}

async function json<T>(url: string, f: typeof fetch): Promise<T | null> {
  try {
    const r = await f(url, { headers: { "user-agent": "chat-ia (assistant personnel)" }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function versionsMinecraft(jeuDemande: string | undefined, opts: { kv?: KV; fetch?: typeof fetch } = {}): Promise<VersionsMinecraft> {
  const f = opts.fetch ?? fetch;
  const cle = `minecraft:versions:${jeuDemande ?? "stable"}`;
  const cache = await opts.kv?.get<VersionsMinecraft>(cle);
  if (cache) return cache;

  let jeu = jeuDemande;
  if (!jeu) {
    const jeux = await json<Array<{ version: string; stable: boolean }>>("https://meta.fabricmc.net/v2/versions/game", f);
    jeu = jeux?.find((v) => v.stable)?.version ?? "26.3";
  }
  const [loaders, api, loomXml, neo] = await Promise.all([
    json<Array<{ loader: { version: string; stable: boolean } }>>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(jeu)}?limit=1`, f),
    json<Array<{ version_number: string }>>(`https://api.modrinth.com/v2/project/fabric-api/version?game_versions=${encodeURIComponent(`["${jeu}"]`)}&loaders=${encodeURIComponent('["fabric"]')}`, f),
    (async () => {
      try {
        const r = await f("https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml", { signal: AbortSignal.timeout(10_000) });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    })(),
    json<{ version: string }>(`https://maven.neoforged.net/api/maven/latest/version/releases/net/neoforged/neoforge`, f),
  ]);
  const loom = /<release>([^<]+)<\/release>/.exec(loomXml)?.[1] ?? "1.18-SNAPSHOT";
  const v: VersionsMinecraft = {
    jeu,
    loader: loaders?.[0]?.loader.version ?? "0.19.5",
    fabricApi: api?.[0]?.version_number ?? `*`,
    loom,
    neoforge: neo?.version,
    java: javaPour(jeu),
    recupereA: Date.now(),
  };
  await opts.kv?.set(cle, v, TTL);
  return v;
}

const RE_MOD = /\b(mod|mods|fabric|neoforge|forge|mixin|loom)\b/i;
const RE_MINECRAFT = /\bminecraft\b|\bfabric\b|\bneoforge\b|\bforge\b/i;
const RE_VERSION = /\b((?:1\.\d{1,2}(?:\.\d{1,2})?)|(?:2[6-9]\.\d{1,2}(?:\.\d{1,2})?))\b/;

/** Faut-il injecter le contexte ? Et quelle version de jeu est demandée ? */
export function detecterDemandeMod(texte: string): { mod: boolean; version?: string } {
  const mod = RE_MOD.test(texte) && RE_MINECRAFT.test(texte);
  const version = RE_VERSION.exec(texte)?.[1];
  return { mod, version };
}

export function blocContexteMinecraft(v: VersionsMinecraft): string {
  const date = new Date(v.recupereA).toISOString().slice(0, 10);
  return `<contexte_minecraft date="${date}">
Versions actuelles (vérifiées automatiquement) : Minecraft ${v.jeu} · Fabric Loader ${v.loader} · Fabric API ${v.fabricApi} · Loom ${v.loom} · Java ${v.java}${v.neoforge ? ` · NeoForge ${v.neoforge}` : ""}.
Depuis la 26.x, Minecraft n'utilise plus la numérotation 1.21.x ; la dernière version 1.x est la 1.21.11 (Java 21), les suivantes sont 26.1, 26.2, 26.3… (Java 25).

Chaîne de compilation disponible : l'utilisateur peut cliquer « Compiler sur GitHub » sous tes fichiers. Le projet est compilé par GitHub Actions avec JDK 25 et Gradle 9.7.1 (commande : gradle build). Règles impératives pour que ça compile :
- Projet Fabric avec Loom, un seul source set (src/main/java et src/main/resources), mappings officielles Mojang via loom.officialMojangMappings() (JAMAIS yarn, dont tu ne connais pas la version ; noms de classes Mojang, ex. net.minecraft.resources.Identifier, net.minecraft.world.item.Item).
- Version de Loom : exactement ${v.loom} (celle ci-dessus) ; n'invente aucun numéro de version de Loom, Loader ou Fabric API.
- Ne fournis NI gradlew, NI gradle-wrapper.jar, NI icône : la chaîne les ignore ou les refuse.
- Chaque fichier dans son propre bloc de code avec son chemin complet. Projet complet : build.gradle, settings.gradle, gradle.properties, fabric.mod.json, <modid>.mixins.json (même sans mixin), classe principale, et le reste.
- Le mod id : minuscules, chiffres, tirets bas ; identique dans fabric.mod.json, settings.gradle (rootProject.name) et le nom du fichier mixins.
- Préfère les API Fabric stables (ModInitializer, Registry, ServerTickEvents, CommandRegistrationCallback). Si tu n'es pas sûr d'un nom de classe ou de méthode pour cette version, dis-le plutôt que d'inventer.

Modèle de projet (à adapter : modid, package, nom, version du jeu) :

\`\`\`properties gradle.properties
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true
minecraft_version=${v.jeu}
loader_version=${v.loader}
loom_version=${v.loom}
fabric_api_version=${v.fabricApi}
mod_version=1.0.0
maven_group=com.exemple
archives_base_name=monmod
\`\`\`

\`\`\`groovy settings.gradle
pluginManagement {
    repositories {
        maven { name = 'Fabric'; url = 'https://maven.fabricmc.net/' }
        mavenCentral()
        gradlePluginPortal()
    }
}
rootProject.name = 'monmod'
\`\`\`

\`\`\`groovy build.gradle
plugins {
    id 'net.fabricmc.fabric-loom' version "\${loom_version}"
}
version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }
repositories {}
dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    implementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    implementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_api_version}"
}
processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") { expand "version": project.version }
}
tasks.withType(JavaCompile).configureEach { it.options.release = ${v.java} }
java {
    sourceCompatibility = JavaVersion.VERSION_${v.java}
    targetCompatibility = JavaVersion.VERSION_${v.java}
}
\`\`\`

\`\`\`json src/main/resources/fabric.mod.json
{
  "schemaVersion": 1,
  "id": "monmod",
  "version": "\${version}",
  "name": "Mon Mod",
  "description": "Description du mod.",
  "authors": ["Auteur"],
  "license": "MIT",
  "environment": "*",
  "entrypoints": { "main": ["com.exemple.monmod.MonMod"] },
  "mixins": ["monmod.mixins.json"],
  "depends": { "fabricloader": ">=${v.loader}", "minecraft": "~${v.jeu}", "java": ">=${v.java}", "fabric-api": "*" }
}
\`\`\`

\`\`\`json src/main/resources/monmod.mixins.json
{
  "required": true,
  "package": "com.exemple.monmod.mixin",
  "compatibilityLevel": "JAVA_${v.java}",
  "mixins": [],
  "injectors": { "defaultRequire": 1 }
}
\`\`\`

\`\`\`java src/main/java/com/exemple/monmod/MonMod.java
package com.exemple.monmod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MonMod implements ModInitializer {
    public static final String MOD_ID = "monmod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("Mon Mod chargé !");
    }
}
\`\`\`
</contexte_minecraft>`;
}
