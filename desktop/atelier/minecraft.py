"""Contexte Minecraft injecté quand la conversation parle d'un mod : versions à jour (Fabric meta,
Modrinth, Maven Fabric, NeoForge) et modèle de projet Fabric vérifié par compilation réelle
(JDK 25, Gradle 9.7.1, Loom 1.18.x) pour 26.x (non obfusqué) et 1.21.x (obfusqué).
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from .config import GRADLE_VERSION, JDK_VERSION, dossier_donnees

TTL = 6 * 3600
TTL_REPLI = 10 * 60

_RE_MOD = re.compile(r"\b(mod|mods|fabric|neoforge|forge|mixin|loom)\b", re.I)
_RE_MINECRAFT = re.compile(r"\bminecraft\b|\bfabric\b|\bneoforge\b|\bforge\b", re.I)
_RE_VERSION = re.compile(r"\b((?:1\.\d{1,2}(?:\.\d{1,2})?)|(?:2[6-9]\.\d{1,2}(?:\.\d{1,2})?))\b")


@dataclass
class Versions:
    jeu: str
    loader: str
    fabric_api: str
    loom: str
    neoforge: str | None
    java: int
    recupere_a: float
    verifie: bool


def jeu_non_obfusque(jeu: str) -> bool:
    m = re.match(r"^(\d+)\.", jeu)
    return not m or int(m.group(1)) >= 26


def java_pour(jeu: str) -> int:
    if jeu_non_obfusque(jeu):
        return 25
    m = re.match(r"^1\.(\d+)(?:\.(\d+))?", jeu)
    if not m:
        return 21
    mineur, patch = int(m.group(1)), int(m.group(2) or 0)
    if mineur >= 21:
        return 21
    if mineur == 20:
        return 21 if patch >= 5 else 17
    if mineur >= 18:
        return 17
    if mineur == 17:
        return 16
    return 8


def concerne_mod(textes: list[str]) -> bool:
    return any(_RE_MOD.search(t) and _RE_MINECRAFT.search(t) for t in textes)


def extraire_version(texte: str) -> str | None:
    m = _RE_VERSION.search(texte)
    return m.group(1) if m else None


def detecter_loader(textes: list[str]) -> str:
    for t in reversed(textes):
        if re.search(r"\bneoforge\b", t, re.I):
            return "neoforge"
        if re.search(r"\bforge\b", t, re.I):
            return "forge"
        if re.search(r"\bfabric\b", t, re.I):
            return "fabric"
    return "fabric"


def version_depuis_projet(lire) -> str | None:
    """Version du jeu lue dans gradle.properties puis fabric.mod.json (`lire(chemin) -> str | None`)."""
    props = lire("gradle.properties")
    if props:
        m = re.search(r"^\s*minecraft_version\s*=\s*(.+?)\s*$", props, re.M)
        if m and extraire_version(m.group(1)):
            return extraire_version(m.group(1))
    fmj = lire("src/main/resources/fabric.mod.json")
    if fmj:
        try:
            dep = json.loads(fmj).get("depends", {}).get("minecraft")
            brut = " ".join(dep) if isinstance(dep, list) else dep
            if isinstance(brut, str):
                return extraire_version(brut)
        except (ValueError, AttributeError):
            return None
    return None


def _json(client: httpx.Client, url: str):
    try:
        r = client.get(url, headers={"user-agent": "atelier-ia-local"})
        return r.json() if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def versions(jeu_demande: str | None = None, client: httpx.Client | None = None, cache: Path | None = None) -> Versions:
    cache_dir = cache or (dossier_donnees() / "cache")
    fichier = cache_dir / f"minecraft-{jeu_demande or 'stable'}.json"
    try:
        data = json.loads(fichier.read_text(encoding="utf-8"))
        ttl = TTL if data.get("verifie") else TTL_REPLI
        if time.time() - data["recupere_a"] < ttl:
            return Versions(**data)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    proprietaire = client is None
    client = client or httpx.Client(timeout=10.0, follow_redirects=True)
    try:
        jeu = jeu_demande
        if not jeu:
            jeux = _json(client, "https://meta.fabricmc.net/v2/versions/game") or []
            jeu = next((v["version"] for v in jeux if v.get("stable")), "26.3")
        loaders = _json(client, f"https://meta.fabricmc.net/v2/versions/loader/{urllib.parse.quote(jeu)}?limit=1")
        api = _json(
            client,
            "https://api.modrinth.com/v2/project/fabric-api/version?"
            + urllib.parse.urlencode({"game_versions": f'["{jeu}"]', "loaders": '["fabric"]'}),
        )
        try:
            r = client.get("https://maven.fabricmc.net/net/fabricmc/fabric-loom/maven-metadata.xml")
            loom_xml = r.text if r.status_code == 200 else ""
        except httpx.HTTPError:
            loom_xml = ""
        neo = _json(client, "https://maven.neoforged.net/api/maven/latest/version/releases/net/neoforged/neoforge")
    finally:
        if proprietaire:
            client.close()
    m = re.search(r"<release>([^<]+)</release>", loom_xml)
    loader = loaders[0]["loader"]["version"] if loaders else None
    fabric_api = api[0]["version_number"] if api else None
    v = Versions(
        jeu=jeu,
        loader=loader or "0.19.5",
        fabric_api=fabric_api or "",
        loom=m.group(1) if m else "1.18-SNAPSHOT",
        neoforge=neo.get("version") if isinstance(neo, dict) else None,
        java=java_pour(jeu),
        recupere_a=time.time(),
        verifie=bool(loader and fabric_api and m),
    )
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        fichier.write_text(json.dumps(asdict(v)), encoding="utf-8")
    except OSError:
        pass
    return v


_CHAINE = f"L'atelier compile en LOCAL, dans le dossier du projet, avec la commande « gradle build » (JDK {JDK_VERSION}, Gradle {GRADLE_VERSION}) ; le journal d'erreurs te revient automatiquement."


def bloc_contexte(v: Versions, loader: str = "fabric") -> str:
    date = time.strftime("%Y-%m-%d", time.localtime(v.recupere_a))
    etat = " (vérifiées automatiquement)" if v.verifie else " (valeurs de repli, à vérifier : le réseau n'a pas répondu)"
    if loader in ("neoforge", "forge"):
        nom = "NeoForge" if loader == "neoforge" else "Forge"
        site = "maven.neoforged.net" if loader == "neoforge" else "files.minecraftforge.net"
        return f"""<contexte_minecraft date="{date}" loader="{loader}">
Demande {nom} (pas Fabric) : je ne t'impose pas de modèle Fabric. Versions{etat} : Minecraft {v.jeu} · Java {v.java}{f' · NeoForge {v.neoforge}' if v.neoforge else ''}.
{_CHAINE} Fournis un projet Gradle complet (build.gradle, settings.gradle, gradle.properties, sources) à la racine, un seul source set src/main, chaque fichier dans son bloc de code avec son chemin.
- Ne fournis NI gradlew NI gradle-wrapper (Gradle est déjà installé).
- Vérifie la version exacte de {nom} pour Minecraft {v.jeu} ({site}) ; n'invente pas de numéro de version.
- Cible Java {v.java} (release {v.java}). Si tu n'es pas sûr d'une API pour cette version, dis-le plutôt que d'inventer.
</contexte_minecraft>"""
    non_obf = jeu_non_obfusque(v.jeu)
    plugin = "net.fabricmc.fabric-loom" if non_obf else "net.fabricmc.fabric-loom-remap"
    regle_mappings = (
        f"- Minecraft {v.jeu} n'est PAS obfusqué : plugin Gradle id '{plugin}', AUCUNE ligne « mappings » dans build.gradle (ni yarn, ni loom.officialMojangMappings() : Loom refuse « Cannot use Mojang mappings in a non-obfuscated environment »), dépendances déclarées avec implementation (pas modImplementation), tâche jar (pas de remapJar). Noms de classes Mojang (ex. net.minecraft.resources.Identifier, net.minecraft.world.item.Item, net.minecraft.server.MinecraftServer)."
        if non_obf
        else f"- Minecraft {v.jeu} est obfusqué : plugin Gradle id '{plugin}', ligne « mappings loom.officialMojangMappings() » (JAMAIS yarn, dont tu ne connais pas la version), Loader et Fabric API déclarés avec modImplementation. Noms de classes Mojang (ex. net.minecraft.resources.ResourceLocation, net.minecraft.world.item.Item)."
    )
    dependances = (
        '    implementation "net.fabricmc:fabric-loader:${project.loader_version}"\n    implementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_api_version}"'
        if non_obf
        else '    mappings loom.officialMojangMappings()\n    modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"\n    modImplementation "net.fabricmc.fabric-api:fabric-api:${project.fabric_api_version}"'
    )
    regle_api = (
        f"- Version de Loom : exactement {v.loom} (celle ci-dessus) ; n'invente aucun numéro de version de Loom, Loader ou Fabric API."
        if v.fabric_api
        else f"- La version de Fabric API N'A PAS pu être vérifiée (réseau indisponible) : ne mets PAS « fabric_api_version=* » (Gradle le refuse). Cherche la dernière version de Fabric API compatible avec Minecraft {v.jeu} sur modrinth.com/mod/fabric-api et renseigne-la. Version de Loom : exactement {v.loom}."
    )
    api = v.fabric_api or "REMPLACER_PAR_LA_VERSION_FABRIC_API"
    j = v.java
    return f"""<contexte_minecraft date="{date}">
Versions actuelles{etat} : Minecraft {v.jeu} · Fabric Loader {v.loader} · Fabric API {v.fabric_api or 'à déterminer (voir ci-dessous)'} · Loom {v.loom} · Java {j}{f' · NeoForge {v.neoforge}' if v.neoforge else ''}.
Depuis la 26.x, Minecraft n'utilise plus la numérotation 1.21.x ; la dernière version 1.x est la 1.21.11 (Java 21), les suivantes sont 26.1, 26.2, 26.3… (Java 25).

{_CHAINE} Règles impératives pour que ça compile :
- Projet Fabric avec Loom, un seul source set (src/main/java et src/main/resources). Reprends le modèle ci-dessous tel quel pour build.gradle, settings.gradle et gradle.properties : il a été vérifié par compilation réelle.
{regle_mappings}
{regle_api}
- Mixins : sans refmap, cibles en noms Mojang (ex. @Mixin(MinecraftServer.class) + @Inject(method = "loadLevel", at = @At("HEAD"))), "compatibilityLevel": "JAVA_{j}" ; liste chaque mixin dans <modid>.mixins.json. Dans fabric.mod.json, dépends de "fabric-api" (l'ancien id "fabric" n'existe plus).
- Ne fournis NI gradlew NI gradle-wrapper.jar (Gradle est déjà installé), NI icône.
- Chaque fichier dans son propre bloc de code avec son chemin complet. Projet complet : build.gradle, settings.gradle, gradle.properties, fabric.mod.json, <modid>.mixins.json (même sans mixin), classe principale, et le reste.
- Le mod id : minuscules, chiffres, tirets bas ; identique dans fabric.mod.json, settings.gradle (rootProject.name) et le nom du fichier mixins.
- Préfère les API Fabric stables (ModInitializer, Registry, ServerTickEvents, CommandRegistrationCallback). Si tu n'es pas sûr d'un nom de classe ou de méthode pour cette version, dis-le plutôt que d'inventer.

Modèle de projet (à adapter : modid, package, nom, version du jeu) :

```properties gradle.properties
org.gradle.jvmargs=-Xmx1G
org.gradle.parallel=true
minecraft_version={v.jeu}
loader_version={v.loader}
loom_version={v.loom}
fabric_api_version={api}
mod_version=1.0.0
maven_group=com.exemple
archives_base_name=monmod
```

```groovy settings.gradle
pluginManagement {{
    repositories {{
        maven {{ name = 'Fabric'; url = 'https://maven.fabricmc.net/' }}
        mavenCentral()
        gradlePluginPortal()
    }}
}}
rootProject.name = 'monmod'
```

```groovy build.gradle
plugins {{
    id '{plugin}' version "${{loom_version}}"
}}
version = project.mod_version
group = project.maven_group
base {{ archivesName = project.archives_base_name }}
repositories {{}}
dependencies {{
    minecraft "com.mojang:minecraft:${{project.minecraft_version}}"
{dependances}
}}
processResources {{
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {{ expand "version": project.version }}
}}
tasks.withType(JavaCompile).configureEach {{ it.options.release = {j} }}
java {{
    sourceCompatibility = JavaVersion.VERSION_{j}
    targetCompatibility = JavaVersion.VERSION_{j}
}}
```

```json src/main/resources/fabric.mod.json
{{
  "schemaVersion": 1,
  "id": "monmod",
  "version": "${{version}}",
  "name": "Mon Mod",
  "description": "Description du mod.",
  "authors": ["Auteur"],
  "license": "MIT",
  "environment": "*",
  "entrypoints": {{ "main": ["com.exemple.monmod.MonMod"] }},
  "mixins": ["monmod.mixins.json"],
  "depends": {{ "fabricloader": ">={v.loader}", "minecraft": "~{v.jeu}", "java": ">={j}", "fabric-api": "*" }}
}}
```

```json src/main/resources/monmod.mixins.json
{{
  "required": true,
  "package": "com.exemple.monmod.mixin",
  "compatibilityLevel": "JAVA_{j}",
  "mixins": [],
  "injectors": {{ "defaultRequire": 1 }}
}}
```

```java src/main/java/com/exemple/monmod/MonMod.java
package com.exemple.monmod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MonMod implements ModInitializer {{
    public static final String MOD_ID = "monmod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {{
        LOGGER.info("Mon Mod chargé !");
    }}
}}
```
</contexte_minecraft>"""
