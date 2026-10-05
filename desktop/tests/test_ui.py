"""Interface graphique locale : assemblage, environnement du serveur, raccourci, état."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from atelier import ui
from atelier.installation import ErreurInstallation


def _faux_depot(racine: Path, secret: str | None = None) -> Path:
    depot = racine / "depot"
    auto = depot / ".next" / "standalone"
    (auto / ".next" / "server").mkdir(parents=True)
    (auto / ".next" / "cache").mkdir()
    (auto / ".next" / "cache" / "gros").write_text("cache")
    (auto / ".next" / "BUILD_ID").write_text("abcdef123456")
    (auto / ".next" / "server" / "page.js").write_text("module.exports = 1;" + (secret or ""))
    (auto / "server.js").write_text("// serveur")
    (auto / "package.json").write_text("{}")
    for d in ("node_modules/next", "node_modules/@img/sharp", "node_modules/sharp", "src", "data/pglite", "desktop"):
        (auto / d).mkdir(parents=True)
    (auto / "node_modules" / "next" / "index.js").write_text("")
    (auto / "data" / "pglite" / "base").write_text("conversations privées")
    (depot / ".next" / "static" / "chunks").mkdir(parents=True)
    (depot / ".next" / "static" / "chunks" / "a.js").write_text("")
    return depot


def test_assembler_garde_le_serveur_et_retire_le_reste(tmp_path: Path) -> None:
    depot = _faux_depot(tmp_path)
    dest = ui.assembler_app(depot, tmp_path / "web")
    noms = {p.name for p in dest.iterdir()}
    assert noms == {"server.js", "package.json", "node_modules", ".next", "VERSION"}
    assert not (dest / ".next" / "cache").exists()  # cache de construction non distribué
    assert (dest / ".next" / "static" / "chunks" / "a.js").exists()
    assert (dest / "node_modules" / "next").exists()
    assert not (dest / "node_modules" / "@img").exists() and not (dest / "node_modules" / "sharp").exists()
    assert dest.joinpath("VERSION").read_text().strip().endswith("abcdef12")


def test_assembler_refuse_un_secret_de_env_local(tmp_path: Path) -> None:
    depot = _faux_depot(tmp_path, secret="nvapi-CLEFSECRETE123456")
    (depot / ".env.local").write_text("PROVIDER_1_API_KEY=nvapi-CLEFSECRETE123456\n")
    with pytest.raises(ErreurInstallation, match="secrète"):
        ui.assembler_app(depot, tmp_path / "web")


def test_environnement_serveur_local_uniquement(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOSTNAME", "ma-machine")
    monkeypatch.setenv("APP_PASSWORD", "x")
    monkeypatch.setenv("DATABASE_URL", "postgres://distant")
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("PROVIDER_1_NAME", "NVIDIA")
    env = ui.environnement_serveur(3999, Path("/opt/node/bin/node"))
    assert env["HOSTNAME"] == "127.0.0.1"  # jamais toutes les interfaces
    assert env["PORT"] == "3999" and env["TACHES_URL_INTERNE"] == "http://127.0.0.1:3999"
    assert env["ATELIER_LOCAL"] == "1"
    for cle in ("APP_PASSWORD", "DATABASE_URL", "VERCEL"):
        assert cle not in env
    assert env["PROVIDER_1_NAME"] == "NVIDIA"
    assert env["PGLITE_DIR"].startswith(os.environ["ATELIER_HOME"])
    assert len(env["SESSION_SECRET"]) >= 32
    secret = Path(os.environ["ATELIER_HOME"]) / "config" / "ui-secret"
    assert secret.stat().st_mode & 0o777 == 0o600
    assert ui.environnement_serveur(3999, Path("/n"))["SESSION_SECRET"] == env["SESSION_SECRET"]  # persistant


def test_raccourci_menu(tmp_path: Path) -> None:
    f = ui.creer_raccourci()
    contenu = f.read_text()
    assert "Name=Atelier IA" in contenu and " ui" in contenu and "Terminal=false" in contenu
    assert Path(contenu.split("Icon=")[1].splitlines()[0]).exists()


def test_etat_serveur_mort_nettoye(tmp_path: Path) -> None:
    ui.dossier_ui().mkdir(parents=True, exist_ok=True)
    ui.fichier_etat().write_text(json.dumps({"pid": 999_999_999, "port": 3210, "version": "v", "empreinte_config": ""}))
    assert ui.serveur_actif() is None
    assert ui.arreter() is False
    assert not ui.fichier_etat().exists()


def test_choisir_port_saute_un_port_occupe() -> None:
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        occupe = s.getsockname()[1]
        assert ui.choisir_port(occupe) != occupe
