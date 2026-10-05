"""Compilation locale : `gradle build` dans le dossier du projet.

Le JDK et Gradle installés par `atelier installer` (dans ~/.local/share/atelier) sont utilisés
en priorité ; à défaut, ceux du système (JAVA_HOME, gradle dans le PATH).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .config import dossier_gradle, dossier_jdk


@dataclass
class Chaine:
    java_home: Path | None
    gradle: Path | None

    @property
    def complete(self) -> bool:
        return self.gradle is not None and (self.java_home is not None or shutil.which("java") is not None)


@dataclass
class ResultatCompilation:
    ok: bool
    code: int
    duree: float
    journal: str
    resume: str
    jars: list[Path] = field(default_factory=list)


def trouver_chaine() -> Chaine:
    java_home: Path | None = None
    jdk = dossier_jdk()
    if (jdk / "bin" / "java").exists():
        java_home = jdk
    elif os.environ.get("JAVA_HOME") and (Path(os.environ["JAVA_HOME"]) / "bin" / "java").exists():
        java_home = Path(os.environ["JAVA_HOME"])
    gradle: Path | None = None
    g = dossier_gradle() / "bin" / "gradle"
    if g.exists():
        gradle = g
    elif shutil.which("gradle"):
        gradle = Path(shutil.which("gradle"))  # type: ignore[arg-type]
    return Chaine(java_home, gradle)


def environnement(chaine: Chaine) -> dict[str, str]:
    env = dict(os.environ)
    if chaine.java_home:
        env["JAVA_HOME"] = str(chaine.java_home)
        env["PATH"] = f"{chaine.java_home / 'bin'}{os.pathsep}{env.get('PATH', '')}"
    if chaine.gradle:
        env["PATH"] = f"{chaine.gradle.parent}{os.pathsep}{env['PATH']}"
    return env


def compiler(
    dossier: Path,
    taches: list[str] | None = None,
    sortie: Callable[[str], None] | None = None,
    delai_max: float = 30 * 60,
    daemon: bool = True,
) -> ResultatCompilation:
    """Lance `gradle build` (ou les tâches données) et renvoie le résultat, le journal et les jars produits."""
    chaine = trouver_chaine()
    if chaine.gradle is None:
        msg = "Gradle introuvable : lancez « atelier installer »."
        return ResultatCompilation(False, -1, 0.0, msg, msg)
    cmd = [str(chaine.gradle), *(taches or ["build"]), "--console=plain", "--warning-mode=summary"]
    if not daemon:
        cmd.append("--no-daemon")
    debut = time.monotonic()
    lignes: list[str] = []
    journal_fichier = dossier / ".atelier" / "derniere-compilation.log"
    journal_fichier.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=dossier,
            env=environnement(chaine),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except OSError as e:
        msg = f"Impossible de lancer Gradle : {e}"
        return ResultatCompilation(False, -1, 0.0, msg, msg)
    try:
        assert proc.stdout is not None
        for ligne in proc.stdout:
            lignes.append(ligne.rstrip("\n"))
            if sortie:
                sortie(ligne.rstrip("\n"))
            if time.monotonic() - debut > delai_max:
                proc.kill()
                lignes.append(f"[atelier] compilation arrêtée après {int(delai_max // 60)} min")
                break
        code = proc.wait()
    except KeyboardInterrupt:
        proc.kill()
        proc.wait()
        lignes.append("[atelier] compilation interrompue (Ctrl+C)")
        code = 130
    duree = time.monotonic() - debut
    journal = "\n".join(lignes)
    journal_fichier.write_text(journal + "\n", encoding="utf-8")
    ok = code == 0
    jars = trouver_jars(dossier) if ok else []
    resume = "\n".join(lignes[-15:]) if ok else resumer_journal(journal)
    return ResultatCompilation(ok, code, duree, journal, resume, jars)


def trouver_jars(dossier: Path) -> list[Path]:
    """Jars produits (build/libs du projet et des sous-projets), hors -sources/-dev/-javadoc."""
    jars: list[Path] = []
    for libs in [dossier / "build" / "libs", *dossier.glob("*/build/libs")]:
        if libs.is_dir():
            jars += [j for j in sorted(libs.glob("*.jar")) if not re.search(r"-(sources|dev|javadoc|plain)\.jar$", j.name)]
    return jars


_RE_UTILE = re.compile(
    r"error:|FAILED|What went wrong|Could not |Exception|BUILD FAILED|Unresolved|cannot find symbol|incompatible types|"
    r"does not exist|is not abstract|> Task .* FAILED|Caused by|e: file:|warning: \[removal\]",
    re.I,
)


def resumer_journal(journal: str, max_car: int = 6000) -> str:
    """Garde les erreurs utiles (et leur contexte) d'un journal Gradle, pour l'humain comme pour le modèle."""
    lignes = journal.split("\n")
    retenues: list[str] = []
    vues: set[str] = set()
    for i, ligne in enumerate(lignes):
        if _RE_UTILE.search(ligne):
            for k in range(max(0, i - 1), min(len(lignes), i + 4)):
                l = re.sub(r"\x1b\[[0-9;]*m", "", lignes[k]).rstrip()
                if l and l not in vues:
                    vues.add(l)
                    retenues.append(l)
    texte = "\n".join(retenues) if retenues else "\n".join(lignes[-60:])
    if len(texte) > max_car:
        texte = texte[:max_car] + "\n[… journal tronqué …]"
    return texte


def arreter_daemons() -> None:
    chaine = trouver_chaine()
    if chaine.gradle:
        subprocess.run([str(chaine.gradle), "--stop"], env=environnement(chaine), capture_output=True, check=False)
