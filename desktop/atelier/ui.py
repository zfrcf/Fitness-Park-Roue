"""Interface graphique locale : la même application que la version web, sur l'ordinateur.

  atelier ui                 démarre (si besoin) le serveur local et ouvre la fenêtre
  atelier ui --arreter       arrête le serveur
  atelier ui --redemarrer    redémarre le serveur (après « atelier config » par exemple)
  atelier ui --preparer      installe Node et l'entrée de menu, sans rien ouvrir
  atelier ui --reconstruire  reconstruit l'application depuis les sources (développement)

Fonctionnement :
  - l'application (construction autonome de Next.js, mode ATELIER_LOCAL) est installée dans
    ~/.local/share/atelier/web ; elle n'a besoin que de Node (téléchargé sans sudo si absent) ;
  - le serveur écoute UNIQUEMENT sur 127.0.0.1 (pas de mot de passe, rien n'est exposé au réseau) ;
  - conversations, réglages et tâches : base locale dans ~/.local/share/atelier/ui/pglite ;
  - les compilations lancent `gradle build` avec le JDK et Gradle de l'atelier.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import charger_valeurs, dossier_config, dossier_donnees, fichier_config
from .installation import ErreurInstallation, Progression, _client, architecture, telecharger

PORT_DEFAUT = 3210
NODE_MIN = (20, 9)  # exigé par Next.js 16
ICI = Path(__file__).resolve().parent


# --------------------------------------------------------------------------- chemins


def dossier_ui() -> Path:
    return dossier_donnees() / "ui"


def dossier_app() -> Path:
    return dossier_donnees() / "web"


def dossier_node() -> Path:
    return dossier_donnees() / "node"


def fichier_etat() -> Path:
    return dossier_ui() / "serveur.json"


def fichier_journal() -> Path:
    return dossier_ui() / "ui.log"


def trouver_app() -> Path | None:
    """Application installée (~/.local/share/atelier/web), sinon celle livrée à côté du paquet."""
    for d in (dossier_app(), ICI.parent / "web"):
        if (d / "server.js").is_file():
            return d
    return None


def version_app(app: Path) -> str:
    v = app / "VERSION"
    return v.read_text(encoding="utf-8").strip() if v.exists() else "?"


# --------------------------------------------------------------------------- Node


def _version_node(node: Path | str) -> tuple[int, ...] | None:
    try:
        r = subprocess.run([str(node), "--version"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.match(r"v(\d+)\.(\d+)\.(\d+)", r.stdout.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def trouver_node() -> Path | None:
    """Node de l'atelier en priorité, sinon celui du système s'il est assez récent."""
    propre = dossier_node() / "bin" / "node"
    candidats = [propre] if propre.exists() else []
    systeme = shutil.which("node")
    if systeme:
        candidats.append(Path(systeme))
    for c in candidats:
        v = _version_node(c)
        if v and v[:2] >= NODE_MIN:
            return c
    return None


def installer_node(progression: Progression | None = None, forcer: bool = False) -> Path:
    """Télécharge la dernière version LTS de Node (nodejs.org), somme SHA-256 vérifiée, sans sudo."""
    if not forcer:
        propre = dossier_node() / "bin" / "node"
        v = _version_node(propre) if propre.exists() else None
        if v and v[:2] >= NODE_MIN:
            return propre
    arch = {"x64": "x64", "aarch64": "arm64"}[architecture()]
    with _client() as c:
        r = c.get("https://nodejs.org/dist/index.json")
        if r.status_code != 200:
            raise ErreurInstallation(f"nodejs.org indisponible ({r.status_code}).")
        lts = next((v for v in r.json() if v.get("lts") and f"linux-{arch}" in v.get("files", [])), None)
        if not lts:
            raise ErreurInstallation("Aucune version LTS de Node trouvée.")
        version = lts["version"]
        try:
            import lzma  # noqa: F401  (absent de certains Python compilés à la main)

            ext = "tar.xz"
        except ImportError:
            ext = "tar.gz"
        nom = f"node-{version}-linux-{arch}.{ext}"
        sommes = c.get(f"https://nodejs.org/dist/{version}/SHASUMS256.txt")
    somme = next((ligne.split()[0] for ligne in sommes.text.splitlines() if ligne.strip().endswith(nom)), None)
    if sommes.status_code != 200 or not somme:
        raise ErreurInstallation("Somme de contrôle de Node introuvable : installation interrompue par prudence.")
    base = dossier_donnees()
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=base) as tmp:
        archive = Path(tmp) / nom
        telecharger(f"https://nodejs.org/dist/{version}/{nom}", archive, somme, progression, f"Node {version}")
        with tarfile.open(archive) as t:
            for membre in t.getmembers():
                if membre.name.startswith("/") or ".." in Path(membre.name).parts:
                    raise ErreurInstallation(f"Archive Node suspecte : {membre.name}")
            if sys.version_info >= (3, 12):
                t.extractall(tmp, filter="data")
            else:
                t.extractall(tmp)
        source = Path(tmp) / nom.rsplit(".tar", 1)[0]
        if not (source / "bin" / "node").exists():
            raise ErreurInstallation("Archive Node inattendue (pas de bin/node).")
        cible = base / source.name
        if cible.exists():
            shutil.rmtree(cible)
        shutil.move(str(source), cible)
    lien = dossier_node()
    if lien.is_symlink() or lien.is_file():
        lien.unlink()
    elif lien.is_dir():
        shutil.rmtree(lien)
    lien.symlink_to(cible.name, target_is_directory=True)
    return lien / "bin" / "node"


# --------------------------------------------------------------------------- installation de l'application


def installer_app(source: Path) -> Path:
    """Copie l'application livrée (dossier web/ de l'archive) dans ~/.local/share/atelier/web."""
    if not (source / "server.js").is_file():
        raise ErreurInstallation(f"Application introuvable dans {source} (server.js absent).")
    cible = dossier_app()
    if source.resolve() == cible.resolve():
        return cible
    tmp = cible.with_name("web.nouveau")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(source, tmp, symlinks=True)
    shutil.rmtree(cible, ignore_errors=True)
    tmp.rename(cible)
    return cible


# Ce que la construction autonome de Next copie mais qui ne sert pas au serveur (et ne doit pas
# être distribué : sources, base de développement, configuration).
_GARDER = {"server.js", "package.json", "node_modules", ".next"}
_MODULES_INUTILES = {"@img", "sharp"}  # optimisation d'images, désactivée en mode local


def assembler_app(depot: Path, destination: Path) -> Path:
    """Assemble `destination` à partir de `depot/.next/standalone` (après `next build`)."""
    autonome = depot / ".next" / "standalone"
    if not (autonome / "server.js").is_file():
        raise ErreurInstallation("Construction autonome introuvable : lancez d'abord la construction.")
    shutil.rmtree(destination, ignore_errors=True)
    destination.mkdir(parents=True)
    for entree in autonome.iterdir():
        if entree.name not in _GARDER:
            continue
        if entree.name == "node_modules":
            shutil.copytree(entree, destination / entree.name, symlinks=True, ignore=lambda d, noms, racine=entree: [n for n in noms if Path(d) == racine and n in _MODULES_INUTILES])
        elif entree.name == ".next":
            shutil.copytree(entree, destination / entree.name, symlinks=True, ignore=shutil.ignore_patterns("cache"))
        else:
            shutil.copy2(entree, destination / entree.name)
    shutil.copytree(depot / ".next" / "static", destination / ".next" / "static")
    if (depot / "public").is_dir():
        shutil.copytree(depot / "public", destination / "public")
    try:
        commit = subprocess.run(["git", "-C", str(depot), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except OSError:
        commit = ""
    build_id = (autonome / ".next" / "BUILD_ID").read_text(encoding="utf-8").strip() if (autonome / ".next" / "BUILD_ID").exists() else ""
    version = "-".join(x for x in (commit or time.strftime("%Y%m%d%H%M"), build_id[:8]) if x)
    (destination / "VERSION").write_text(version + "\n", encoding="utf-8")
    verifier_sans_secret(destination, depot)
    return destination


def verifier_sans_secret(dossier: Path, depot: Path) -> None:
    """Refuse une application qui contiendrait une valeur secrète de .env.local (clés API…)."""
    secrets_connus = [
        v.encode()
        for f in (depot / ".env.local", depot / ".env")
        if f.exists()
        for k, v in _lire_env_simple(f).items()
        if len(v) >= 12 and re.search(r"KEY|TOKEN|SECRET|PASSWORD", k)
    ]
    if not secrets_connus:
        return
    for f in dossier.rglob("*"):
        if f.is_file() and not f.is_symlink() and f.stat().st_size < 50_000_000:
            contenu = f.read_bytes()
            if any(s in contenu for s in secrets_connus):
                raise ErreurInstallation(f"Une valeur secrète de .env.local se retrouve dans {f} : construction refusée.")


def _lire_env_simple(f: Path) -> dict[str, str]:
    from .config import lire_env

    return lire_env(f)


def construire_depuis_sources(depot: Path, node: Path) -> Path:
    """`npm ci` + `next build` (mode local) dans le dépôt, puis installation. Pour le développement."""
    if not (depot / "package.json").is_file():
        raise ErreurInstallation(f"Sources de l'application introuvables ({depot}).")
    env = _env_node(node)
    env.update({"NEXT_PUBLIC_ATELIER_LOCAL": "1", "ATELIER_LOCAL": "1", "NEXT_TELEMETRY_DISABLED": "1"})
    npm = node.parent / "npm"
    npm_cmd = [str(npm)] if npm.exists() else ["npm"]
    if not (depot / "node_modules" / "next").exists():
        subprocess.run([*npm_cmd, "ci", "--no-audit", "--no-fund"], cwd=depot, env=env, check=True)
    subprocess.run([str(node), str(depot / "node_modules" / "next" / "dist" / "bin" / "next"), "build"], cwd=depot, env=env, check=True)
    with tempfile.TemporaryDirectory(dir=dossier_donnees()) as tmp:
        assembler_app(depot, Path(tmp) / "web")
        return installer_app(Path(tmp) / "web")


def _env_node(node: Path) -> dict[str, str]:
    env = dict(os.environ)
    env["PATH"] = f"{node.parent}{os.pathsep}{env.get('PATH', '')}"
    return env


# --------------------------------------------------------------------------- serveur


@dataclass
class EtatServeur:
    pid: int
    port: int
    version: str
    empreinte_config: str

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


def lire_etat() -> EtatServeur | None:
    try:
        d = json.loads(fichier_etat().read_text(encoding="utf-8"))
        return EtatServeur(int(d["pid"]), int(d["port"]), str(d.get("version", "?")), str(d.get("empreinte_config", "")))
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _processus_vivant(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # Un zombie (enfant terminé non récolté) n'est pas vivant.
    try:
        etat = Path(f"/proc/{pid}/stat").read_text().split(")")[-1].split()[0]
        return etat != "Z"
    except OSError:
        return True


def repond(url: str, delai: float = 3.0) -> bool:
    try:
        r = httpx.get(url + "/connexion", timeout=delai, follow_redirects=False, trust_env=False)
        return r.status_code < 500
    except httpx.HTTPError:
        return False


def serveur_actif() -> EtatServeur | None:
    e = lire_etat()
    if e and _processus_vivant(e.pid) and repond(e.url):
        return e
    return None


def _port_libre(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def choisir_port(prefere: int) -> int:
    for p in range(prefere, prefere + 50):
        if _port_libre(p):
            return p
    raise ErreurInstallation(f"Aucun port libre entre {prefere} et {prefere + 49}.")


def empreinte_config() -> str:
    f = fichier_config()
    return hashlib.sha256(f.read_bytes()).hexdigest()[:16] if f.exists() else ""


def secret_session() -> str:
    """Secret aléatoire persistant (droits 600) : signe les jetons internes des tâches de fond."""
    f = dossier_config() / "ui-secret"
    if f.exists() and len(f.read_text().strip()) >= 32:
        return f.read_text().strip()
    f.parent.mkdir(parents=True, exist_ok=True)
    valeur = secrets.token_urlsafe(48)
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as h:
        h.write(valeur + "\n")
    return valeur


def environnement_serveur(port: int, node: Path) -> dict[str, str]:
    from .gradle import trouver_chaine

    env = _env_node(node)
    # Configuration de l'atelier (fournisseurs PROVIDER_n_*, réglages) : celle de « atelier config ».
    env.update(charger_valeurs())
    url = f"http://127.0.0.1:{port}"
    env.update(
        {
            "NODE_ENV": "production",
            "NEXT_TELEMETRY_DISABLED": "1",
            "ATELIER_LOCAL": "1",
            "PORT": str(port),
            # Ubuntu définit HOSTNAME (nom de la machine) : sans cette ligne, le serveur écouterait
            # sur toutes les interfaces réseau.
            "HOSTNAME": "127.0.0.1",
            "APP_URL": url,
            "TACHES_URL_INTERNE": url,
            "PGLITE_DIR": str(dossier_ui() / "pglite"),
            "ATELIER_COMPILATIONS_DIR": str(dossier_donnees() / "compilations"),
            "SESSION_SECRET": secret_session(),
        }
    )
    for cle in ("DATABASE_URL", "POSTGRES_URL", "VERCEL", "APP_PASSWORD"):
        env.pop(cle, None)
    chaine = trouver_chaine()
    if chaine.gradle:
        env["ATELIER_GRADLE"] = str(chaine.gradle)
    if chaine.java_home:
        env["ATELIER_JAVA_HOME"] = str(chaine.java_home)
    if (env.get("HTTPS_PROXY") or env.get("https_proxy")) and "NODE_USE_ENV_PROXY" not in env:
        env["NODE_USE_ENV_PROXY"] = "1"  # fetch de Node respecte alors le proxy du système
    return env


def demarrer(port: int = PORT_DEFAUT, attente: float = 120.0) -> EtatServeur:
    app = trouver_app()
    if not app:
        raise ErreurInstallation("Application graphique absente : relancez l'installation depuis l'archive (python3 installer.py).")
    node = trouver_node() or installer_node()
    port = choisir_port(port)
    dossier_ui().mkdir(parents=True, exist_ok=True)
    journal = fichier_journal()
    if journal.exists() and journal.stat().st_size > 5_000_000:
        journal.replace(journal.with_suffix(".log.1"))
    with journal.open("ab") as sortie:
        sortie.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} démarrage sur le port {port} ===\n".encode())
        proc = subprocess.Popen(
            [str(node), "server.js"],
            cwd=app,
            env=environnement_serveur(port, node),
            stdin=subprocess.DEVNULL,
            stdout=sortie,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # survit à la fermeture du terminal
        )
    etat = EtatServeur(proc.pid, port, version_app(app), empreinte_config())
    fichier_etat().write_text(json.dumps(etat.__dict__), encoding="utf-8")
    fin = time.monotonic() + attente
    while time.monotonic() < fin:
        if proc.poll() is not None:
            raise ErreurInstallation(f"Le serveur s'est arrêté au démarrage (code {proc.returncode}). Journal : {journal}\n" + _fin_journal())
        if repond(etat.url, 2.0):
            return etat
        time.sleep(0.5)
    raise ErreurInstallation(f"Le serveur ne répond pas après {int(attente)} s. Journal : {journal}\n" + _fin_journal())


def _fin_journal(n: int = 15) -> str:
    try:
        return "\n".join(fichier_journal().read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
    except OSError:
        return ""


def arreter(delai: float = 10.0) -> bool:
    """Arrête le serveur ; renvoie True s'il tournait."""
    e = lire_etat()
    if not e or not _processus_vivant(e.pid):
        fichier_etat().unlink(missing_ok=True)
        return False
    try:
        os.killpg(e.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(e.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    fin = time.monotonic() + delai
    while time.monotonic() < fin and _processus_vivant(e.pid):
        time.sleep(0.2)
    if _processus_vivant(e.pid):
        try:
            os.killpg(e.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    fichier_etat().unlink(missing_ok=True)
    return True


def assurer_serveur(port: int = PORT_DEFAUT) -> tuple[EtatServeur, str]:
    """Serveur prêt : réutilise celui qui tourne, le redémarre si l'application ou la config a changé."""
    e = serveur_actif()
    app = trouver_app()
    if e and app and e.version == version_app(app) and e.empreinte_config == empreinte_config():
        return e, "deja"
    if e:
        arreter()
        return demarrer(e.port if _port_libre(e.port) else port), "redemarre"
    return demarrer(port), "demarre"


# --------------------------------------------------------------------------- fenêtre et menu

NAVIGATEURS_APP = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "vivaldi"]


def ouvrir_fenetre(url: str) -> str:
    """Ouvre l'application dans une fenêtre dédiée (mode application de Chrome/Chromium), sinon le navigateur."""
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return "aucun écran détecté"
    for nom in NAVIGATEURS_APP:
        chemin = shutil.which(nom)
        if chemin:
            _detacher([chemin, f"--app={url}", "--class=AtelierIA"])
            return nom
    for nom in ("firefox", "xdg-open"):
        chemin = shutil.which(nom)
        if chemin:
            _detacher([chemin, url])
            return nom
    return "aucun navigateur trouvé"


def _detacher(cmd: list[str]) -> None:
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


ICONE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#18181b"/>
<path d="M18 44 32 16l14 28" fill="none" stroke="#fafafa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M23 35h18" stroke="#22c55e" stroke-width="5" stroke-linecap="round"/>
</svg>
"""


def lanceur_atelier() -> str:
    """Chemin de la commande « atelier » (pour l'entrée de menu)."""
    for c in (Path.home() / ".local" / "bin" / "atelier", Path(sys.argv[0]).resolve()):
        if c.exists() and os.access(c, os.X_OK) and c.name == "atelier":
            return str(c)
    trouve = shutil.which("atelier")
    return trouve or f"{sys.executable} -m atelier"


def creer_raccourci() -> Path:
    """Entrée « Atelier IA » dans le menu des applications (~/.local/share/applications)."""
    base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    if os.environ.get("ATELIER_HOME"):
        base = Path(os.environ["ATELIER_HOME"]) / "share"
    icone = dossier_donnees() / "atelier-ia.svg"
    icone.parent.mkdir(parents=True, exist_ok=True)
    icone.write_text(ICONE_SVG, encoding="utf-8")
    lanceur = lanceur_atelier()
    exec_ = f'"{lanceur}" ui' if Path(lanceur).exists() else f"{lanceur} ui"
    fichier = base / "applications" / "atelier-ia.desktop"
    fichier.parent.mkdir(parents=True, exist_ok=True)
    fichier.write_text(
        "\n".join(
            [
                "[Desktop Entry]",
                "Type=Application",
                "Name=Atelier IA",
                "Comment=Chat IA local, projets Gradle et mods Minecraft",
                f"Exec={exec_}",
                f"Icon={icone}",
                "Terminal=false",
                "Categories=Development;",
                "StartupWMClass=AtelierIA",
                "",
            ]
        ),
        encoding="utf-8",
    )
    fichier.chmod(0o755)
    return fichier
