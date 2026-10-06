#!/usr/bin/env python3
"""Installation de l'atelier IA local SANS droits administrateur (pas de sudo, pas d'apt).

    python3 installer.py                      installation complète
    python3 installer.py --importer FICHIER   importe aussi les clés PROVIDER_n_* d'un .env

Seul prérequis : python3 ≥ 3.10 (présent d'office sur Ubuntu 22.04 et plus récent).
Tout est installé dans votre dossier personnel :
    ~/.local/share/atelier/   environnement Python, JDK Temurin 25, Gradle 9.7.1
    ~/.local/bin/atelier      la commande « atelier »

L'environnement Python est créé par la première méthode qui fonctionne :
  1. python3 -m venv                        (si le paquet python3-venv est présent)
  2. python3 -m venv --without-pip + get-pip.py   (Ubuntu sans python3-venv : cas courant sans sudo)
  3. pip.pyz --target lib/ + lanceur             (si même le module venv manque)
Ce script n'utilise que la bibliothèque standard de Python.
"""

from __future__ import annotations

import argparse
import os
import shutil
import ssl
import stat
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
GET_PIP = "https://bootstrap.pypa.io/get-pip.py"
PIP_PYZ = "https://bootstrap.pypa.io/pip/pip.pyz"


def bleu(m: str) -> None:
    print(f"\033[1;34m▶ {m}\033[0m", flush=True)


def vert(m: str) -> None:
    print(f"\033[1;32m✔ {m}\033[0m", flush=True)


def jaune(m: str) -> None:
    print(f"\033[1;33m! {m}\033[0m", flush=True)


def rouge(m: str) -> None:
    print(f"\033[1;31m✘ {m}\033[0m", file=sys.stderr, flush=True)


def dossiers() -> tuple[Path, Path]:
    if os.environ.get("ATELIER_HOME"):
        donnees = Path(os.environ["ATELIER_HOME"]) / "donnees"
    else:
        donnees = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "atelier"
    binaire = Path(os.environ.get("ATELIER_BIN") or Path.home() / ".local" / "bin")
    return donnees, binaire


def telecharger(url: str, destination: Path) -> None:
    contexte = ssl.create_default_context()
    requete = urllib.request.Request(url, headers={"User-Agent": "atelier-installateur"})
    with urllib.request.urlopen(requete, timeout=120, context=contexte) as r, destination.open("wb") as f:
        shutil.copyfileobj(r, f)


def lancer(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, **kw)


def creer_venv(venv: Path, forcer_mode: str | None) -> bool:
    """Méthodes 1 puis 2. Renvoie True si un venv avec pip est prêt."""
    if (venv / "bin" / "python").exists() and lancer([str(venv / "bin" / "python"), "-m", "pip", "--version"], capture_output=True).returncode == 0:
        return True
    shutil.rmtree(venv, ignore_errors=True)
    if forcer_mode not in ("sans-ensurepip", "cible"):
        r = lancer([sys.executable, "-m", "venv", str(venv)], capture_output=True, text=True)
        if r.returncode == 0:
            vert("Environnement Python créé (venv)")
            return True
        shutil.rmtree(venv, ignore_errors=True)
        jaune("python3-venv absent (ensurepip indisponible) : création sans pip puis installation de pip, sans sudo")
    if forcer_mode == "cible":
        return False
    r = lancer([sys.executable, "-m", "venv", "--without-pip", str(venv)], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.rmtree(venv, ignore_errors=True)
        jaune("module venv indisponible : installation dans un dossier de bibliothèques")
        return False
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "get-pip.py"
        bleu(f"Téléchargement de pip ({GET_PIP})")
        telecharger(GET_PIP, script)
        r = lancer([str(venv / "bin" / "python"), str(script), "--quiet", "--no-warn-script-location"])
    if r.returncode != 0:
        rouge("get-pip.py a échoué")
        shutil.rmtree(venv, ignore_errors=True)
        return False
    vert("Environnement Python créé (venv sans ensurepip + get-pip)")
    return True


def installer_paquet_venv(venv: Path, binaire: Path) -> Path:
    py = str(venv / "bin" / "python")
    lancer([py, "-m", "pip", "install", "--quiet", "--upgrade", "pip"], check=False)
    r = lancer([py, "-m", "pip", "install", "--quiet", "--upgrade", str(ICI)])
    if r.returncode != 0:
        raise SystemExit("Installation des dépendances Python impossible (pip). Vérifiez l'accès à internet (pypi.org).")
    lanceur = binaire / "atelier"
    binaire.mkdir(parents=True, exist_ok=True)
    if lanceur.exists() or lanceur.is_symlink():
        lanceur.unlink()
    lanceur.symlink_to(venv / "bin" / "atelier")
    return lanceur


def installer_paquet_cible(donnees: Path, binaire: Path) -> Path:
    """Méthode 3 : pip.pyz installe l'atelier et ses dépendances dans donnees/lib, lancé par python3 -m atelier."""
    lib = donnees / "lib"
    shutil.rmtree(lib, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        pyz = Path(tmp) / "pip.pyz"
        bleu(f"Téléchargement de pip autonome ({PIP_PYZ})")
        telecharger(PIP_PYZ, pyz)
        r = lancer([sys.executable, str(pyz), "install", "--quiet", "--target", str(lib), str(ICI)])
    if r.returncode != 0:
        raise SystemExit("Installation des dépendances Python impossible (pip.pyz). Vérifiez l'accès à internet (pypi.org).")
    binaire.mkdir(parents=True, exist_ok=True)
    lanceur = binaire / "atelier"
    if lanceur.exists() or lanceur.is_symlink():
        lanceur.unlink()
    lanceur.write_text(
        "#!/bin/sh\n# Lanceur de l'atelier IA local (installation sans venv)\n"
        f'PYTHONPATH="{lib}${{PYTHONPATH:+:$PYTHONPATH}}" exec "{sys.executable}" -m atelier "$@"\n',
        encoding="utf-8",
    )
    lanceur.chmod(lanceur.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    vert("Atelier installé dans un dossier de bibliothèques (sans venv)")
    return lanceur


def ajouter_au_path(binaire: Path) -> None:
    if str(binaire) in os.environ.get("PATH", "").split(os.pathsep):
        return
    bashrc = Path.home() / ".bashrc"
    marque = "# atelier : ~/.local/bin dans le PATH"
    try:
        actuel = bashrc.read_text(encoding="utf-8") if bashrc.exists() else ""
    except OSError:
        actuel = ""
    if marque not in actuel and binaire == Path.home() / ".local" / "bin":
        with bashrc.open("a", encoding="utf-8") as f:
            f.write(f'\n{marque}\nexport PATH="$HOME/.local/bin:$PATH"\n')
    print(f'Ouvrez un nouveau terminal (ou lancez : export PATH="{binaire}:$PATH") pour utiliser « atelier ».')


def installer_interface(donnees: Path, lanceur: Path) -> bool:
    """Application de bureau : copie l'application (web/), installe Node, Electron et l'entrée de menu."""
    source = ICI / "web"
    if not (source / "server.js").is_file():
        jaune("Interface graphique absente de cette archive : seule la console est installée.")
        return False
    bleu("Application de bureau Atelier IA (Node LTS + Electron, sans sudo)")
    lancer([str(lanceur), "ui", "--arreter"], check=False, capture_output=True)
    cible = donnees / "web"
    tmp = donnees / "web.nouveau"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(source, tmp, symlinks=True)
    shutil.rmtree(cible, ignore_errors=True)
    tmp.rename(cible)
    if lancer([str(lanceur), "ui", "--preparer"]).returncode != 0:
        rouge("Préparation de l'interface incomplète (voir ci-dessus). Relancez : atelier ui")
        return False
    return True


def main() -> int:
    p = argparse.ArgumentParser(description="Installe l'atelier IA local sans droits administrateur.")
    p.add_argument("--importer", metavar="FICHIER_ENV", help="importer les PROVIDER_n_* d'un .env (ex. .env.local de la version web)")
    p.add_argument("--sans-jdk", action="store_true", help="ne pas télécharger JDK et Gradle maintenant (« atelier installer » plus tard)")
    p.add_argument("--sans-ui", action="store_true", help="ne pas installer l'application de bureau (Node, Electron, interface)")
    # Option de test : force une méthode de repli (sans-ensurepip, cible).
    p.add_argument("--mode", choices=["sans-ensurepip", "cible"], help=argparse.SUPPRESS)
    a = p.parse_args()

    if sys.version_info < (3, 10):
        rouge(f"Python {sys.version.split()[0]} trop ancien : 3.10 ou plus récent est requis (Ubuntu 22.04+).")
        return 1
    if os.geteuid() == 0 and not os.environ.get("ATELIER_HOME"):
        jaune("Vous êtes root : l'atelier s'installera dans le dossier de root. Lancez plutôt ce script avec votre compte.")

    donnees, binaire = dossiers()
    donnees.mkdir(parents=True, exist_ok=True)
    bleu(f"Installation dans {donnees} (aucun droit administrateur nécessaire)")

    venv = donnees / "venv"
    if creer_venv(venv, a.mode):
        lanceur = installer_paquet_venv(venv, binaire)
    else:
        shutil.rmtree(venv, ignore_errors=True)
        lanceur = installer_paquet_cible(donnees, binaire)
    version = lancer([str(lanceur), "--version"], capture_output=True, text=True).stdout.strip()
    if not version:
        rouge("La commande atelier ne démarre pas.")
        return 1
    vert(f"{version} : commande {lanceur}")

    # Interface d'abord : le diagnostic affiché à la fin de « atelier installer » la voit alors installée.
    ui_ok = False
    if not a.sans_ui:
        ui_ok = installer_interface(donnees, lanceur)

    if not a.sans_jdk:
        bleu("JDK 25 et Gradle 9.7.1 (téléchargés dans votre dossier personnel, sommes SHA-256 vérifiées)")
        if lancer([str(lanceur), "installer"]).returncode != 0:
            rouge("Installation de JDK/Gradle incomplète (voir ci-dessus). Relancez : atelier installer")
            return 1
    if a.importer:
        lancer([str(lanceur), "config", "--importer", a.importer], check=False)
    else:
        # Fichier de clés livré à côté de l'archive (ou dans Téléchargements) : importé d'office.
        maison = Path.home()
        for f in (ICI / "atelier-cles.env", ICI.parent / "atelier-cles.env", maison / "Téléchargements" / "atelier-cles.env", maison / "Downloads" / "atelier-cles.env"):
            if f.is_file():
                bleu(f"Clés API trouvées : {f}")
                lancer([str(lanceur), "config", "--importer", str(f)], check=False)
                break


    ajouter_au_path(binaire)
    print()
    vert("Installation terminée.")
    print("  1. Configurer une clé API :   atelier config")
    print("  2. Vérifier :                 atelier doctor   puis   atelier tester")
    if ui_ok:
        print("  3. Ouvrir l'application :     « Atelier IA » dans le menu des applications (ou : atelier ui)")
        print("     En console :               atelier nouveau mon-mod")
    else:
        print("  3. Créer un projet :          atelier nouveau mon-mod")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
