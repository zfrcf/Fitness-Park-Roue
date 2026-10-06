/**
 * Contexte Minecraft injecté quand l'utilisateur demande un mod : versions à jour
 * (Fabric meta, Modrinth, Maven Fabric, NeoForge) et modèle de projet Fabric compilable
 * par la chaîne GitHub Actions de l'application.
 */
import type { KV } from "@/lib/kv";
import { modeLocal } from "@/lib/mode";

export interface VersionsMinecraft {
  jeu: string;
  loader: string;
  fabricApi: string;
  loom: string;
  neoforge?: string;
  java: number;
  recupereA: number;
  /** Les versions ont-elles été réellement récupérées (vrai) ou sont-ce des valeurs de repli (faux) ? (#25) */
  verifie: boolean;
}

const TTL = 6 * 3600;
/** Un résultat de repli (réseau en échec) n'est mis en cache que brièvement, pour ne pas le figer 6 h. (#25) */
const TTL_REPLI = 10 * 60;

/** Depuis 26.1 le jeu n'est plus obfusqué : Loom sans remap, aucune ligne mappings. */
export function jeuNonObfusque(jeu: string): boolean {
  const m = /^(\d+)\./.exec(jeu);
  return !m || Number(m[1]) >= 26;
}

/** Version de Java requise selon la version du jeu (voir fabricmc.net/develop). (#26) */
export function javaPour(jeu: string): number {
  if (jeuNonObfusque(jeu)) return 25; // 26.x et au-delà
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(jeu);
  if (!m) return 21;
  const mineur = Number(m[1]);
  const patch = Number(m[2] ?? 0);
  if (mineur >= 21) return 21; // 1.21.x
  if (mineur === 20) return patch >= 5 ? 21 : 17; // 1.20.5+ → 21 ; 1.20 à 1.20.4 → 17
  if (mineur >= 18) return 17; // 1.18, 1.19
  if (mineur === 17) return 16; // 1.17.x
  return 8; // 1.16.5 et antérieurs
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
  const loomTrouve = /<release>([^<]+)<\/release>/.exec(loomXml)?.[1];
  const loom = loomTrouve ?? "1.18-SNAPSHOT";
  // « Vérifié » seulement si les sources critiques ont répondu (Loader, Fabric API, Loom).
  const verifie = !!(loaders?.[0] && api?.[0]?.version_number && loomTrouve);
  const v: VersionsMinecraft = {
    jeu,
    loader: loaders?.[0]?.loader.version ?? "0.19.5",
    // Repli : chaîne vide plutôt que « * » (version Gradle invalide) ; le prompt dira alors de la vérifier. (#25)
    fabricApi: api?.[0]?.version_number ?? "",
    loom,
    neoforge: neo?.version,
    java: javaPour(jeu),
    recupereA: Date.now(),
    verifie,
  };
  // On ne fige pas 6 h un résultat de repli : un échec réseau passager se corrige au prochain appel. (#25)
  await opts.kv?.set(cle, v, verifie ? TTL : TTL_REPLI);
  return v;
}

const RE_MOD = /\b(mod|mods|fabric|neoforge|forge|mixin|loom)\b/i;
const RE_MINECRAFT = /\bminecraft\b|\bfabric\b|\bneoforge\b|\bforge\b/i;
const RE_VERSION = /\b((?:1\.\d{1,2}(?:\.\d{1,2})?)|(?:2[6-9]\.\d{1,2}(?:\.\d{1,2})?))\b/;

export type Loader = "fabric" | "neoforge" | "forge";

/** Loader explicitement demandé dans un texte (neoforge prioritaire sur forge). */
export function detecterLoader(texte: string): Loader | undefined {
  if (/\bneoforge\b/i.test(texte)) return "neoforge";
  if (/\bforge\b/i.test(texte)) return "forge";
  if (/\bfabric\b/i.test(texte)) return "fabric";
  return undefined;
}

/** Faut-il injecter le contexte ? Et quelle version de jeu est demandée ? */
export function detecterDemandeMod(texte: string): { mod: boolean; version?: string; loader?: Loader } {
  const mod = RE_MOD.test(texte) && RE_MINECRAFT.test(texte);
  const version = RE_VERSION.exec(texte)?.[1];
  return { mod, version, loader: detecterLoader(texte) };
}

/** Une conversation en cours parle-t-elle d'un mod ? (utile au tour de clarification où « 26.3 » seul ne contient aucun mot-clé) */
export function conversationConcerneMod(textes: string[]): boolean {
  return textes.some((t) => RE_MOD.test(t) && RE_MINECRAFT.test(t));
}

/** Première version de jeu trouvée dans un texte (null si aucune). */
export function extraireVersion(texte: string): string | undefined {
  return RE_VERSION.exec(texte)?.[1];
}

/**
 * Version du jeu lue DANS LE PROJET (gradle.properties puis fabric.mod.json) : source de vérité
 * dès qu'un build existe. On n'extrait plus la version d'un message, qui peut être un journal
 * d'erreurs Gradle contenant « 1.5 fois », « 1.21 » au hasard, etc.
 */
export function versionDepuisProjet(fichiers: Array<{ chemin: string; contenu: string }>): string | undefined {
  for (const f of fichiers) {
    if (!/(^|\/)gradle\.properties$/.test(f.chemin)) continue;
    const m = f.contenu.match(/^\s*minecraft_version\s*=\s*(.+?)\s*$/m);
    const v = m && extraireVersion(m[1]);
    if (v) return v;
  }
  for (const f of fichiers) {
    if (!/(^|\/)fabric\.mod\.json$/.test(f.chemin)) continue;
    try {
      const j = JSON.parse(f.contenu) as { depends?: { minecraft?: string | string[] } };
      const dep = j?.depends?.minecraft;
      const brut = Array.isArray(dep) ? dep.join(" ") : dep;
      const v = typeof brut === "string" ? extraireVersion(brut) : undefined;
      if (v) return v;
    } catch {
      /* fabric.mod.json invalide : on ignore */
    }
  }
  return undefined;
}

/** Bloc pour une demande NeoForge/Forge : on n'impose PAS le modèle Fabric (règles inadaptées). (#26) */
function blocNeoForge(v: VersionsMinecraft, loader: Loader): string {
  const date = new Date(v.recupereA).toISOString().slice(0, 10);
  const nom = loader === "neoforge" ? "NeoForge" : "Forge";
  return `<contexte_minecraft date="${date}" loader="${loader}">
Demande ${nom} (pas Fabric) : je ne t'impose pas de modèle Fabric. Versions${v.verifie ? " (vérifiées automatiquement)" : " (valeurs de repli, à vérifier : le réseau n'a pas répondu)"} : Minecraft ${v.jeu} · Java ${v.java}${v.neoforge ? ` · NeoForge ${v.neoforge}` : ""}.
${modeLocal() ? "Chaîne de compilation : l'application compile le projet sur l'ordinateur de l'utilisateur avec « gradle build » (JDK 25)." : "Chaîne de compilation : l'utilisateur peut cliquer « Compiler sur GitHub » ; GitHub Actions lance « gradle build » avec JDK 25."} Un projet ${nom} est basé sur Gradle, donc compilable, à condition de fournir un projet Gradle complet (build.gradle, settings.gradle, gradle.properties, sources) à la racine, un seul source set src/main, chaque fichier dans son bloc de code avec son chemin.
- Ne fournis NI gradlew, NI gradle-wrapper, NI fichier sous .github/ (déjà présents), NI icône.
- Vérifie toi-même la version exacte de ${nom} pour Minecraft ${v.jeu} (${nom === "NeoForge" ? "maven.neoforged.net" : "files.minecraftforge.net"}) ; n'invente pas de numéro de version.
- Cible Java ${v.java} (release ${v.java}). Si tu n'es pas sûr d'un nom de classe ou d'une API pour cette version, dis-le plutôt que d'inventer.
</contexte_minecraft>`;
}

export function blocContexteMinecraft(v: VersionsMinecraft, loader: Loader = "fabric"): string {
  if (loader === "neoforge" || loader === "forge") return blocNeoForge(v, loader);
  const date = new Date(v.recupereA).toISOString().slice(0, 10);
  const nonObfusque = jeuNonObfusque(v.jeu);
  // 26.x : jeu non obfusqué → plugin net.fabricmc.fabric-loom, AUCUNE ligne mappings, dépendances implementation.
  // 1.21.x et antérieur : plugin net.fabricmc.fabric-loom-remap + mappings Mojang + modImplementation.
  // Les deux variantes ont été vérifiées par compilation réelle avec la chaîne du dépôt (JDK 25, Gradle 9.7.1,
  // Loom 1.18.2) : 26.3 (run GitHub Actions 37257906221) et 1.21.11 avec release 21 (run 37258299909).
  const plugin = nonObfusque ? "net.fabricmc.fabric-loom" : "net.fabricmc.fabric-loom-remap";
  const regleMappings = nonObfusque
    ? `- Minecraft ${v.jeu} n'est PAS obfusqué : plugin Gradle id '${plugin}', AUCUNE ligne « mappings » dans build.gradle (ni yarn, ni loom.officialMojangMappings() : Loom refuse « Cannot use Mojang mappings in a non-obfuscated environment »), dépendances déclarées avec implementation (pas modImplementation), tâche jar (pas de remapJar). Noms de classes Mojang (ex. net.minecraft.resources.Identifier, net.minecraft.world.item.Item, net.minecraft.server.MinecraftServer).`
    : `- Minecraft ${v.jeu} est obfusqué : plugin Gradle id '${plugin}', ligne « mappings loom.officialMojangMappings() » (JAMAIS yarn, dont tu ne connais pas la version), Loader et Fabric API déclarés avec modImplementation. Noms de classes Mojang (ex. net.minecraft.resources.ResourceLocation, net.minecraft.world.item.Item).`;
  const dependances = nonObfusque
    ? `    implementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    implementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_api_version}"`
    : `    mappings loom.officialMojangMappings()
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_api_version}"`;
  const apiAffichee = v.fabricApi || "à déterminer (voir ci-dessous)";
  const regleApi = v.fabricApi
    ? `- Version de Loom : exactement ${v.loom} (celle ci-dessus) ; n'invente aucun numéro de version de Loom, Loader ou Fabric API.`
    : `- La version de Fabric API N'A PAS pu être vérifiée (réseau indisponible) : ne mets PAS « fabric_api_version=* » (Gradle le refuse). Cherche la dernière version de Fabric API compatible avec Minecraft ${v.jeu} sur modrinth.com/mod/fabric-api et renseigne-la. Version de Loom : exactement ${v.loom} ; n'invente aucun numéro de Loom ni de Loader.`;
  return `<contexte_minecraft date="${date}">
Versions actuelles${v.verifie ? " (vérifiées automatiquement)" : " (valeurs de repli, à vérifier : le réseau n'a pas répondu)"} : Minecraft ${v.jeu} · Fabric Loader ${v.loader} · Fabric API ${apiAffichee} · Loom ${v.loom} · Java ${v.java}${v.neoforge ? ` · NeoForge ${v.neoforge}` : ""}.
Depuis la 26.x, Minecraft n'utilise plus la numérotation 1.21.x ; la dernière version 1.x est la 1.21.11 (Java 21), les suivantes sont 26.1, 26.2, 26.3… (Java 25).

${modeLocal() ? "Chaîne de compilation disponible : le projet est compilé sur l'ordinateur de l'utilisateur avec JDK 25 et Gradle 9.7.1 (commande : gradle build), automatiquement après ta réponse ou par le bouton « Compiler » ; le journal d'erreurs te revient." : "Chaîne de compilation disponible : l'utilisateur peut cliquer « Compiler sur GitHub » sous tes fichiers. Le projet est compilé par GitHub Actions avec JDK 25 et Gradle 9.7.1 (commande : gradle build)."} Règles impératives pour que ça compile :
- Projet Fabric avec Loom, un seul source set (src/main/java et src/main/resources). Reprends le modèle ci-dessous tel quel pour build.gradle, settings.gradle et gradle.properties : il a été vérifié par compilation réelle.
${regleMappings}
${regleApi}
- Mixins : sans refmap, cibles en noms Mojang (ex. @Mixin(MinecraftServer.class) + @Inject(method = "loadLevel", at = @At("HEAD"))), "compatibilityLevel": "JAVA_${v.java}" ; liste chaque mixin dans <modid>.mixins.json. Dans fabric.mod.json, dépends de "fabric-api" (l'ancien id "fabric" n'existe plus).
- Ne fournis NI gradlew, NI gradle-wrapper.jar, NI fichier sous .github/ (le workflow de compilation existe déjà), NI icône : la chaîne les ignore ou les refuse.
- Chaque fichier dans son propre bloc de code avec son chemin complet. Nouveau projet : projet complet (build.gradle, settings.gradle, gradle.properties, fabric.mod.json, <modid>.mixins.json même sans mixin, classe principale, et le reste). Projet existant : uniquement des blocs \`\`\`modif pour les fichiers qui changent, les nouveaux fichiers en entier, jamais un fichier inchangé.
- Le mod id : minuscules, chiffres, tirets bas ; identique dans fabric.mod.json, settings.gradle (rootProject.name) et le nom du fichier mixins.
- Préfère les API Fabric stables (ModInitializer, Registry, ServerTickEvents, CommandRegistrationCallback). Si tu n'es pas sûr d'un nom de classe ou de méthode pour cette version, dis-le plutôt que d'inventer.

Modèle de projet (à adapter : modid, package, nom, version du jeu) :

\`\`\`properties gradle.properties
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true
minecraft_version=${v.jeu}
loader_version=${v.loader}
loom_version=${v.loom}
fabric_api_version=${v.fabricApi || "REMPLACER_PAR_LA_VERSION_FABRIC_API"}
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
    id '${plugin}' version "\${loom_version}"
}
version = project.mod_version
group = project.maven_group
base { archivesName = project.archives_base_name }
repositories {}
dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
${dependances}
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
