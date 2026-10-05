import httpx

from atelier.config import Fournisseur
from atelier.fournisseurs import Rotation, adapter_corps, classer, delai_dans_message, discuter, est_degenere, lire_sse

from .conftest import Scenario, fournisseur, sse

MSG = [{"role": "user", "content": "Bonjour"}]
PARAMS = dict(temperature=0.2, max_tokens=500, raisonnement="aucun")


def f_famille(famille: str) -> Fournisseur:
    f = fournisseur("X")
    f.famille = famille
    return f


def test_adapter_corps_par_famille():
    corps = {"messages": [{"role": "assistant", "content": "a", "reasoning_content": "r"}]}
    assert adapter_corps(f_famille("groq"), corps, "aucun")["reasoning_effort"] == "none"
    assert "reasoning_content" not in adapter_corps(f_famille("groq"), corps, "aucun")["messages"][0]
    nv = adapter_corps(f_famille("nvidia"), corps, "aucun")
    assert nv["chat_template_kwargs"] == {"thinking": False} and nv["messages"][0]["reasoning_content"] == "r"
    assert adapter_corps(f_famille("nvidia"), {"messages": []}, "eleve")["reasoning_effort"] == "max"
    assert adapter_corps(f_famille("openrouter"), {"messages": []}, "moyen")["reasoning"] == {"effort": "medium"}
    assert adapter_corps(f_famille("cloudflare"), {"messages": []}, "aucun")["max_tokens"] == 4096


def test_classement_des_erreurs():
    assert classer(429, "Rate limit, try again in 1m30s").reessai_dans == 90
    assert classer(429, "x", {"retry-after": "12"}).reessai_dans == 12
    assert classer(402, "credits").categorie == "credits"
    assert classer(503, "down").categorie == "temporaire"
    assert classer(400, "maximum context length is 8192").categorie == "contexte"
    assert classer(400, "'n' must be 1").basculer is False
    assert classer(400, "reasoning_effort is not supported").basculer is True
    assert delai_dans_message("try again in 2h3m") == 7380


def test_lire_sse_et_degenerescence():
    evts = list(lire_sse(["data: {\"a\": 1}", "", ": commentaire", "data: pas-json", "data: [DONE]", "data: {\"b\": 2}"]))
    assert evts == [{"a": 1}]
    assert est_degenere("!" * 300) and not est_degenere("int x = 100000000000000000000000L; " * 3)
    # Défaut réel observé chez NVIDIA : un court préfixe puis une rafale de « ! » (84 % seulement de répétition).
    assert est_degenere("```mod" + "!" * 32) and est_degenere("OK" + "!" * 28)
    assert not est_degenere('System.out.println("Bonjour !!!");') and not est_degenere("// " + "=" * 40 + "\nclass A {}")


def test_bascule_sur_quota_puis_succes():
    sc = Scenario({"cle-A": [(429, {"error": {"message": "Rate limit"}})], "cle-B": [sse("Bonjour ", "le monde")]})
    rot = Rotation([fournisseur("A", 1), fournisseur("B", 2)])
    with sc.client() as c:
        r = discuter(rot, MSG, client=c, **PARAMS)
    assert r.texte == "Bonjour le monde" and r.fournisseur.nom == "B" and r.erreur is None
    assert [a["cle"] for a in sc.appels] == ["cle-A", "cle-B"]
    assert [f.nom for f in rot.disponibles()] == ["B"]  # A écarté pour la session


def test_reprise_au_caractere_pres_apres_coupure():
    sc = Scenario({"cle-A": [httpx.ReadError("coupure")], "cle-B": [sse("suite.")]})
    # A émet un début puis la connexion tombe : simulé par un flux sans fin suivi d'une erreur réseau.
    sc.reponses["cle-A"] = [sse("Début de ", coupe=True)]
    rot = Rotation([fournisseur("A", 1), fournisseur("B", 2)])

    def transport(req):
        if req.headers["authorization"].endswith("cle-A"):
            sc.appels.append({"cle": "cle-A"})

            class Flux(httpx.SyncByteStream):
                def __iter__(self):
                    yield sse("Début de ", coupe=True)
                    raise httpx.ReadError("coupure")

            return httpx.Response(200, stream=Flux(), headers={"content-type": "text/event-stream"})
        return sc(req)

    with httpx.Client(transport=httpx.MockTransport(transport)) as c:
        r = discuter(rot, MSG, client=c, **PARAMS)
    assert r.texte == "Début de suite."
    suite = sc.appels[-1]["corps"]["messages"]
    assert suite[-2] == {"role": "assistant", "content": "Début de "} and "Reprends EXACTEMENT" in suite[-1]["content"]


def test_reponse_vide_reessayee_puis_bascule_et_suite_si_coupee():
    sc = Scenario({"cle-A": [sse("   ")], "cle-B": [sse("Partie 1, ", fin="length"), sse("partie 2.")]})
    rot = Rotation([fournisseur("A", 1), fournisseur("B", 2)])
    with sc.client() as c:
        r = discuter(rot, MSG, client=c, **PARAMS)
    assert r.texte == "Partie 1, partie 2."
    assert [a["cle"] for a in sc.appels] == ["cle-A", "cle-A", "cle-B", "cle-B"]


def test_tous_epuises():
    sc = Scenario({"cle-A": [(503, {"error": "panne"})]})
    with sc.client() as c:
        r = discuter(Rotation([fournisseur("A", 1)]), MSG, client=c, **PARAMS)
    assert r.erreur and "épuisés" in r.erreur and "Prochain retour" in r.erreur


def test_erreur_requete_generique_sans_bascule():
    sc = Scenario({"cle-A": [(400, {"error": {"message": "'n' must be 1"}})], "cle-B": [sse("non")]})
    with sc.client() as c:
        r = discuter(Rotation([fournisseur("A", 1), fournisseur("B", 2)]), MSG, client=c, **PARAMS)
    assert r.erreur and "requete" in r.erreur and [a["cle"] for a in sc.appels] == ["cle-A"]
