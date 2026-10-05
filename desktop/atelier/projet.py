"""Un projet = un dossier sur le disque. Les fichiers produits par le modèle y sont écrits
directement ; l'historique de la conversation est gardé dans .atelier/conversation.json.

Le dossier fait foi : si vous modifiez un fichier à la main (IDE, éditeur), la version sur
le disque est celle envoyée au modèle au tour suivant.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .fichiers import (
    RE_CHEMIN_RESERVE,
    appliquer_remplacement,
    extraire_fichiers,
    extraire_modifications,
    nettoyer_chemin,
    suppressions_demandees,
)

# Dossiers jamais lus ni envoyés au modèle (sorties de compilation, caches, métadonnées).
DOSSIERS_IGNORES = {".atelier", ".git", ".gradle", ".idea", ".vscode", "build", "out", "bin", "run", "node_modules", "__pycache__", ".kotlin"}
TAILLE_MAX_FICHIER = 400_000  # au-delà, le fichier n'est pas envoyé au modèle


@dataclass
class Rapport:
    """Ce qu'une réponse a changé dans le projet."""

    ecrits: list[str] = field(default_factory=list)
    modifies: list[str] = field(default_factory=list)
    supprimes: list[str] = field(default_factory=list)
    echecs: list[str] = field(default_factory=list)

    @property
    def change(self) -> bool:
        return bool(self.ecrits or self.modifies or self.supprimes)


def estimer_tokens(texte: str) -> int:
    return -(-len(texte) // 3)  # arrondi supérieur, ~3 caractères par token (code)


class Projet:
    def __init__(self, dossier: Path):
        self.dossier = dossier.expanduser().resolve()
        self.meta = self.dossier / ".atelier"

    # ------------------------------------------------------------------ fichiers

    def creer(self) -> None:
        self.dossier.mkdir(parents=True, exist_ok=True)
        self.meta.mkdir(exist_ok=True)
        ignore = self.dossier / ".gitignore"
        if not ignore.exists():
            ignore.write_text(".atelier/\n.gradle/\nbuild/\nrun/\nout/\n*.class\n", encoding="utf-8")

    @property
    def nom(self) -> str:
        return self.dossier.name

    def chemin_sur(self, relatif: str) -> Path | None:
        """Chemin absolu d'un fichier du projet, ou None s'il sortirait du dossier."""
        propre = nettoyer_chemin(relatif)
        if not propre or RE_CHEMIN_RESERVE.search(propre):
            return None
        cible = (self.dossier / propre).resolve()
        try:
            cible.relative_to(self.dossier)
        except ValueError:
            return None  # lien symbolique ou chemin qui s'échappe du projet
        return cible

    def lister(self) -> list[str]:
        """Chemins relatifs des fichiers texte du projet (hors sorties de compilation et caches)."""
        out: list[str] = []
        for racine, dossiers, fichiers in os.walk(self.dossier):
            dossiers[:] = sorted(d for d in dossiers if d not in DOSSIERS_IGNORES and not d.startswith("."))
            for f in sorted(fichiers):
                p = Path(racine) / f
                rel = p.relative_to(self.dossier).as_posix()
                if RE_CHEMIN_RESERVE.search(rel) or rel == ".gitignore":
                    continue
                if p.is_symlink() or p.stat().st_size > TAILLE_MAX_FICHIER or not _est_texte(p):
                    continue
                out.append(rel)
        return out

    def lire(self, relatif: str) -> str | None:
        p = self.chemin_sur(relatif)
        if not p or not p.is_file():
            return None
        try:
            return p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return None

    def ecrire(self, relatif: str, contenu: str) -> bool:
        p = self.chemin_sur(relatif)
        if not p:
            return False
        p.parent.mkdir(parents=True, exist_ok=True)
        # Droits : ceux du fichier existant (un script exécutable le reste), sinon 644 selon l'umask.
        mode = (p.stat().st_mode & 0o777) if p.exists() else (0o666 & ~_umask())
        # Écriture atomique : jamais de fichier à moitié écrit si le programme est interrompu.
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".atelier-", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(contenu)
        os.chmod(tmp, mode)  # mkstemp crée en 600
        os.replace(tmp, p)
        return True

    def supprimer(self, relatif: str) -> bool:
        p = self.chemin_sur(relatif)
        if not p or not p.is_file():
            return False
        p.unlink()
        return True

    def est_gradle(self) -> bool:
        return any((self.dossier / n).is_file() for n in ("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"))

    def empreinte(self) -> str:
        h = hashlib.sha256()
        for rel in self.lister():
            h.update(rel.encode() + b"\0" + (self.lire(rel) or "").encode() + b"\0")
        return h.hexdigest()

    # ------------------------------------------------------------------ réponses du modèle

    def appliquer_reponse(self, texte: str) -> Rapport:
        """Applique au dossier : suppressions, fichiers entiers, puis modifications partielles."""
        r = Rapport()
        for chemin in suppressions_demandees(texte):
            if self.supprimer(chemin):
                r.supprimes.append(chemin)
        for f in extraire_fichiers(texte):
            if self.ecrire(f.chemin, f.contenu):
                r.ecrits.append(f.chemin)
            else:
                r.echecs.append(f"{f.chemin} : chemin refusé")
        for modif in extraire_modifications(texte):
            actuel = self.lire(modif.chemin)
            if actuel is None:
                r.echecs.append(f"{modif.chemin} : fichier inconnu dans le projet")
                continue
            if not modif.remplacements:
                r.echecs.append(f"{modif.chemin} : bloc mal formé (aucune paire CHERCHER / REMPLACER)")
                continue
            contenu: str | None = actuel
            for chercher, remplacer in modif.remplacements:
                nouveau = appliquer_remplacement(contenu, chercher, remplacer)  # type: ignore[arg-type]
                if nouveau is None:
                    extrait = " ".join(chercher.split())[:60]
                    r.echecs.append(f"{modif.chemin} : texte à remplacer introuvable : « {extrait} »")
                    contenu = None
                    break
                contenu = nouveau
            if contenu is not None and contenu != actuel:
                self.ecrire(modif.chemin, contenu)
                if modif.chemin not in r.ecrits and modif.chemin not in r.modifies:
                    r.modifies.append(modif.chemin)
        return r

    # ------------------------------------------------------------------ contexte pour le modèle

    def bloc_etat(self, budget_tokens: int) -> str:
        """État du projet pour le prompt système : contenu des fichiers récents dans la limite du budget."""
        chemins = self.lister()
        if not chemins:
            return ""
        par_recence = sorted(chemins, key=lambda c: (self.dossier / c).stat().st_mtime, reverse=True)
        complets: set[str] = set()
        total = 0
        for c in par_recence:
            t = estimer_tokens(self.lire(c) or "") + 20
            if total + t > budget_tokens:
                continue
            total += t
            complets.add(c)
        lignes = [f'<etat_du_projet dossier="{self.nom}" fichiers="{len(chemins)}">']
        for c in chemins:
            contenu = self.lire(c) or ""
            if c in complets:
                cloture = "````" if "```" in contenu else "```"
                langue = _langue(c)
                lignes.append(f"{cloture}{langue} {c}\n{contenu.rstrip(chr(10))}\n{cloture}")
            else:
                lignes.append(f"- {c} ({len(contenu)} caractères, contenu omis faute de place : demande-le si tu dois le modifier)")
        lignes.append("</etat_du_projet>")
        return "\n".join(lignes)

    # ------------------------------------------------------------------ historique

    @property
    def fichier_historique(self) -> Path:
        return self.meta / "conversation.json"

    def charger_historique(self) -> list[dict]:
        try:
            data = json.loads(self.fichier_historique.read_text(encoding="utf-8"))
            return [m for m in data.get("messages", []) if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
        except (OSError, ValueError):
            return []

    def enregistrer_historique(self, messages: list[dict]) -> None:
        self.meta.mkdir(parents=True, exist_ok=True)
        tmp = self.fichier_historique.with_suffix(".tmp")
        tmp.write_text(json.dumps({"messages": messages}, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.fichier_historique)

    def lire_etat(self) -> dict:
        try:
            return json.loads((self.meta / "etat.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def ecrire_etat(self, etat: dict) -> None:
        self.meta.mkdir(parents=True, exist_ok=True)
        (self.meta / "etat.json").write_text(json.dumps(etat, ensure_ascii=False, indent=1), encoding="utf-8")


_LANGUES = {".java": "java", ".kt": "kotlin", ".gradle": "groovy", ".kts": "kotlin", ".json": "json", ".properties": "properties", ".toml": "toml", ".md": "markdown", ".py": "python", ".xml": "xml", ".yml": "yaml", ".yaml": "yaml", ".mcmeta": "json"}


def _langue(chemin: str) -> str:
    return _LANGUES.get(Path(chemin).suffix.lower(), "")


def _umask() -> int:
    u = os.umask(0)
    os.umask(u)
    return u


def _est_texte(p: Path) -> bool:
    try:
        with p.open("rb") as f:
            debut = f.read(4096)
        if b"\0" in debut:
            return False
        debut.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False
    except OSError:
        return False
