"""Appels aux fournisseurs OpenAI-compatibles (NVIDIA, Groq, Cloudflare, OpenRouter…) en flux,
avec rotation : un fournisseur en erreur (quota, panne, délai) est mis de côté et le suivant
prend le relais, en reprenant au caractère près si une réponse a été coupée en cours de route.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable

import httpx

from .config import Fournisseur

EFFORT = {"faible": "low", "moyen": "medium", "eleve": "high"}
MAX_SUITES = 4

INSTRUCTION_CONTINUATION = (
    "Ta réponse précédente a été interrompue par une coupure technique. Reprends EXACTEMENT là où elle s'est arrêtée, "
    "au caractère près, sans répéter ce qui a déjà été écrit, sans introduction ni commentaire. "
    "Si la réponse était déjà complète, réponds uniquement par un espace."
)


class Annule(Exception):
    """L'utilisateur a interrompu la génération (Ctrl+C)."""


@dataclass
class ErreurFournisseur(Exception):
    categorie: str  # quota | credits | auth | temporaire | contexte | requete
    message: str
    statut: int | None = None
    reessai_dans: float = 120.0
    basculer: bool = True

    def __str__(self) -> str:
        return f"{self.categorie}{f' {self.statut}' if self.statut else ''} : {self.message}"


@dataclass
class Tentative:
    texte: str = ""
    raisonnement: str = ""
    fin: str | None = None
    entree: int = 0
    sortie: int = 0


@dataclass
class Reponse:
    texte: str
    fournisseur: Fournisseur | None
    entree: int = 0
    sortie: int = 0
    erreur: str | None = None
    bascules: list[str] = field(default_factory=list)


def adapter_corps(f: Fournisseur, corps: dict, raisonnement: str) -> dict:
    """Paramètres propres à chaque famille (identiques à la version web)."""
    c = dict(corps)
    if f.famille != "nvidia":
        # Groq refuse reasoning_content dans l'historique ; NVIDIA/Kimi K3 en a besoin pour ses outils.
        c["messages"] = [{k: v for k, v in m.items() if k != "reasoning_content"} for m in c.get("messages", [])]
    if f.famille == "groq":
        c["reasoning_effort"] = "none" if raisonnement == "aucun" else EFFORT[raisonnement]
    elif f.famille == "openrouter":
        c["reasoning"] = {"enabled": False} if raisonnement == "aucun" else {"effort": EFFORT[raisonnement]}
    elif f.famille == "cloudflare":
        c.setdefault("max_tokens", 4096)
        c["reasoning_effort"] = "xhigh" if raisonnement == "eleve" else "medium" if raisonnement == "moyen" else "low"
    elif f.famille == "nvidia":
        reflechir = raisonnement != "aucun" or bool(c.get("tools"))
        c["chat_template_kwargs"] = {**c.get("chat_template_kwargs", {}), "thinking": reflechir}
        if raisonnement == "moyen":
            c["reasoning_effort"] = "high"
        elif raisonnement == "eleve":
            c["reasoning_effort"] = "max"
        else:
            c.pop("reasoning_effort", None)
    return c


_RE_CONTEXTE = re.compile(
    r"context[_ ]length|context window|too (long|large)|maximum (context|number of tokens)|token limit|reduce the length|"
    r"prompt is too long|input too long|request too large",
    re.I,
)
_RE_REQUETE_FOURNISSEUR = re.compile(
    r"reasoning_effort|unsupported|not supported|does not support|unknown (field|parameter|argument)|unrecognized|deprecated|"
    r"decommission|retired|no longer (available|supported)|invalid model|model .*(not found|does not exist|unavailable)",
    re.I,
)


def delai_dans_message(message: str) -> float | None:
    """« try again in 2h3m4.5s » → secondes."""
    m = re.search(r"try again in\s+([0-9hms.]+)", message, re.I)
    if not m:
        return None
    total = 0.0
    for val, unite in re.findall(r"([0-9.]+)\s*(h|ms|m|s)", m.group(1)):
        total += float(val) * {"h": 3600, "m": 60, "s": 1, "ms": 0.001}[unite]
    return total or None


def classer(statut: int | None, message: str, entetes: dict | None = None) -> ErreurFournisseur:
    entetes = entetes or {}
    retry = entetes.get("retry-after")
    attente: float | None = None
    if retry:
        try:
            attente = float(retry)
        except ValueError:
            attente = None
    attente = attente or delai_dans_message(message)
    if statut == 429 or re.search(r"rate limit|quota|daily free allocation", message, re.I):
        return ErreurFournisseur("quota", message, statut, attente or 60.0)
    if statut == 402:
        return ErreurFournisseur("credits", message, statut, 24 * 3600)
    if statut in (401, 403):
        return ErreurFournisseur("auth", message, statut, 3600)
    if statut in (408, 498) or (statut is not None and statut >= 500):
        return ErreurFournisseur("temporaire", message, statut, attente or 120.0)
    if statut in (400, 413, 422) and _RE_CONTEXTE.search(message):
        return ErreurFournisseur("contexte", message, statut, 0.0)
    if statut is not None and 400 <= statut < 500:
        specifique = statut == 404 or bool(_RE_REQUETE_FOURNISSEUR.search(message))
        return ErreurFournisseur("requete", message, statut, 600.0, basculer=specifique)
    return ErreurFournisseur("temporaire", message, statut, attente or 120.0)


def _message_erreur(corps: str) -> str:
    try:
        j = json.loads(corps)
    except ValueError:
        return corps.strip()[:500] or "réponse vide"
    if isinstance(j, dict):
        e = j.get("error")
        if isinstance(e, dict):
            return str(e.get("message") or e)
        if isinstance(e, str):
            return e
        errs = j.get("errors")
        if isinstance(errs, list) and errs and isinstance(errs[0], dict):
            return str(errs[0].get("message"))
        if j.get("message"):
            return str(j["message"])
    return corps.strip()[:500]


def lire_sse(lignes: Iterable[str]) -> Iterable[dict]:
    """Événements JSON d'un flux SSE OpenAI (« data: {...} », « data: [DONE] »)."""
    for ligne in lignes:
        if not ligne.startswith("data:"):
            continue
        donnee = ligne[5:].strip()
        if donnee == "[DONE]":
            return
        if not donnee:
            continue
        try:
            yield json.loads(donnee)
        except ValueError:
            continue


def est_degenere(texte: str) -> bool:
    # Signature du défaut passager de NVIDIA/Kimi : une rafale de « ! » (« ```mod!!!!!!… », « OK!!!!… »),
    # qui n'apparaît jamais dans du vrai code, même quand un court préfixe la précède.
    if re.search(r"!{16,}", texte):
        return True
    compact = re.sub(r"\s+", "", texte)
    if len(compact) < 20:
        return False
    repetes = sum(len(m.group(0)) for m in re.finditer(r"(.)\1{19,}", compact))
    return repetes / len(compact) > 0.9


def tenter(
    f: Fournisseur,
    messages: list[dict],
    *,
    temperature: float,
    max_tokens: int,
    raisonnement: str,
    sur_texte: Callable[[str], None] | None = None,
    sur_raisonnement: Callable[[str], None] | None = None,
    client: httpx.Client | None = None,
) -> Tentative:
    """Un appel en flux à un fournisseur. Lève ErreurFournisseur (avec le texte déjà reçu dans .partiel)."""
    corps = adapter_corps(
        f,
        {
            "model": f.modele,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        raisonnement,
    )
    entetes = {"Authorization": f"Bearer {f.api_key}", "Content-Type": "application/json"}
    if f.famille == "openrouter":
        entetes |= {"HTTP-Referer": "http://localhost", "X-Title": "Atelier IA local"}
    t = Tentative()
    proprietaire = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(connect=20.0, read=180.0, write=60.0, pool=20.0))
    try:
        with client.stream("POST", f"{f.base_url}/chat/completions", json=corps, headers=entetes) as r:
            if r.status_code >= 400:
                corps_erreur = r.read().decode("utf-8", "replace")
                raise classer(r.status_code, _message_erreur(corps_erreur), {k.lower(): v for k, v in r.headers.items()})
            for evt in lire_sse(r.iter_lines()):
                if isinstance(evt.get("error"), (dict, str)):
                    e = evt["error"]
                    msg = e.get("message", str(e)) if isinstance(e, dict) else e
                    code = e.get("code") if isinstance(e, dict) else None
                    err = classer(code if isinstance(code, int) else None, str(msg))
                    err.partiel = t  # type: ignore[attr-defined]
                    raise err
                usage = evt.get("usage")
                if isinstance(usage, dict):
                    t.entree = int(usage.get("prompt_tokens") or t.entree)
                    t.sortie = int(usage.get("completion_tokens") or t.sortie)
                for choix in evt.get("choices") or []:
                    delta = choix.get("delta") or {}
                    rais = delta.get("reasoning_content") or delta.get("reasoning")
                    if isinstance(rais, str) and rais:
                        t.raisonnement += rais
                        if sur_raisonnement:
                            sur_raisonnement(rais)
                    contenu = delta.get("content")
                    if isinstance(contenu, str) and contenu:
                        t.texte += contenu
                        if sur_texte:
                            sur_texte(contenu)
                    if choix.get("finish_reason"):
                        t.fin = choix["finish_reason"]
    except ErreurFournisseur as e:
        if not hasattr(e, "partiel"):
            e.partiel = t  # type: ignore[attr-defined]
        raise
    except (httpx.TimeoutException, httpx.TransportError) as e:
        err = ErreurFournisseur("temporaire", f"réseau : {type(e).__name__} {e}".strip(), None, 120.0)
        err.partiel = t  # type: ignore[attr-defined]
        raise err from e
    except KeyboardInterrupt:
        raise Annule() from None
    finally:
        if proprietaire:
            client.close()
    return t


class Rotation:
    """Ordre d'essai des fournisseurs pour la session, avec mise à l'écart temporaire de ceux en erreur."""

    def __init__(self, fournisseurs: list[Fournisseur]):
        self.fournisseurs = sorted(fournisseurs, key=lambda f: f.rang)
        self.ecartes: dict[str, tuple[float, str]] = {}  # id → (jusqu'à, raison)

    def disponibles(self) -> list[Fournisseur]:
        maintenant = time.time()
        return [f for f in self.fournisseurs if self.ecartes.get(f.id, (0.0, ""))[0] <= maintenant]

    def ecarter(self, f: Fournisseur, secondes: float, raison: str) -> None:
        self.ecartes[f.id] = (time.time() + max(5.0, secondes), raison)

    def prochain_retour(self) -> tuple[float, str] | None:
        if not self.ecartes:
            return None
        fid, (quand, _) = min(self.ecartes.items(), key=lambda x: x[1][0])
        nom = next((f.nom for f in self.fournisseurs if f.id == fid), fid)
        return quand, nom


def discuter(
    rotation: Rotation,
    messages: list[dict],
    *,
    temperature: float,
    max_tokens: int,
    raisonnement: str,
    sur_texte: Callable[[str], None] | None = None,
    sur_raisonnement: Callable[[str], None] | None = None,
    sur_info: Callable[[str], None] | None = None,
    client: httpx.Client | None = None,
) -> Reponse:
    """Génère une réponse complète en faisant tourner les fournisseurs si besoin."""
    info = sur_info or (lambda _m: None)
    texte = ""
    entree = sortie = 0
    bascules: list[str] = []
    essais_sur_place: set[str] = set()
    tentes: set[str] = set()
    dernier: Fournisseur | None = None
    for _tour in range(len(rotation.fournisseurs) * 2 + 2):
        candidats = [f for f in rotation.disponibles() if f.id not in tentes]
        if not candidats:
            break
        f = candidats[0]
        tentes.add(f.id)
        dernier = f
        msgs = list(messages)
        if texte:
            msgs += [{"role": "assistant", "content": texte}, {"role": "user", "content": INSTRUCTION_CONTINUATION}]
        try:
            t = tenter(f, msgs, temperature=temperature, max_tokens=max_tokens, raisonnement=raisonnement, sur_texte=sur_texte, sur_raisonnement=sur_raisonnement, client=client)
            entree += t.entree
            sortie += t.sortie
            texte += t.texte
            suites = 0
            while t.fin == "length" and t.texte and not est_degenere(t.texte) and suites < MAX_SUITES:
                suites += 1
                info(f"réponse longue : suite automatique ({suites}/{MAX_SUITES})")
                suite = messages + [{"role": "assistant", "content": texte}, {"role": "user", "content": INSTRUCTION_CONTINUATION}]
                t = tenter(f, suite, temperature=temperature, max_tokens=max_tokens, raisonnement=raisonnement, sur_texte=sur_texte, sur_raisonnement=sur_raisonnement, client=client)
                entree += t.entree
                sortie += t.sortie
                texte += t.texte
            if not texte.strip() or est_degenere(texte):
                raison = "réponse dégénérée" if texte.strip() else "réponse vide"
                texte = ""
                if f.id not in essais_sur_place:
                    essais_sur_place.add(f.id)
                    tentes.discard(f.id)
                    info(f"{raison} chez {f.nom} : nouvel essai")
                    continue
                bascules.append(f"{f.nom} → suivant ({raison})")
                info(f"{raison} chez {f.nom} : fournisseur suivant")
                continue
            return Reponse(texte, f, entree, sortie, None, bascules)
        except ErreurFournisseur as e:
            partiel: Tentative = getattr(e, "partiel", Tentative())
            entree += partiel.entree
            sortie += partiel.sortie
            texte += partiel.texte
            if e.categorie == "requete" and not e.basculer:
                return Reponse(texte, f, entree, sortie, str(e), bascules)
            rotation.ecarter(f, e.reessai_dans, str(e))
            bascules.append(f"{f.nom} → suivant ({e.categorie})")
            info(f"{f.nom} indisponible ({e}) : fournisseur suivant{' — reprise de la réponse' if texte else ''}")
            continue
    retour = rotation.prochain_retour()
    quand = f" Prochain retour possible : {time.strftime('%H:%M', time.localtime(retour[0]))} ({retour[1]})." if retour else ""
    return Reponse(texte, dernier, entree, sortie, f"Tous les fournisseurs sont épuisés ou en erreur.{quand}", bascules)
