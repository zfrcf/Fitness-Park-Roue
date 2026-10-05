"""Extraction des fichiers d'une réponse Markdown et modifications partielles.

Conventions reconnues (identiques à la version web) :
  ```java src/main/java/com/exemple/Mod.java        chemin sur la ligne d'ouverture
  ```json title="pack.mcmeta"   ```yaml:config/app.yml
  **src/x.java** / `src/x.java` / ### 1. `src/x.java` / Fichier : src/x.java   (ligne précédant le bloc)
  // src/x.java                                       (première ligne du bloc)
  ```modif src/x.java + paires <<<<<<< CHERCHER / ======= / >>>>>>> REMPLACER   (modification partielle)
  Supprimer : src/x.java                              (suppression)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_RE_CHEMIN = re.compile(
    r"^[\w@.-][\w@./-]*\.[A-Za-z0-9]{1,12}$|^(?:[\w@.-]+/)+[\w@.-]+$|^(?:Dockerfile|Makefile|LICENSE|gradlew|\.gitignore|\.env\.example)$"
)
_LANGUES_SEULES = re.compile(r"^(js|ts|py|sh|md|json|yaml|yml|xml|html|css|java|kt|c|cpp|cs|go|rs|rb|php|sql|toml|ini|txt|tsx|jsx|mjs|cjs)$", re.I)
_RE_LANGUE_MODIF = re.compile(r"^(modif|modification|edit|patch)$", re.I)

#: Chemins fournis par la chaîne de compilation ou dangereux à écrire : jamais pris dans une réponse.
RE_CHEMIN_RESERVE = re.compile(r"^\.github/|^\.git(/|$)|^vercel\.json$|(^|/)gradlew(\.bat)?$|(^|/)gradle-wrapper\.(jar|properties)$|^\.atelier(/|$)")


@dataclass
class Fichier:
    chemin: str
    contenu: str
    langue: str | None = None


@dataclass
class Modification:
    chemin: str
    remplacements: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class _Bloc:
    chemin: str
    langue: str | None
    contenu: str
    debut: int
    fin: int
    modification: bool


def nettoyer_chemin(brut: str) -> str | None:
    """Chemin relatif sûr (ni absolu, ni .., ni segment vide), ou None."""
    c = brut.strip().strip("\"'`«»").replace("\\", "/")
    c = re.sub(r"^(fichier|file)\s*:\s*", "", c, flags=re.I).strip()
    if c.startswith("/"):
        return None
    c = re.sub(r"^\./", "", c)
    if not c or len(c) > 200 or re.search(r"\s", c):
        return None
    segments = c.split("/")
    if any(s in ("", ".", "..") for s in segments):
        return None
    return c if _RE_CHEMIN.match(c) else None


def chemin_depuis_info(info: str) -> tuple[str | None, str | None]:
    """Ligne d'ouverture d'un bloc → (langue, chemin)."""
    t = info.strip()
    if not t:
        return None, None
    titre = re.search(r"(?:title|filename|file|path)=[\"']([^\"']+)[\"']", t, re.I)
    if titre:
        return (re.split(r"[\s:]", t)[0] or None), nettoyer_chemin(titre.group(1))
    deux_points = re.match(r"^([\w+#-]+):(\S+)$", t)
    if deux_points:
        return deux_points.group(1), nettoyer_chemin(deux_points.group(2))
    parties = [p for p in t.split() if not re.match(r"^\(.*\)$", p)]  # « (corrigé) » ignoré
    if len(parties) >= 2:
        chemin = nettoyer_chemin(parties[-1])
        if chemin:
            return parties[0], chemin
    if len(parties) == 1:
        chemin = nettoyer_chemin(parties[0])
        if chemin and "/" in chemin:
            return None, chemin
        if chemin and re.search(r"\.[a-z0-9]+$", chemin, re.I) and not _LANGUES_SEULES.match(chemin):
            return None, chemin
    return (parties[0] if parties else None), None


def _chemin_depuis_ligne(ligne: str) -> str | None:
    l = ligne.strip()
    l = re.sub(r"^#{1,6}\s*", "", l)
    l = re.sub(r"^[-*]\s+", "", l)
    l = re.sub(r"^\d+[.)]\s*", "", l)
    l = re.sub(r":$", "", l)
    m = re.match(r"^[*`\s]*(?:fichier|file)?\s*:?\s*[*`\s]*([^\s*`]+)[*`\s]*(?:\(.*\))?$", l, re.I)
    return nettoyer_chemin(m.group(1)) if m else None


def _analyser_blocs(lignes: list[str]) -> list[_Bloc]:
    blocs: list[_Bloc] = []
    i = 0
    while i < len(lignes):
        ouverture = re.match(r"^\s*(`{3,}|~{3,})(.*)$", lignes[i])
        if not ouverture:
            i += 1
            continue
        cloture = ouverture.group(1)
        langue, chemin = chemin_depuis_info(ouverture.group(2))

        def est_cloture(l: str, cloture: str = cloture) -> bool:
            m = re.match(r"^\s*(`{3,}|~{3,})\s*$", l)
            return bool(m) and m.group(1)[0] == cloture[0] and len(m.group(1)) >= len(cloture)

        j = i + 1
        corps: list[str] = []
        while j < len(lignes) and not est_cloture(lignes[j]):
            corps.append(lignes[j])
            j += 1
        if not chemin:
            k = i - 1
            while k >= 0 and not lignes[k].strip():
                k -= 1
            if k >= 0:
                chemin = _chemin_depuis_ligne(lignes[k])
        if not chemin and corps:
            m = re.match(r"^\s*(?://|#|--|<!--|/\*)\s*(?:fichier|file)?\s*:?\s*([^\s]+?)\s*(?:-->|\*/)?\s*$", corps[0], re.I)
            if m:
                c = nettoyer_chemin(m.group(1))
                if c and "/" in c:
                    chemin = c
                    corps = corps[1:]
        if chemin and corps:
            modification = bool(langue and _RE_LANGUE_MODIF.match(langue))
            contenu = "\n".join(corps).rstrip() + "\n"
            blocs.append(_Bloc(chemin, langue, contenu, i, min(j, len(lignes) - 1), modification))
        i = j + 1
    return blocs


def extraire_fichiers(markdown: str) -> list[Fichier]:
    """Fichiers entiers d'une réponse (le dernier bloc d'un même chemin l'emporte), hors chemins réservés."""
    fichiers: dict[str, Fichier] = {}
    for b in _analyser_blocs(markdown.split("\n")):
        if b.modification or RE_CHEMIN_RESERVE.search(b.chemin):
            continue
        fichiers[b.chemin] = Fichier(b.chemin, b.contenu, b.langue)
    return list(fichiers.values())


_RE_CHERCHER = re.compile(r"^<{4,}\s*(?:CHERCHER|SEARCH|ANCIEN|OLD)?\s*$", re.I)  # libellé facultatif
_RE_SEPARATEUR = re.compile(r"^={4,}\s*$")
_RE_REMPLACER = re.compile(r"^>{4,}\s*(?:REMPLACER|REPLACE|NOUVEAU|NEW)?\s*$", re.I)


def lire_paires(corps: str) -> list[tuple[str, str]]:
    paires: list[tuple[str, str]] = []
    etat = "hors"
    chercher: list[str] = []
    remplacer: list[str] = []
    for ligne in corps.split("\n"):
        if etat == "hors":
            if _RE_CHERCHER.match(ligne):
                etat, chercher, remplacer = "chercher", [], []
        elif etat == "chercher":
            if _RE_SEPARATEUR.match(ligne):
                etat = "remplacer"
            else:
                chercher.append(ligne)
        elif _RE_REMPLACER.match(ligne):
            paires.append(("\n".join(chercher), "\n".join(remplacer)))
            etat = "hors"
        else:
            remplacer.append(ligne)
    return paires


def extraire_modifications(markdown: str) -> list[Modification]:
    out: list[Modification] = []
    for b in _analyser_blocs(markdown.split("\n")):
        if b.modification and not RE_CHEMIN_RESERVE.search(b.chemin):
            out.append(Modification(b.chemin, lire_paires(b.contenu)))
    return out


def suppressions_demandees(markdown: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(r"^\s*(?:[-*]\s*)?Supprimer\s*:\s*`?([^\s`]+)`?\s*$", markdown, re.I | re.M):
        c = nettoyer_chemin(m.group(1))
        if c and not RE_CHEMIN_RESERVE.search(c):
            out.append(c)
    return out


def appliquer_remplacement(contenu: str, chercher: str, remplacer: str) -> str | None:
    """Remplace la première occurrence de `chercher`. Tolère espaces de fin et indentation ; None si absent."""
    cible = chercher.rstrip("\n")
    if not cible.strip():
        return None
    remplacement = remplacer.rstrip("\n")
    idx = contenu.find(cible)
    if idx >= 0:
        return contenu[:idx] + remplacement + contenu[idx + len(cible):]
    lignes = contenu.split("\n")
    voulues = cible.split("\n")
    for norm, reindenter in ((str.rstrip, False), (str.strip, True)):
        v = [norm(x) for x in voulues]
        for i in range(0, len(lignes) - len(v) + 1):
            if all(norm(lignes[i + k]) == v[k] for k in range(len(v))):
                nouvelles = remplacement.split("\n")
                if reindenter:
                    indent_fichier = re.match(r"^\s*", lignes[i]).group(0)  # type: ignore[union-attr]
                    indent_bloc = re.match(r"^\s*", voulues[0]).group(0)  # type: ignore[union-attr]
                    nouvelles = [indent_fichier + l[len(indent_bloc):] if l.startswith(indent_bloc) else l for l in nouvelles]
                return "\n".join(lignes[:i] + nouvelles + lignes[i + len(v):])
    return None


def masquer_blocs(markdown: str, chemins: set[str]) -> str:
    """Remplace dans une réponse passée les blocs des fichiers connus par un renvoi (évite de les renvoyer deux fois)."""
    lignes = markdown.split("\n")
    blocs = _analyser_blocs(lignes)
    if not blocs:
        return markdown
    sortie: list[str] = []
    i = 0
    for b in blocs:
        if b.chemin not in chemins:
            continue
        renvoi = f"[modification de `{b.chemin}` : appliquée]" if b.modification else f"[fichier `{b.chemin}` : voir l'état du projet]"
        sortie.extend(lignes[i:b.debut])
        sortie.append(renvoi)
        i = b.fin + 1
    sortie.extend(lignes[i:])
    return "\n".join(sortie)
