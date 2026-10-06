"""Chemins, configuration et fournisseurs.

Tout est local à l'utilisateur :
  ~/.config/atelier/config.env      clés API et réglages (droits 600, jamais dans un dépôt)
  ~/.local/share/atelier/           JDK, Gradle et environnement Python installés par l'atelier
  ~/AtelierProjets/                 un dossier par projet (modifiable)

ATELIER_HOME redirige config et données dans un seul dossier (tests, installation portable).
"""

from __future__ import annotations

import os
import re
import stat
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# Versions de la chaîne de compilation : les mêmes que celles vérifiées par compilation réelle
# (JDK 25 + Gradle 9.7.1 compilent les mods Fabric 26.x et 1.21.x).
JDK_VERSION = 25
GRADLE_VERSION = "9.7.1"


def _home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def dossier_config() -> Path:
    if os.environ.get("ATELIER_HOME"):
        return Path(os.environ["ATELIER_HOME"]) / "config"
    base = os.environ.get("XDG_CONFIG_HOME") or str(_home() / ".config")
    return Path(base) / "atelier"


def dossier_donnees() -> Path:
    if os.environ.get("ATELIER_HOME"):
        return Path(os.environ["ATELIER_HOME"]) / "donnees"
    base = os.environ.get("XDG_DATA_HOME") or str(_home() / ".local" / "share")
    return Path(base) / "atelier"


def fichier_config() -> Path:
    return dossier_config() / "config.env"


def dossier_jdk() -> Path:
    return dossier_donnees() / "jdk"


def dossier_gradle() -> Path:
    return dossier_donnees() / "gradle"


# --------------------------------------------------------------------------- lecture .env


_RE_LIGNE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")


def lire_env(chemin: Path) -> dict[str, str]:
    """Lit un fichier KEY=VALUE (guillemets simples/doubles tolérés, commentaires #)."""
    valeurs: dict[str, str] = {}
    if not chemin.exists():
        return valeurs
    for ligne in chemin.read_text(encoding="utf-8").splitlines():
        if not ligne.strip() or ligne.lstrip().startswith("#"):
            continue
        m = _RE_LIGNE.match(ligne)
        if not m:
            continue
        cle, val = m.group(1), m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        else:
            val = re.sub(r"\s+#.*$", "", val)
        valeurs[cle] = val
    return valeurs


def ecrire_env(chemin: Path, valeurs: dict[str, str]) -> None:
    """Écrit le fichier de configuration en droits 600 (il contient des clés API)."""
    chemin.parent.mkdir(parents=True, exist_ok=True)
    lignes = [
        "# Configuration de l'atelier IA local. Ce fichier contient des clés API :",
        "# ne le partagez pas et ne le mettez jamais dans un dépôt git.",
        "",
    ]
    for cle in sorted(valeurs, key=_cle_tri):
        val = valeurs[cle]
        lignes.append(f'{cle}="{val}"' if re.search(r"[\s#\"']", val) else f"{cle}={val}")
    chemin.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    os.chmod(chemin, stat.S_IRUSR | stat.S_IWUSR)


def _cle_tri(cle: str) -> tuple[int, int, str]:
    m = re.match(r"PROVIDER_(\d+)_", cle)
    return (0, int(m.group(1)), cle) if m else (1, 0, cle)


def charger_valeurs() -> dict[str, str]:
    """Configuration effective : fichier config.env, surchargé par les variables d'environnement."""
    valeurs = lire_env(fichier_config())
    for cle, val in os.environ.items():
        if cle.startswith("PROVIDER_") or cle.startswith("ATELIER_"):
            valeurs[cle] = val
    return valeurs


# --------------------------------------------------------------------------- fournisseurs


@dataclass
class Fournisseur:
    id: str
    rang: int
    nom: str
    base_url: str
    api_key: str = field(repr=False)
    modele: str
    contexte: int
    famille: str


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def detecter_famille(base_url: str) -> str:
    hote = re.sub(r"^https?://", "", base_url).split("/")[0].split(":")[0].lower()
    for suffixe, famille in (("groq.com", "groq"), ("openrouter.ai", "openrouter"), ("cloudflare.com", "cloudflare"), ("nvidia.com", "nvidia")):
        if hote.endswith(suffixe):
            return famille
    return "generique"


def charger_fournisseurs(valeurs: dict[str, str] | None = None) -> tuple[list[Fournisseur], list[str]]:
    """Lit PROVIDER_n_* (n = 1, 2, …) comme la version web ; renvoie (fournisseurs, problèmes)."""
    v = charger_valeurs() if valeurs is None else valeurs
    liste: list[Fournisseur] = []
    problemes: list[str] = []
    for n in range(1, 51):
        lire = lambda cle, n=n: (v.get(f"PROVIDER_{n}_{cle}") or "").strip()  # noqa: E731
        nom, base = lire("NAME"), lire("BASE_URL")
        if not nom and not base:
            break
        cle_api, modele = lire("API_KEY"), lire("MODEL")
        try:
            contexte = int(float(lire("CONTEXT") or "0"))
        except ValueError:
            contexte = 0
        manquants = [k for k, ok in (("NAME", nom), ("BASE_URL", base), ("API_KEY", cle_api), ("MODEL", modele), ("CONTEXT", contexte > 0)) if not ok]
        if manquants:
            problemes.append(f"PROVIDER_{n} : {', '.join(manquants)} manquant")
            continue
        liste.append(
            Fournisseur(
                id=f"{n}-{_slug(nom)}",
                rang=n,
                nom=nom,
                base_url=base.rstrip("/"),
                api_key=cle_api,
                modele=modele,
                contexte=contexte,
                famille=detecter_famille(base),
            )
        )
    return liste, problemes


# --------------------------------------------------------------------------- réglages


@dataclass
class Reglages:
    dossier_projets: Path
    compilation_auto: bool = True
    corrections_max: int = 5
    raisonnement: str = "aucun"
    temperature: float = 0.4
    max_tokens: int = 16384


def _bool(s: str | None, defaut: bool) -> bool:
    if s is None or s == "":
        return defaut
    return s.strip().lower() in ("1", "true", "oui", "yes", "on")


def charger_reglages(valeurs: dict[str, str] | None = None) -> Reglages:
    v = charger_valeurs() if valeurs is None else valeurs
    dossier = v.get("ATELIER_DOSSIER_PROJETS") or str(_home() / "AtelierProjets")

    def entier(cle: str, defaut: int, mini: int, maxi: int) -> int:
        try:
            return max(mini, min(maxi, int(v.get(cle) or defaut)))
        except ValueError:
            return defaut

    try:
        temperature = max(0.0, min(2.0, float(v.get("ATELIER_TEMPERATURE") or 0.4)))
    except ValueError:
        temperature = 0.4
    raisonnement = (v.get("ATELIER_RAISONNEMENT") or "aucun").strip().lower()
    if raisonnement not in ("aucun", "faible", "moyen", "eleve"):
        raisonnement = "aucun"
    return Reglages(
        dossier_projets=Path(os.path.expanduser(dossier)),
        compilation_auto=_bool(v.get("ATELIER_COMPILATION_AUTO"), True),
        corrections_max=entier("ATELIER_CORRECTIONS_MAX", 5, 0, 100),
        raisonnement=raisonnement,
        temperature=temperature,
        max_tokens=entier("ATELIER_MAX_TOKENS", 16384, 256, 200_000),
    )


# Autres réglages repris d'un .env de la version web : utiles aussi en local (recherche web, lecture
# de liens, fuseau, plafond payant). Les variables propres à Vercel (APP_PASSWORD, DATABASE_URL,
# KV/Upstash, QStash, GITHUB_*, SESSION_SECRET…) sont volontairement ignorées : en local elles
# seraient inutiles ou nuisibles (base et verrous partagés avec la production).
CLES_IMPORTABLES = ("BRAVE_API_KEY", "TAVILY_API_KEY", "JINA_API_KEY", "APP_TZ", "PAID_MONTHLY_CAP")

# Fichier de clés que l'atelier importe tout seul s'il le trouve (dossier courant, Téléchargements).
NOMS_FICHIER_CLES = ("atelier-cles.env",)


def importer_env(source: Path) -> tuple[int, Path]:
    """Copie les PROVIDER_n_* (et les réglages utiles) d'un .env, par ex. le .env.local du web, dans config.env."""
    brutes = lire_env(source)
    externes = {k: val for k, val in brutes.items() if val and (k.startswith("PROVIDER_") or k in CLES_IMPORTABLES)}
    actuelles = lire_env(fichier_config())
    # On remplace entièrement la liste des fournisseurs pour garder des rangs contigus.
    if any(k.startswith("PROVIDER_") for k in externes):
        actuelles = {k: val for k, val in actuelles.items() if not k.startswith("PROVIDER_")}
    actuelles.update(externes)
    ecrire_env(fichier_config(), actuelles)
    rangs = {m.group(1) for k in externes if (m := re.match(r"PROVIDER_(\d+)_", k))}
    return len(rangs), fichier_config()


def chercher_fichier_cles(dossiers: list[Path] | None = None) -> Path | None:
    """Fichier atelier-cles.env déposé par l'utilisateur (dossier courant, Téléchargements, Downloads…)."""
    candidats = list(dossiers or []) + [Path.cwd(), _home() / "Téléchargements", _home() / "Downloads", _home()]
    for d in candidats:
        for nom in NOMS_FICHIER_CLES:
            f = d / nom
            if f.is_file():
                return f
    return None


def importer_cles_si_absentes(dossiers: list[Path] | None = None) -> tuple[int, Path] | None:
    """Aucun fournisseur valide configuré et un fichier atelier-cles.env trouvé : on l'importe."""
    fournisseurs, _ = charger_fournisseurs()
    if fournisseurs:
        return None
    f = chercher_fichier_cles(dossiers)
    if not f:
        return None
    n, _cfg = importer_env(f)
    return (n, f) if n else None
