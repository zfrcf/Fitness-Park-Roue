/**
 * Commande « pip » de la console Python du navigateur. Pyodide n'a pas de vrai pip : ce module
 * Python (exécuté DANS Pyodide) traduit toutes les formes usuelles de pip vers micropip 0.6 :
 * install (noms, versions, extras, marqueurs, -r requirements.txt imbriqués, wheels .whl, -U, --pre,
 * --no-deps, -i / --extra-index-url), uninstall, list, freeze, show, check, --version, help.
 *
 * Un paquet qui échoue n'empêche pas les autres de s'installer, et chaque échec est expliqué en une
 * ligne (plus de traceback). La console appelle `await atelier_pip.pip("<arguments>")`.
 */

/** Source du module Python `atelier_pip` (Python 3.11+ : testé en CPython et en Pyodide 3.12). */
export const SOURCE_PIP = String.raw`
"""Commande « pip » de la console Python du navigateur (Pyodide), traduite vers micropip."""

import importlib.metadata as _meta
import os
import re
import shlex
import sys
from urllib.parse import urlparse

try:
    from packaging.requirements import InvalidRequirement, Requirement
    from packaging.utils import canonicalize_name
except Exception:  # packaging est une dépendance de micropip : ne devrait pas manquer
    Requirement = None
    InvalidRequirement = ValueError

    def canonicalize_name(nom):
        return re.sub(r"[-_.]+", "-", nom).lower()


PYPI = "https://pypi.org/simple"

# Pas des paquets Python : outils de compilation d'autres langages.
OUTILS_BUILD = {
    "gradle", "gradlew", "mvn", "maven", "make", "gcc", "g++", "clang", "cargo", "rustc", "go",
    "dotnet", "msbuild", "javac", "java", "kotlin", "kotlinc", "npm", "npx", "node", "yarn",
    "pnpm", "bun", "deno", "podman",
}
CONSEIL_BUILD = (
    "Pour compiler et tester un projet (Gradle, Node, Rust, Go, C…), utilisez le bouton "
    "« Construire et tester » sous les fichiers d'une réponse."
)
# Conseils ajoutés à l'échec de paquets natifs connus.
_EXE = "il fabrique des exécutables : utilisez-le sur votre ordinateur (atelier local), pas dans le navigateur"
_LOURD = "bibliothèque native trop lourde, non disponible pour WebAssembly"
CONSEILS = {
    "pyinstaller": _EXE, "nuitka": _EXE, "cx-freeze": _EXE, "py2exe": _EXE, "py2app": _EXE,
    "torch": _LOURD, "torchvision": _LOURD, "tensorflow": _LOURD, "jax": _LOURD, "jaxlib": _LOURD,
    "psycopg2": "pilote PostgreSQL natif ; une base de données n'est de toute façon pas joignable depuis le navigateur",
    "psycopg2-binary": "pilote PostgreSQL natif ; une base de données n'est de toute façon pas joignable depuis le navigateur",
    "pyaudio": "accès audio natif, impossible dans le navigateur",
    "playwright": "il pilote un navigateur, impossible depuis le navigateur lui-même",
}

# Options suivies d'une valeur (« -x valeur », « -xvaleur », « --opt valeur », « --opt=valeur »).
AVEC_VALEUR = {
    "-r", "--requirement", "-c", "--constraint", "-e", "--editable", "-i", "--index-url",
    "--extra-index-url", "-f", "--find-links", "-t", "--target", "--prefix", "--root",
    "--upgrade-strategy", "--no-binary", "--only-binary", "--platform", "--python-version",
    "--implementation", "--abi", "--progress-bar", "--root-user-action", "--report", "--timeout",
    "--retries", "--proxy", "--cert", "--client-cert", "--cache-dir", "--src", "--log",
    "--trusted-host", "--global-option", "--install-option", "--config-settings", "-C",
    "--exists-action", "--format", "--path", "--exclude", "--python",
}
INDISPONIBLES = {"download", "wheel", "cache", "config", "debug", "hash", "search", "index", "inspect", "completion", "lock"}
NON_LISTES_PAR_FREEZE = {"pip", "setuptools", "wheel", "distribute"}

AIDE = """Usage : pip <commande> [options]
(console Python du navigateur : pip passe par micropip, l'installateur de Pyodide)

Commandes :
  install       Installer des paquets : noms, versions, extras, -r fichier, wheels .whl
  uninstall     Désinstaller des paquets (-r fichier accepté)
  list          Lister les paquets installés (--format=freeze|json)
  freeze        Paquets installés au format requirements.txt
  show          Détails d'un paquet (version, dépendances…)
  check         Vérifier que les dépendances installées sont cohérentes
  help          Cette aide

Options d'install :
  -r, --requirement <fichier>   Depuis un fichier (requirements.txt, -r imbriqués compris)
  -U, --upgrade                 Réinstaller la version la plus récente
  --pre                         Autoriser les pré-versions
  --no-deps                     Ne pas installer les dépendances
  -i, --index-url <url>         Autre index de paquets (--extra-index-url : index en plus)
  -q, --quiet                   N'afficher que les échecs
  (--user, --no-cache-dir, --break-system-packages… sont acceptés et sans effet ici.)

Ce qui s'installe : les paquets « Python pur » de PyPI et ceux compilés pour Pyodide (numpy,
pandas, scipy, matplotlib, scikit-learn, opencv, lxml, pillow…). Ceux à code natif non compilé
pour WebAssembly (torch, pyinstaller…) ne le peuvent pas. Les installations durent le temps de
la page. Les fichiers du projet de la conversation et ceux importés dans la console sont dans le
dossier courant : « pip install -r requirements.txt » les trouve."""


class _Arret(Exception):
    """Erreur d'usage : message affiché tel quel, sans traceback."""


def _distributions():
    return _meta.distributions()


def _distribution(nom):
    return _meta.distribution(nom)


def _canon(nom):
    return canonicalize_name(nom)


def _installes():
    """{nom canonique: (nom affiché, version)} des paquets présents."""
    import importlib

    importlib.invalidate_caches()  # sinon importlib.metadata peut voir l'état d'avant une (dés)installation
    out = {}
    for d in _distributions():
        try:
            nom = d.metadata["Name"]
        except Exception:
            nom = None
        if nom:
            out.setdefault(_canon(nom), (nom, d.version))
    return out


def _decouper(ligne):
    try:
        return shlex.split(ligne, posix=True)
    except ValueError as e:
        raise _Arret(f"ERREUR : ligne de commande invalide ({e}).")


def _options(tokens):
    """Sépare les options [(nom, valeur|None)] des arguments positionnels."""
    opts, pos = [], []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == "--":
            pos.extend(tokens[i + 1:])
            break
        if t.startswith("--"):
            if "=" in t:
                nom, val = t.split("=", 1)
                opts.append((nom, val))
            elif t in AVEC_VALEUR:
                if i + 1 >= len(tokens):
                    raise _Arret(f"ERREUR : l'option {t} attend une valeur.")
                opts.append((t, tokens[i + 1]))
                i += 1
            else:
                opts.append((t, None))
        elif t.startswith("-") and len(t) > 1:
            court = t[:2]
            if court in AVEC_VALEUR:
                if len(t) > 2:
                    opts.append((court, t[2:].lstrip("=")))  # « -rrequirements.txt »
                elif i + 1 < len(tokens):
                    opts.append((court, tokens[i + 1]))
                    i += 1
                else:
                    raise _Arret(f"ERREUR : l'option {t} attend une valeur.")
            else:
                for c in t[1:]:  # « -qU », « -vv »
                    opts.append(("-" + c, None))
        else:
            pos.append(t)
        i += 1
    return opts, pos


def _trouver_fichier(chemin, base, notes):
    candidats = []
    if os.path.isabs(chemin):
        candidats.append(chemin)
    else:
        if base:
            candidats.append(os.path.join(base, chemin))
        candidats.append(chemin)
    for c in candidats:
        if os.path.isfile(c):
            return os.path.abspath(c)
    # Pas à cet endroit : on le cherche par son nom dans le dossier courant (projet importé).
    nom = os.path.basename(chemin)
    trouves = []
    for racine, dossiers, fichiers in os.walk(os.getcwd()):
        dossiers[:] = sorted(d for d in dossiers if not d.startswith(".") and d not in ("node_modules", "__pycache__", "site-packages", "venv"))
        if nom in fichiers:
            trouves.append(os.path.join(racine, nom))
        if len(trouves) > 20:
            break
    if len(trouves) == 1:
        notes.append(f"« {chemin} » trouvé dans {os.path.relpath(trouves[0])}.")
        return trouves[0]
    if trouves:
        liste = ", ".join(os.path.relpath(t) for t in trouves[:10])
        raise _Arret(f"ERREUR : plusieurs fichiers « {nom} » : {liste}.\nPrécisez lequel, ex. : pip install -r {os.path.relpath(trouves[0])}")
    raise _Arret(
        f"ERREUR : fichier « {chemin} » introuvable dans la console (dossier {os.getcwd()}).\n"
        "→ Importez-le avec le bouton « Importer des fichiers » de la console,\n"
        "→ ou ouvrez la console depuis la conversation dont le projet contient ce fichier : ses fichiers y sont copiés automatiquement."
    )


def _options_fichier(opts, reglages, notes, dossier, vus, sortie):
    for nom, val in opts:
        if nom in ("-r", "--requirement"):
            sortie.extend(_lire_requirements(val, reglages, notes, dossier, vus))
        elif nom in ("-e", "--editable"):
            notes.append(f"« -e {val} » ignoré : le mode éditable n'existe pas dans le navigateur. Les modules d'un projet local sont déjà importables depuis le dossier courant.")
        elif nom in ("-c", "--constraint"):
            notes.append(f"Contraintes « {val} » ignorées (non gérées dans le navigateur).")
        elif nom in ("-i", "--index-url"):
            reglages["index"] = val
        elif nom == "--extra-index-url":
            reglages["extra"].append(val)
        elif nom == "--pre":
            reglages["pre"] = True
        elif nom in ("-f", "--find-links"):
            notes.append(f"« --find-links {val} » ignoré.")


def _lire_requirements(chemin, reglages, notes, base=None, vus=None):
    """Lignes d'un fichier requirements (format pip) : [(spécification, fichier d'origine)]."""
    vus = set() if vus is None else vus
    if not chemin:
        raise _Arret("ERREUR : « -r » attend un nom de fichier, ex. : pip install -r requirements.txt")
    reel = _trouver_fichier(chemin, base, notes)
    if reel in vus:
        return []
    vus.add(reel)
    with open(reel, encoding="utf-8-sig", errors="replace") as f:
        texte = f.read()
    texte = re.sub(r"\\\r?\n", " ", texte)  # lignes prolongées par « \ »
    origine = os.path.relpath(reel)
    dossier = os.path.dirname(reel)
    sortie = []
    for brute in texte.splitlines():
        ligne = brute.strip()
        if not ligne or ligne.startswith("#"):
            continue
        ligne = re.split(r"\s+#", ligne, maxsplit=1)[0].strip()
        ligne = re.sub(r"[$][{]([A-Za-z0-9_]+)[}]", lambda m: os.environ.get(m.group(1), ""), ligne)
        if ligne.startswith("-"):
            opts, _ = _options(_decouper(ligne))
            _options_fichier(opts, reglages, notes, dossier, vus, sortie)
            continue
        ligne = re.sub(r"\s+--[a-z-]+(=\S+|\s+\S+)?", "", ligne)  # « --hash=… » par ligne
        ligne = re.sub(r"\s+", " ", ligne).strip()
        if ligne:
            sortie.append((ligne, origine))
    return sortie


def _marqueur_actif(req):
    if req.marker is None:
        return True
    try:
        return req.marker.evaluate({"extra": ""})
    except Exception:
        return True


def _preparer(texte):
    """(spécification pour micropip, nom canonique), ou la raison pour laquelle on l'ignore."""
    t = texte.strip()
    bas = t.split(";")[0].strip()
    if re.match(r"^(git|hg|svn|bzr)\+", bas) or re.search(r"@\s*(git|hg|svn|bzr)\+", bas):
        return "dépôt de sources (git…) : il faudrait compiler le paquet, impossible ici. Installez-le depuis PyPI par son nom."
    if bas.lower().endswith(".whl"):
        nom = _canon(os.path.basename(urlparse(bas).path).split("-")[0])
        if "://" in bas:
            return (t, nom)
        chemin = os.path.abspath(bas)
        if os.path.isfile(chemin):
            return ("emfs:" + chemin, nom)
        return f"fichier introuvable ({chemin})"
    if re.search(r"\.(tar\.gz|tgz|tar\.bz2|zip)$", bas, re.I):
        return "archive de sources : seules les wheels (.whl) s'installent dans le navigateur"
    if bas in (".", "..") or bas.startswith(("./", "../", "/")) or os.path.isdir(bas):
        return "projet local : pas d'installation possible ici, mais ses modules Python sont déjà importables depuis le dossier courant"
    if Requirement is None:
        return (t, _canon(re.split(r"[\s\[<>=!~;@]", bas, maxsplit=1)[0]))
    try:
        req = Requirement(t)
    except InvalidRequirement:
        return "spécification de paquet invalide"
    if not _marqueur_actif(req):
        return f"réservé à une autre plateforme ({req.marker})"
    nom = _canon(req.name)
    if nom == "pip":
        return "le pip de la console est toujours à jour (il passe par micropip)"
    if nom in OUTILS_BUILD:
        return f"ce n'est pas un paquet Python mais un outil de compilation. {CONSEIL_BUILD}"
    if req.url and not urlparse(req.url).path.endswith(".whl"):
        return "référence directe vers des sources : seules les wheels (.whl) s'installent"
    return (t, nom)


def _expliquer(nom, msg):
    if "Can't find a pure Python 3 wheel" in msg or "CompatibilityNotFound" in msg:
        base = "aucune version installable dans le navigateur (code natif non compilé pour WebAssembly, ou version demandée inexistante)"
    elif "Can't fetch metadata" in msg or "Unsupported content type" in msg or "404" in msg or "Not Found" in msg:
        base = "introuvable sur l'index des paquets (PyPI) : vérifiez le nom"
    elif "already installed" in msg:
        base = "une autre version est déjà chargée : rechargez la page pour repartir d'une console neuve"
    elif re.search(r"fetch|network|connection|timed? ?out", msg, re.I):
        base = "téléchargement impossible (connexion coupée, ou le serveur refuse les requêtes venant d'un navigateur)"
    else:
        lignes = msg.strip().splitlines()
        base = lignes[0] if lignes else "erreur inconnue"
    conseil = CONSEILS.get(nom)
    return f"{base} — {conseil}" if conseil else base


async def _installer(tokens):
    import micropip

    opts, pos = _options(tokens)
    reglages = {"deps": True, "pre": False, "maj": False, "silence": False, "index": None, "extra": []}
    notes = []
    demandes = [(p, None) for p in pos]
    vus = set()
    for nom, val in opts:
        if nom == "--no-deps":
            reglages["deps"] = False
        elif nom in ("-U", "--upgrade", "--force-reinstall", "-I", "--ignore-installed"):
            reglages["maj"] = True
        elif nom in ("-q", "--quiet"):
            reglages["silence"] = True
    _options_fichier(opts, reglages, notes, None, vus, demandes)
    if not demandes:
        raise _Arret("ERREUR : indiquez au moins un paquet (pip install nom) ou un fichier (pip install -r requirements.txt).")

    cibles, ignores, deja_vus = [], [], set()
    for texte, _origine in demandes:
        r = _preparer(texte)
        if isinstance(r, str):
            ignores.append((texte, r))
        elif r[1] not in deja_vus:
            deja_vus.add(r[1])
            cibles.append(r)

    index = None
    if reglages["index"] or reglages["extra"]:
        index = [reglages["index"] or PYPI] + reglages["extra"]
    reglages_mp = {"deps": reglages["deps"], "pre": reglages["pre"], "index_urls": index}

    avant = _installes()
    if reglages["maj"]:
        for _t, nom in cibles:
            if nom in avant:
                try:
                    micropip.uninstall(nom)
                except Exception:
                    pass
    echecs = {}
    if cibles:
        try:
            await micropip.install([t for t, _ in cibles], keep_going=True, **reglages_mp)
        except Exception:
            # Au moins un paquet bloque l'ensemble : on installe un par un pour sauver les autres.
            for t, nom in cibles:
                try:
                    await micropip.install(t, **reglages_mp)
                except Exception as e:
                    msg = str(e)
                    if "already installed" in msg:  # autre version demandée : on remplace, comme pip
                        try:
                            micropip.uninstall(nom)
                            await micropip.install(t, **reglages_mp)
                            continue
                        except Exception as e2:
                            msg = str(e2)
                    echecs[t] = _expliquer(nom, msg)
    dependances = await _completer_dependances(micropip, cibles, echecs, avant, reglages, reglages_mp)
    apres = _installes()

    nouveaux = sorted((apres[n][0], apres[n][1]) for n in apres if avant.get(n, (None, None))[1] != apres[n][1])
    deja = sorted(apres[nom] for t, nom in cibles if t not in echecs and nom in avant and nom in apres and avant[nom][1] == apres[nom][1])
    if not reglages["silence"]:
        for n in notes:
            print(n)
        if deja:
            print("Déjà installé : " + ", ".join(f"{n} {v}" for n, v in deja))
        if nouveaux:
            print("Installé : " + ", ".join(f"{n} {v}" for n, v in nouveaux))
        for t, raison in ignores:
            print(f"Ignoré : {t} — {raison}")
    for t, raison in echecs.items():
        print(f"ÉCHEC : {t} — {raison}")
    for dep, (parent, raison) in sorted(dependances.items()):
        print(f"ATTENTION : dépendance {dep} (requise par {parent}) non installée — {raison}")
    if not reglages["silence"]:
        remplaces = [n for n, _ in nouveaux if _canon(n) in avant]
        if remplaces:
            print("Version changée pour " + ", ".join(remplaces) + " : si le module était déjà importé, rechargez la page pour l'utiliser.")
        bilan = [f"{len(nouveaux)} installé(s)" if nouveaux else "", f"{len(deja)} déjà présent(s)" if deja else "", f"{len(echecs)} échec(s)" if echecs else "", f"{len(ignores)} ignoré(s)" if ignores else ""]
        print("Terminé : " + (", ".join(b for b in bilan if b) or "rien à faire") + ".")


async def _completer_dependances(micropip, cibles, echecs, avant, reglages, reglages_mp):
    """
    Installe les dépendances déclarées mais absentes des paquets de cette commande : certains paquets
    de la distribution Pyodide sont livrés sans les leurs (ex. rich sans pygments), alors que pip les
    installerait. Jusqu'à 3 tours (dépendances de dépendances). Renvoie {dépendance: (parent, raison)}.
    """
    if not reglages["deps"]:
        return {}
    actuels = _installes()
    concernes = {n for n in actuels if avant.get(n, (None, None))[1] != actuels[n][1]}
    concernes |= {nom for t, nom in cibles if t not in echecs}
    ratees = {}
    for _ in range(3):
        installes = _installes()
        a_installer = {}
        for d in _distributions():
            parent = d.metadata["Name"]
            if not parent or _canon(parent) not in concernes:
                continue
            for req in _requis(d):
                c = _canon(req.name)
                if c not in installes and c not in ratees and c not in a_installer:
                    a_installer[c] = (str(req), parent)
        if not a_installer:
            break
        for c, (spec, parent) in a_installer.items():
            try:
                await micropip.install(spec, **reglages_mp)
            except Exception as e:
                ratees[c] = (parent, _expliquer(c, str(e)))
        concernes |= set(a_installer)
    return ratees


def _desinstaller(tokens):
    import micropip

    opts, noms = _options(tokens)
    notes, reglages = [], {"index": None, "extra": [], "pre": False}
    for nom, val in opts:
        if nom in ("-r", "--requirement"):
            noms.extend(t for t, _ in _lire_requirements(val, reglages, notes))
    if not noms:
        raise _Arret("ERREUR : indiquez au moins un paquet (pip uninstall nom).")
    for n in notes:
        print(n)
    avant = _installes()
    canons = []
    for n in noms:
        try:
            c = _canon(Requirement(n).name) if Requirement else _canon(n)
        except Exception:
            c = _canon(n)
        if c in avant:
            canons.append(c)
        else:
            print(f"Ignoré : {n} n'est pas installé.")
    if canons:
        micropip.uninstall(canons)
        apres = _installes()
        for c in canons:
            n, v = avant[c]
            print(f"Désinstallé : {n} {v}" if c not in apres else f"ÉCHEC : {n} n'a pas pu être désinstallé.")


def _lister(tokens):
    opts, _ = _options(tokens)
    fmt = "columns"
    for nom, val in opts:
        if nom == "--format":
            fmt = (val or "").lower()
        elif nom in ("-o", "--outdated", "-u", "--uptodate"):
            raise _Arret("ERREUR : « pip list --outdated » n'est pas disponible dans le navigateur.")
    paquets = sorted(_installes().values(), key=lambda p: p[0].lower())
    if fmt == "freeze":
        for n, v in paquets:
            print(f"{n}=={v}")
        return
    if fmt == "json":
        import json

        print(json.dumps([{"name": n, "version": v} for n, v in paquets]))
        return
    lp = max([len("Package")] + [len(n) for n, _ in paquets])
    lv = max([len("Version")] + [len(v) for _, v in paquets])
    print(f"{'Package'.ljust(lp)} Version")
    print(f"{'-' * lp} {'-' * lv}")
    for n, v in paquets:
        print(f"{n.ljust(lp)} {v}")


def _freeze():
    for n, v in sorted(_installes().values(), key=lambda p: p[0].lower()):
        if _canon(n) not in NON_LISTES_PAR_FREEZE:
            print(f"{n}=={v}")


def _requis(d):
    """Dépendances actives (hors extras) d'une distribution : [Requirement]."""
    out = []
    if Requirement is None:
        return out
    for r in d.requires or []:
        try:
            req = Requirement(r)
        except Exception:
            continue
        if _marqueur_actif(req):
            out.append(req)
    return out


def _montrer(tokens):
    _, noms = _options(tokens)
    if not noms:
        raise _Arret("ERREUR : indiquez un paquet (pip show nom).")
    requis_par = {}
    for d in _distributions():
        for req in _requis(d):
            requis_par.setdefault(_canon(req.name), set()).add(d.metadata["Name"])
    premier = True
    for nom in noms:
        try:
            d = _distribution(nom)
        except _meta.PackageNotFoundError:
            print(f"ATTENTION : paquet introuvable : {nom}")
            continue
        if not premier:
            print("---")
        premier = False
        m = d.metadata
        print(f"Name: {m['Name']}")
        print(f"Version: {d.version}")
        print(f"Summary: {m['Summary'] or ''}")
        print(f"Home-page: {m['Home-page'] or ''}")
        print(f"Author: {m['Author'] or m['Author-email'] or ''}")
        print(f"License: {m['License'] or ''}")
        print(f"Location: {d.locate_file('')}")
        print(f"Requires: {', '.join(sorted({req.name for req in _requis(d)}))}")
        print(f"Required-by: {', '.join(sorted(requis_par.get(_canon(m['Name']), set())))}")


def _verifier():
    inst = _installes()
    problemes = set()
    for d in _distributions():
        nom = d.metadata["Name"]
        if not nom:
            continue
        for req in _requis(d):
            c = _canon(req.name)
            if c not in inst:
                problemes.add(f"{nom} {d.version} requiert {req.name}, qui n'est pas installé.")
            elif req.specifier and not req.specifier.contains(inst[c][1], prereleases=True):
                problemes.add(f"{nom} {d.version} requiert {req}, mais la version installée est {inst[c][1]}.")
    for p in sorted(problemes):
        print(p)
    if not problemes:
        print("Aucune dépendance cassée.")


def _version():
    try:
        import micropip

        mv = micropip.__version__
    except Exception:
        mv = "?"
    try:
        import pyodide

        pv = pyodide.__version__
    except Exception:
        pv = "?"
    print(f"pip (micropip {mv}) — Python {sys.version.split()[0]} dans le navigateur (Pyodide {pv})")


async def _pip(tokens):
    k = 0
    while k < len(tokens) and tokens[k].startswith("-"):
        t = tokens[k]
        if t in ("-V", "--version"):
            return _version()
        if t in ("-h", "--help"):
            return print(AIDE)
        if t in AVEC_VALEUR:
            k += 1
        k += 1
    if k >= len(tokens):
        return print(AIDE)
    cmd = tokens[k].lower()
    reste = tokens[:k] + tokens[k + 1:]  # options globales (-q…) + options de la commande
    if cmd == "install":
        return await _installer(reste)
    if cmd in ("uninstall", "remove"):
        return _desinstaller(reste)
    if cmd == "list":
        return _lister(reste)
    if cmd == "freeze":
        return _freeze()
    if cmd == "show":
        return _montrer(reste)
    if cmd == "check":
        return _verifier()
    if cmd == "help":
        return print(AIDE)
    if cmd in INDISPONIBLES:
        raise _Arret(f"ERREUR : « pip {cmd} » n'est pas disponible dans le navigateur. « pip install » installe directement les paquets.")
    raise _Arret(f"ERREUR : commande inconnue « {tokens[k]} ». Tapez « pip help » pour la liste.")


async def pip(ligne=""):
    """Point d'entrée de la console : ne lève jamais, affiche un message clair."""
    try:
        await _pip(_decouper(ligne))
    except _Arret as e:
        print(str(e))
    except Exception as e:
        print(f"ERREUR : {type(e).__name__} : {e}")
`;

/** Code Python qui charge `atelier_pip` comme module (une fois par page). */
export function codeChargementPip(): string {
  return [
    "import sys as __s, types as __t",
    "__m = __t.ModuleType('atelier_pip')",
    `exec(compile(${JSON.stringify(SOURCE_PIP)}, 'atelier_pip.py', 'exec'), __m.__dict__)`,
    "__s.modules['atelier_pip'] = __m",
    "del __s, __t, __m",
  ].join("\n");
}
