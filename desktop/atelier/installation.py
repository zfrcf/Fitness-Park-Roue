"""Installation de la chaîne de compilation, sans droits administrateur :
  - JDK Temurin 25 (api.adoptium.net), somme SHA-256 vérifiée ;
  - Gradle 9.7.1 (services.gradle.org), somme SHA-256 vérifiée.
Tout va dans ~/.local/share/atelier (jdk → jdk-25.x, gradle → gradle-9.7.1), rien dans le système.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import httpx

from .config import GRADLE_VERSION, JDK_VERSION, charger_fournisseurs, dossier_donnees, dossier_gradle, dossier_jdk, fichier_config

Progression = Callable[[str, int, int], None]  # (libellé, octets reçus, total)


class ErreurInstallation(Exception):
    pass


def architecture() -> str:
    m = platform.machine().lower()
    if m in ("x86_64", "amd64"):
        return "x64"
    if m in ("aarch64", "arm64"):
        return "aarch64"
    raise ErreurInstallation(f"Architecture non prise en charge : {m}")


def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(60.0, connect=20.0), follow_redirects=True, headers={"user-agent": "atelier-ia-local"})


def telecharger(url: str, destination: Path, sha256: str | None, progression: Progression | None = None, libelle: str = "") -> None:
    h = hashlib.sha256()
    with _client() as c, c.stream("GET", url) as r:
        if r.status_code != 200:
            raise ErreurInstallation(f"Téléchargement impossible ({r.status_code}) : {url}")
        total = int(r.headers.get("content-length") or 0)
        recu = 0
        with destination.open("wb") as f:
            for morceau in r.iter_bytes(1 << 20):
                f.write(morceau)
                h.update(morceau)
                recu += len(morceau)
                if progression:
                    progression(libelle, recu, total)
    if sha256 and h.hexdigest().lower() != sha256.strip().lower():
        destination.unlink(missing_ok=True)
        raise ErreurInstallation(f"Somme de contrôle invalide pour {url} : téléchargement corrompu, réessayez.")


def _lien(cible: Path, lien: Path) -> None:
    """Remplace `lien` (lien symbolique stable : jdk, gradle) pour pointer vers `cible`."""
    if lien.is_symlink() or lien.is_file():
        lien.unlink()
    elif lien.is_dir():
        shutil.rmtree(lien)
    lien.symlink_to(cible.name, target_is_directory=True)


def _version_java(java_home: Path) -> str | None:
    try:
        r = subprocess.run([str(java_home / "bin" / "java"), "-version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r'version "([^"]+)"', r.stderr + r.stdout)
    return m.group(1) if m else None


def _version_gradle(gradle: Path, java_home: Path | None) -> str | None:
    env = dict(os.environ)
    if java_home:
        env["JAVA_HOME"] = str(java_home)
    try:
        r = subprocess.run([str(gradle), "--version", "--quiet"], capture_output=True, text=True, timeout=180, env=env)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"Gradle (\S+)", r.stdout + r.stderr)
    return m.group(1) if m else None


def installer_jdk(progression: Progression | None = None, forcer: bool = False) -> Path:
    base = dossier_donnees()
    base.mkdir(parents=True, exist_ok=True)
    actuel = dossier_jdk()
    if not forcer and (actuel / "bin" / "java").exists():
        v = _version_java(actuel)
        if v and v.split(".")[0] == str(JDK_VERSION):
            return actuel
    arch = architecture()
    with _client() as c:
        r = c.get(
            f"https://api.adoptium.net/v3/assets/latest/{JDK_VERSION}/hotspot",
            params={"architecture": arch, "image_type": "jdk", "os": "linux", "vendor": "eclipse"},
        )
    if r.status_code != 200 or not r.json():
        raise ErreurInstallation(f"API Adoptium indisponible ({r.status_code}).")
    asset = r.json()[0]
    paquet = asset["binary"]["package"]
    nom_version = asset.get("release_name") or f"jdk-{JDK_VERSION}"
    with tempfile.TemporaryDirectory(dir=base) as tmp:
        archive = Path(tmp) / paquet["name"]
        telecharger(paquet["link"], archive, paquet.get("checksum"), progression, f"JDK {nom_version}")
        with tarfile.open(archive) as t:
            if sys.version_info >= (3, 12):
                t.extractall(tmp, filter="data")
            else:
                for membre in t.getmembers():
                    if membre.name.startswith(("/", "..")) or ".." in Path(membre.name).parts:
                        raise ErreurInstallation(f"Archive JDK suspecte : {membre.name}")
                t.extractall(tmp)
        racines = [p for p in Path(tmp).iterdir() if p.is_dir() and (p / "bin" / "java").exists()]
        if not racines:
            raise ErreurInstallation("Archive JDK inattendue (pas de bin/java).")
        cible = base / nom_version
        if cible.exists():
            shutil.rmtree(cible)
        shutil.move(str(racines[0]), cible)
    _lien(cible, actuel)
    return actuel


def installer_gradle(progression: Progression | None = None, forcer: bool = False) -> Path:
    base = dossier_donnees()
    base.mkdir(parents=True, exist_ok=True)
    actuel = dossier_gradle()
    if not forcer and (actuel / "bin" / "gradle").exists() and (base / f"gradle-{GRADLE_VERSION}").exists():
        return actuel
    url = f"https://services.gradle.org/distributions/gradle-{GRADLE_VERSION}-bin.zip"
    with _client() as c:
        rs = c.get(url + ".sha256")
    somme = rs.text.strip() if rs.status_code == 200 else None
    if not somme:
        raise ErreurInstallation("Somme de contrôle Gradle introuvable : installation interrompue par prudence.")
    with tempfile.TemporaryDirectory(dir=base) as tmp:
        archive = Path(tmp) / f"gradle-{GRADLE_VERSION}-bin.zip"
        telecharger(url, archive, somme, progression, f"Gradle {GRADLE_VERSION}")
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                if info.filename.startswith(("/", "..")) or ".." in Path(info.filename).parts:
                    raise ErreurInstallation(f"Archive Gradle suspecte : {info.filename}")
                z.extract(info, tmp)
                mode = (info.external_attr >> 16) & 0o777
                if mode:  # zipfile ne restaure pas les droits d'exécution
                    os.chmod(Path(tmp) / info.filename, mode)
        source = Path(tmp) / f"gradle-{GRADLE_VERSION}"
        if not (source / "bin" / "gradle").exists():
            raise ErreurInstallation("Archive Gradle inattendue (pas de bin/gradle).")
        cible = base / f"gradle-{GRADLE_VERSION}"
        if cible.exists():
            shutil.rmtree(cible)
        shutil.move(str(source), cible)
    os.chmod(cible / "bin" / "gradle", 0o755)
    _lien(cible, actuel)
    return actuel


@dataclass
class Diagnostic:
    libelle: str
    ok: bool
    detail: str


def diagnostic() -> list[Diagnostic]:
    from .gradle import trouver_chaine

    out: list[Diagnostic] = []
    out.append(Diagnostic("Python", sys.version_info >= (3, 10), sys.version.split()[0]))
    chaine = trouver_chaine()
    vj = _version_java(chaine.java_home) if chaine.java_home else None
    out.append(
        Diagnostic(
            f"JDK {JDK_VERSION}",
            bool(vj and vj.split(".")[0] == str(JDK_VERSION)),
            f"{vj} ({chaine.java_home})" if vj else "absent : lancez « atelier installer »",
        )
    )
    vg = _version_gradle(chaine.gradle, chaine.java_home) if chaine.gradle else None
    out.append(Diagnostic(f"Gradle {GRADLE_VERSION}", vg == GRADLE_VERSION, f"{vg} ({chaine.gradle})" if vg else "absent : lancez « atelier installer »"))
    cfg = fichier_config()
    droits = oct(cfg.stat().st_mode & 0o777) if cfg.exists() else "-"
    out.append(Diagnostic("Fichier de configuration", cfg.exists() and droits == "0o600", f"{cfg} (droits {droits})" if cfg.exists() else f"{cfg} absent : lancez « atelier config »"))
    fournisseurs, problemes = charger_fournisseurs()
    out.append(
        Diagnostic(
            "Fournisseurs IA",
            bool(fournisseurs),
            ", ".join(f"{f.rang}. {f.nom} ({f.modele})" for f in fournisseurs) or "aucun : « atelier config »",
        )
    )
    for p in problemes:
        out.append(Diagnostic("Fournisseur ignoré", False, p))
    from . import ui

    node = ui.trouver_node()
    out.append(Diagnostic("Node (interface)", node is not None, str(node) if node else "absent : lancez « atelier ui »"))
    electron = ui.trouver_electron()
    out.append(Diagnostic("Application de bureau", electron is not None, f"Electron {ui.ELECTRON_VERSION} ({electron})" if electron else "absente : lancez « atelier ui »"))
    app = ui.trouver_app()
    out.append(Diagnostic("Interface graphique", app is not None, f"{app} (version {ui.version_app(app)})" if app else "absente : réinstallez depuis l'archive"))
    return out


# --------------------------------------------------------------------------- préréglages

PRESETS = {
    "nvidia": {"NAME": "NVIDIA", "BASE_URL": "https://integrate.api.nvidia.com/v1", "MODEL": "moonshotai/kimi-k3", "CONTEXT": "1048576", "aide": "Clé : build.nvidia.com → profil → API Keys (commence par nvapi-)"},
    "groq": {"NAME": "Groq", "BASE_URL": "https://api.groq.com/openai/v1", "MODEL": "qwen/qwen3.8-27b", "CONTEXT": "131072", "aide": "Clé : console.groq.com/keys (commence par gsk_)"},
    "openrouter": {"NAME": "OpenRouter", "BASE_URL": "https://openrouter.ai/api/v1", "MODEL": "qwen/qwen3.8-27b:free", "CONTEXT": "262144", "aide": "Clé : openrouter.ai/settings/keys (commence par sk-or-)"},
    "cloudflare": {"NAME": "Cloudflare", "BASE_URL": "https://api.cloudflare.com/client/v4/accounts/{compte}/ai/v1", "MODEL": "@cf/qwen/qwen3.8-27b", "CONTEXT": "262144", "aide": "Jeton : dash.cloudflare.com → Profil → Jetons d'API (Workers AI) ; identifiant de compte dans l'URL du tableau de bord"},
}
