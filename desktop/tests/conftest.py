import json
import os
from pathlib import Path

import httpx
import pytest

from atelier.config import Fournisseur


@pytest.fixture(autouse=True)
def atelier_home(tmp_path, monkeypatch):
    """Chaque test a sa propre configuration et ses propres données (jamais celles de l'utilisateur)."""
    monkeypatch.setenv("ATELIER_HOME", str(tmp_path / "atelier-home"))
    for k in list(os.environ):
        if k.startswith("PROVIDER_") or (k.startswith("ATELIER_") and k != "ATELIER_HOME"):
            monkeypatch.delenv(k, raising=False)
    return tmp_path / "atelier-home"


def fournisseur(nom: str, rang: int = 1, contexte: int = 100_000, base: str = "https://exemple.test/v1") -> Fournisseur:
    return Fournisseur(id=f"{rang}-{nom.lower()}", rang=rang, nom=nom, base_url=base, api_key=f"cle-{nom}", modele=f"modele-{nom}", contexte=contexte, famille="generique")


def sse(*morceaux: str, fin: str = "stop", usage: tuple[int, int] = (10, 5), coupe: bool = False) -> bytes:
    lignes = [f"data: {json.dumps({'choices': [{'index': 0, 'delta': {'content': m}, 'finish_reason': None}]})}\n\n" for m in morceaux]
    if not coupe:
        lignes.append(f"data: {json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': fin}]})}\n\n")
        lignes.append(f"data: {json.dumps({'choices': [], 'usage': {'prompt_tokens': usage[0], 'completion_tokens': usage[1]}})}\n\n")
        lignes.append("data: [DONE]\n\n")
    return "".join(lignes).encode()


class Scenario:
    """Transport httpx simulé : la clé API choisit la file de réponses du fournisseur."""

    def __init__(self, reponses: dict[str, list]):
        self.reponses = reponses
        self.appels: list[dict] = []

    def __call__(self, requete: httpx.Request) -> httpx.Response:
        cle = requete.headers["authorization"].removeprefix("Bearer ")
        corps = json.loads(requete.content)
        self.appels.append({"cle": cle, "corps": corps})
        file = self.reponses[cle]
        r = file.pop(0) if len(file) > 1 else file[0]
        if isinstance(r, Exception):
            raise r
        if isinstance(r, tuple):
            statut, contenu = r
            return httpx.Response(statut, json=contenu)
        return httpx.Response(200, content=r, headers={"content-type": "text/event-stream"})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self))


@pytest.fixture
def projet_tmp(tmp_path):
    from atelier.projet import Projet

    p = Projet(tmp_path / "projet")
    p.creer()
    return p


def ecrire(dossier: Path, chemin: str, contenu: str) -> None:
    f = dossier / chemin
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(contenu, encoding="utf-8")
