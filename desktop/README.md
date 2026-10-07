# Atelier IA local (Ubuntu)

Version **sur ordinateur** du chat IA, avec deux façons de travailler :

- **Application de bureau « Atelier IA »** (`atelier ui`, ou l'icône du menu des applications) :
  une vraie application avec sa fenêtre, son icône dans le dock et ses menus, qui reprend
  l'interface de la version web (conversations, fichiers, réglages, tâches de fond, état des
  fournisseurs). On peut y joindre des fichiers, des archives .zip, des PDF et des images, et
  demander des images. Les projets **de tous les langages** (Python, JavaScript/TypeScript, Java,
  mods Minecraft, C/C++, Rust, Go…) sont construits et testés **sur votre ordinateur** d'un clic ;
  le `.jar`, l'exécutable ou l'archive produite s'enregistre d'un clic, et les sites web
  s'affichent dans un aperçu.
- **`atelier` en console** : les fichiers produits par le modèle sont **écrits directement dans
  le dossier de votre projet**, compilés en local, corrigés en boucle jusqu'au `.jar`.

Dans les deux cas, JDK 25 et Gradle 9.7.1 sont installés par l'atelier, sans sudo. Seul l'appel au
modèle IA passe par internet (NVIDIA, Groq, OpenRouter, Cloudflare… avec bascule automatique).

## Application de bureau (`atelier ui`)

```bash
atelier ui               # ouvre l'application (démarre le serveur local si besoin)
```

Ou « **Atelier IA** » dans le menu des applications (l'icône peut être épinglée au dock).

- **Une vraie fenêtre** (Electron, le moteur de VS Code ou Discord) : menus Fichier / Édition /
  Aller / Affichage / Aide, menu contextuel (copier, coller, correcteur orthographique français),
  taille de fenêtre mémorisée, une seule instance (relancer ramène la fenêtre), notification à la
  fin d'une compilation quand la fenêtre est en arrière-plan.
- **Explorateur de fichiers façon VS Code** (Ctrl+Maj+E ou menu Affichage) : arborescence du
  projet, onglets, code coloré avec numéros de ligne. Pendant que le modèle écrit, le fichier
  s'ouvre et se remplit en direct ; après une réponse, les fichiers nouveaux portent un **U**, les
  modifiés un **M**, et les lignes changées sont surlignées en vert dans la marge.
- **Fermeture** : le serveur local s'arrête avec l'application. Si une tâche de fond tourne,
  l'application propose de la **laisser tourner en arrière-plan** (le serveur continue, rouvrez
  Atelier IA pour voir le résultat) ou de tout arrêter (la tâche reprendra au prochain lancement).
- Les liens externes s'ouvrent dans votre navigateur ; la fenêtre n'affiche que l'atelier.
- Electron est téléchargé une seule fois (≈ 120 Mo, depuis github.com/electron, somme SHA-256
  vérifiée) dans `~/.local/share/atelier/electron`, sans sudo. Sur les Ubuntu qui restreignent
  les espaces de noms (24.04+), le bac à sable de Chromium n'est pas disponible sans droits
  administrateur : l'application le détecte et se lance sans lui (elle n'affiche que l'atelier
  local, jamais de site externe).
- Le serveur écoute **uniquement sur 127.0.0.1** (port 3210, ou le suivant s'il est pris) : pas
  de mot de passe, rien n'est exposé au réseau. Les requêtes venant d'autres sites sont refusées.
- Il utilise les clés de `atelier config` ; après un changement, `atelier ui` redémarre le serveur
  tout seul.
- Conversations et réglages : `~/.local/share/atelier/ui` (base locale). Jars compilés :
  `~/.local/share/atelier/compilations/jars` (menu Fichier → Ouvrir le dossier des compilations).

| Commande | Effet |
|---|---|
| `atelier ui --navigateur` | ouvrir dans le navigateur au lieu de l'application |
| `atelier ui --arreter` | arrêter le serveur |
| `atelier ui --redemarrer` | redémarrer le serveur |
| `atelier ui --sans-fenetre` | démarrer le serveur sans ouvrir de fenêtre (adresse affichée) |
| `atelier ui --port 4000` | autre port |

Journal du serveur : `~/.local/share/atelier/ui/ui.log`.

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
| Interface graphique | `~/.local/share/atelier/web` | application livrée dans l'archive (dossier `web/`) |
| Node LTS | `~/.local/share/atelier/node` | seulement si le système n'a pas Node 20.9+ ; nodejs.org, SHA-256 vérifié |
| Electron 44 | `~/.local/share/atelier/electron` | fenêtre de l'application ; github.com/electron, SHA-256 vérifié |
| Entrée de menu | `~/.local/share/applications/atelier-ia.desktop` | « Atelier IA » |

L'environnement Python est créé par la première méthode qui fonctionne sur votre machine :
`python3 -m venv` ; sinon (Ubuntu sans le paquet `python3-venv`, cas courant sans sudo) un venv
sans `ensurepip` complété par `get-pip.py` ; sinon un dossier de bibliothèques installé par
`pip.pyz`. Les trois méthodes ont été testées, et `sudo` n'est jamais appelé.

Le JDK et Gradle peuvent être (ré)installés seuls : `atelier installer` (`--forcer` pour
retélécharger). Désinstallation : `./desinstaller.sh` (vos projets, votre configuration et vos
conversations sont conservés ; `--tout` retire aussi configuration et conversations).

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

L'interface est l'application Next.js du dépôt, construite en mode atelier local
(`NEXT_PUBLIC_ATELIER_LOCAL=1` : serveur autonome, construction locale par le script universel
`.atelier/construire.sh` — Gradle et JDK de l'atelier, Node de l'application, Python de l'atelier ;
Rust, Go, gcc, CMake… s'ils sont installés sur la machine —, accès limité à
127.0.0.1). Pour la reconstruire dans `desktop/web/` (après `npm ci` à la racine du dépôt) :

```bash
python3 desktop/outils/construire_web.py
```

La construction est refusée si une valeur secrète de `.env.local` s'y retrouve.
