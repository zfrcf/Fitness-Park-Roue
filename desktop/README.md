# Atelier IA local (Ubuntu)

Version **sur ordinateur** du chat IA : tout se passe dans le terminal, les fichiers produits par
le modèle sont **écrits directement dans le dossier de votre projet**, et la compilation se fait
**en local avec `gradle build`** (JDK 25 et Gradle 9.7.1 installés par l'atelier). En cas d'échec,
le journal est renvoyé au modèle qui corrige, en boucle, jusqu'au `.jar`.

Aucun navigateur, aucun serveur, aucun GitHub Actions : seul l'appel au modèle IA passe par
internet (NVIDIA, Groq, OpenRouter, Cloudflare… avec bascule automatique de l'un à l'autre).

## Installation (sans sudo, sans pilote)

Aucun droit administrateur n'est nécessaire, et aucun pilote graphique : les modèles (NVIDIA,
Groq…) tournent sur les serveurs des fournisseurs, votre ordinateur ne fait qu'envoyer du texte
et compiler avec Gradle.

```bash
cd atelier-ia-local      # dossier de l'archive (ou desktop/ du dépôt)
./install.sh             # ou, de façon équivalente : python3 installer.py
```

Seul prérequis : `python3` 3.10 ou plus récent, présent d'office sur Ubuntu 22.04 et plus récent
(`python3 --version` pour vérifier). Tout est installé dans votre dossier personnel :

| Élément | Où | Détail |
|---|---|---|
| Environnement Python | `~/.local/share/atelier/venv` | dépendances `httpx` et `rich` uniquement |
| JDK Temurin 25 | `~/.local/share/atelier/jdk` | téléchargé depuis Adoptium, somme SHA-256 vérifiée |
| Gradle 9.7.1 | `~/.local/share/atelier/gradle` | téléchargé depuis services.gradle.org, somme SHA-256 vérifiée |
| Commande | `~/.local/bin/atelier` | ajoutée au `PATH` via `~/.bashrc` si besoin |

L'environnement Python est créé par la première méthode qui fonctionne sur votre machine :
`python3 -m venv` ; sinon (Ubuntu sans le paquet `python3-venv`, cas courant sans sudo) un venv
sans `ensurepip` complété par `get-pip.py` ; sinon un dossier de bibliothèques installé par
`pip.pyz`. Les trois méthodes ont été testées, et `sudo` n'est jamais appelé.

Le JDK et Gradle peuvent être (ré)installés seuls : `atelier installer` (`--forcer` pour
retélécharger). Désinstallation : `./desinstaller.sh` (vos projets sont conservés).

## Configurer les clés API

```bash
atelier config                                   # assistant : NVIDIA, Groq, OpenRouter, Cloudflare ou autre
atelier config --importer ~/chemin/.env.local    # reprendre les PROVIDER_n_* de la version web
atelier doctor                                   # tout vérifier
atelier tester                                   # interroger chaque fournisseur
```

Les clés sont stockées dans `~/.config/atelier/config.env` (droits 600), jamais ailleurs. Le format
est celui de la version web (`PROVIDER_1_NAME`, `_BASE_URL`, `_API_KEY`, `_MODEL`, `_CONTEXT`) ;
l'ordre des rangs est l'ordre d'essai.

## Utilisation

```bash
atelier                         # liste vos projets, en ouvre un ou en crée un
atelier nouveau mon-mod         # crée ~/AtelierProjets/mon-mod et ouvre la discussion
atelier ouvrir ~/code/projet    # travailler sur un dossier existant
atelier build                   # gradle build dans le dossier courant
atelier build --corriger 5      # … et si ça échoue, le modèle corrige jusqu'à 5 fois
atelier demander "Ajoute une commande /spawn" --corriger 0   # un tour sans interaction (0 = sans limite)
```

Dans la discussion :

| Commande | Effet |
|---|---|
| (texte libre) | envoyé au modèle ; les fichiers de sa réponse sont écrits dans le projet |
| `/build` | compiler maintenant |
| `/auto [N]` | compiler et corriger en boucle jusqu'au jar (N corrections max, 0 = sans limite) |
| `/compilauto on\|off` | compilation automatique après chaque réponse qui change le projet |
| `/fichiers`, `/jar`, `/journal` | fichiers du projet, jars produits, journal complet de Gradle |
| `/ouvrir` | ouvrir le dossier dans le gestionnaire de fichiers |
| `/annuler`, `/effacer` | oublier le dernier échange, vider l'historique (les fichiers restent) |
| `/raisonnement niveau` | `aucun`, `faible`, `moyen`, `eleve` |
| `/modele` | fournisseurs et état de la rotation |
| `"""` | message sur plusieurs lignes (collez, puis `"""` seul sur une ligne) |

Ctrl+C interrompt la génération ou la compilation en cours ; Ctrl+D quitte.

## Modifier sans tout réécrire

Le modèle reçoit à chaque tour l'état **actuel** des fichiers sur le disque (si vous modifiez un
fichier dans votre éditeur, c'est votre version qui compte). Pour un changement localisé, il
envoie un bloc de modification appliqué directement au fichier :

````markdown
```modif src/main/java/com/exemple/MonMod.java
<<<<<<< CHERCHER
        int vitesse = 1;
=======
        int vitesse = 2;
>>>>>>> REMPLACER
```
````

Une modification qui ne correspond pas exactement au fichier est signalée (« non appliqué ») et
rappelée au modèle au tour suivant. Une ligne `Supprimer : chemin` supprime un fichier. Les
fichiers ne sont jamais écrits hors du dossier du projet (chemins absolus, `..` et liens
symboliques refusés) ; `gradlew`, `.github/` et `.git/` ne sont jamais écrits.

## Compilation automatique et correction en boucle

Après chaque réponse qui crée ou modifie un projet Gradle, `gradle build` est lancé (une seule fois
par état du projet). En cas d'échec, l'atelier renvoie les erreurs utiles du journal au modèle et
recompile après sa correction, jusqu'à `ATELIER_CORRECTIONS_MAX` essais (5 par défaut). Un projet
inchangé n'est jamais recompilé, et la boucle s'arrête si le modèle ne modifie plus rien.

Pour les mods Minecraft, l'atelier ajoute au prompt les versions à jour (Fabric Loader, Fabric API,
Loom, NeoForge) et le modèle de projet Fabric vérifié par compilation réelle : 26.x (non obfusqué,
`net.fabricmc.fabric-loom`, sans mappings) et 1.21.x (`fabric-loom-remap` + mappings Mojang).

## Réglages

`atelier config --regler CLE=VALEUR …` (ou édition de `~/.config/atelier/config.env`) :

| Clé | Défaut | Rôle |
|---|---|---|
| `ATELIER_DOSSIER_PROJETS` | `~/AtelierProjets` | dossier des projets |
| `ATELIER_COMPILATION_AUTO` | `1` | compiler après chaque réponse qui change le projet |
| `ATELIER_CORRECTIONS_MAX` | `5` | corrections automatiques après un échec (0 = aucune) |
| `ATELIER_RAISONNEMENT` | `aucun` | `aucun`, `faible`, `moyen`, `eleve` |
| `ATELIER_TEMPERATURE` | `0.4` | créativité du modèle (0 à 2) |
| `ATELIER_MAX_TOKENS` | `16384` | longueur maximale d'une réponse |

## Fichiers d'un projet

```
mon-mod/
├── build.gradle, settings.gradle, src/…   vos fichiers (versionnables avec git)
├── build/libs/*.jar                        le résultat de gradle build
└── .atelier/                               historique de la conversation, dernier journal, état
```

## Développement

```bash
~/.local/share/atelier/venv/bin/pip install -e ".[dev]"
~/.local/share/atelier/venv/bin/python -m pytest
```
