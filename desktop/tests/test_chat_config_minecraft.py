import json
import stat

import httpx

from atelier import chat, minecraft
from atelier.chat import Session, _alterner
from atelier.config import charger_fournisseurs, charger_reglages, ecrire_env, fichier_config, importer_env, lire_env
from atelier.gradle import ResultatCompilation, resumer_journal, trouver_jars

from .conftest import Scenario, ecrire, fournisseur, sse

PROJET = "```groovy build.gradle\nplugins { id 'java' }\n```\n```java src/A.java\nclass A { int v = 1; }\n```\n"


# --------------------------------------------------------------------------- configuration


def test_config_env_droits_600_et_fournisseurs(tmp_path):
    ecrire_env(fichier_config(), {"PROVIDER_1_NAME": "NVIDIA", "PROVIDER_1_BASE_URL": "https://integrate.api.nvidia.com/v1/", "PROVIDER_1_API_KEY": "nvapi-x", "PROVIDER_1_MODEL": "m", "PROVIDER_1_CONTEXT": "1000", "PROVIDER_2_NAME": "Sans clé", "PROVIDER_2_BASE_URL": "https://x"})
    assert stat.S_IMODE(fichier_config().stat().st_mode) == 0o600
    fs, problemes = charger_fournisseurs()
    assert [(f.nom, f.famille, f.base_url) for f in fs] == [("NVIDIA", "nvidia", "https://integrate.api.nvidia.com/v1")]
    assert problemes == ["PROVIDER_2 : API_KEY, MODEL, CONTEXT manquant"]


def test_import_depuis_env_web_et_reglages(tmp_path):
    src = tmp_path / ".env.local"
    src.write_text('APP_PASSWORD=secret\nPROVIDER_1_NAME="Groq"\nPROVIDER_1_BASE_URL=https://api.groq.com/openai/v1\nPROVIDER_1_API_KEY=gsk_x # commentaire\nPROVIDER_1_MODEL=m\nPROVIDER_1_CONTEXT=131072\n')
    n, _ = importer_env(src)
    v = lire_env(fichier_config())
    assert n == 1 and v["PROVIDER_1_API_KEY"] == "gsk_x" and "APP_PASSWORD" not in v
    r = charger_reglages({"ATELIER_CORRECTIONS_MAX": "500", "ATELIER_COMPILATION_AUTO": "non", "ATELIER_RAISONNEMENT": "bof"})
    assert r.corrections_max == 100 and r.compilation_auto is False and r.raisonnement == "aucun"


# --------------------------------------------------------------------------- gradle


def test_resumer_journal_et_jars(tmp_path):
    j = "> Task :compileJava\nok\n/src/A.java:3: error: cannot find symbol\n  symbol: class Foo\n1 error\n> Task :compileJava FAILED\nFAILURE: Build failed\n* What went wrong:\nExecution failed\nBUILD FAILED in 2s"
    r = resumer_journal(j)
    # Erreurs gardées avec une ligne de contexte avant ; la ligne « > Task :compileJava » sans rapport est écartée.
    assert "cannot find symbol" in r and "What went wrong" in r and "> Task :compileJava" not in r.split("\n")
    assert resumer_journal("a\nb") == "a\nb"
    for nom in ("mod-1.0.jar", "mod-1.0-sources.jar", "mod-1.0-dev.jar"):
        ecrire(tmp_path, f"build/libs/{nom}", "")
    assert [p.name for p in trouver_jars(tmp_path)] == ["mod-1.0.jar"]


# --------------------------------------------------------------------------- session


def session(projet, sc, **kw):
    s = Session(projet, [fournisseur("A", 1, contexte=50_000)], charger_reglages({}), client=sc.client(), **kw)
    return s


def test_tour_ecrit_les_fichiers_et_contexte_suivant(projet_tmp):
    sc = Scenario({"cle-A": [sse(PROJET), sse("```modif src/A.java\n<<<<<<< CHERCHER\nint v = 1;\n=======\nint v = 2;\n>>>>>>> REMPLACER\n```")]})
    s = session(projet_tmp, sc)
    t = s.tour("Fais un projet")
    assert t.rapport.ecrits == ["build.gradle", "src/A.java"]
    assert s.doit_compiler(t.rapport)
    t2 = s.tour("Passe v à 2")
    assert t2.rapport.modifies == ["src/A.java"] and "int v = 2;" in (projet_tmp.dossier / "src/A.java").read_text()
    # Au 2e tour : l'état du projet est dans le système et les blocs de la réponse 1 sont masqués.
    msgs = sc.appels[1]["corps"]["messages"]
    assert msgs[0]["role"] == "system" and "etat_du_projet" in msgs[0]["content"] and "class A { int v = 1; }" in msgs[0]["content"]
    assert "[fichier `src/A.java` : voir l'état du projet]" in msgs[2]["content"]
    assert projet_tmp.charger_historique()[-1]["role"] == "assistant"


def test_echec_de_modification_signale_au_modele(projet_tmp):
    sc = Scenario({"cle-A": [sse(PROJET), sse("```modif src/A.java\n<<<<<<< CHERCHER\nabsent\n=======\nx\n>>>>>>> REMPLACER\n```"), sse("ok")]})
    s = session(projet_tmp, sc)
    s.tour("a")
    t = s.tour("b")
    assert t.rapport.echecs and not t.rapport.change
    s.tour("c")
    assert "n'ont PAS pu être appliquées" in sc.appels[2]["corps"]["messages"][0]["content"]


def test_boucle_de_correction_jusqu_au_jar(projet_tmp, monkeypatch):
    resultats = [ResultatCompilation(False, 1, 1.0, "j", "error: cannot find symbol"), ResultatCompilation(True, 0, 1.0, "BUILD SUCCESSFUL", "ok")]
    monkeypatch.setattr(chat, "compiler", lambda dossier, sortie=None: resultats.pop(0))
    sc = Scenario({"cle-A": [sse(PROJET), sse("```modif src/A.java\n<<<<<<< CHERCHER\nint v = 1;\n=======\nint v = 3;\n>>>>>>> REMPLACER\n```")]})
    s = session(projet_tmp, sc)
    s.tour("projet")
    r = s.corriger_en_boucle(5)
    assert r.ok and "cannot find symbol" in sc.appels[1]["corps"]["messages"][-1]["content"]
    assert s.doit_compiler(s.projet.appliquer_reponse("")) is False  # état déjà compilé


def test_boucle_s_arrete_si_le_modele_ne_change_rien(projet_tmp, monkeypatch):
    compilations = []
    monkeypatch.setattr(chat, "compiler", lambda dossier, sortie=None: compilations.append(1) or ResultatCompilation(False, 1, 1.0, "j", "erreur"))
    sc = Scenario({"cle-A": [sse(PROJET), sse("Je ne sais pas."), sse("Toujours rien.")]})
    infos = []
    s = session(projet_tmp, sc, sur_info=infos.append)
    s.tour("projet")
    r = s.corriger_en_boucle(0)
    assert not r.ok and len(compilations) == 1 and len(sc.appels) == 3  # jamais recompilé sans changement
    assert any("ne modifie plus" in i for i in infos)


def test_limite_de_corrections(projet_tmp, monkeypatch):
    monkeypatch.setattr(chat, "compiler", lambda dossier, sortie=None: ResultatCompilation(False, 1, 1.0, "j", "erreur"))
    reponses = [sse(PROJET)] + [sse(f"```java src/A.java\nclass A {{ int v = {i}; }}\n```") for i in range(10)]
    sc = Scenario({"cle-A": reponses})
    s = session(projet_tmp, sc)
    s.tour("projet")
    s.corriger_en_boucle(2)
    assert len(sc.appels) == 3  # projet + 2 corrections


def test_alternance_des_roles():
    assert _alterner([{"role": "assistant", "content": "x"}, {"role": "user", "content": "a"}, {"role": "user", "content": "b"}]) == [{"role": "user", "content": "a\n\nb"}]


# --------------------------------------------------------------------------- minecraft


def test_java_et_contexte_fabric():
    assert [minecraft.java_pour(v) for v in ("26.3", "1.21.11", "1.20.6", "1.20.4", "1.18", "1.17.1", "1.16.5")] == [25, 21, 21, 17, 17, 16, 8]
    v26 = minecraft.Versions("26.3", "0.19.5", "0.161.0+26.3", "1.18.2", None, 25, 0.0, True)
    b = minecraft.bloc_contexte(v26)
    assert "id 'net.fabricmc.fabric-loom'" in b and "officialMojangMappings" not in b.split("```groovy build.gradle")[1]
    assert "gradle build" in b and "Compiler sur GitHub" not in b
    v121 = minecraft.Versions("1.21.11", "0.19.5", "", "1.18.2", None, 21, 0.0, False)
    b2 = minecraft.bloc_contexte(v121)
    assert "fabric-loom-remap" in b2 and "mappings loom.officialMojangMappings()" in b2
    assert "fabric_api_version=REMPLACER_PAR_LA_VERSION_FABRIC_API" in b2 and "valeurs de repli" in b2
    assert "je ne t'impose pas de modèle Fabric" in minecraft.bloc_contexte(v121, "neoforge")
    assert minecraft.detecter_loader(["un mod fabric", "en fait neoforge"]) == "neoforge"


def test_version_depuis_projet(projet_tmp):
    ecrire(projet_tmp.dossier, "src/main/resources/fabric.mod.json", json.dumps({"depends": {"minecraft": "~1.21.11"}}))
    assert minecraft.version_depuis_projet(projet_tmp.lire) == "1.21.11"
    ecrire(projet_tmp.dossier, "gradle.properties", "minecraft_version=26.3\n")
    assert minecraft.version_depuis_projet(projet_tmp.lire) == "26.3"


def test_versions_reseau_simule_et_cache(tmp_path):
    def transport(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "versions/game" in u:
            return httpx.Response(200, json=[{"version": "26.3", "stable": True}])
        if "versions/loader" in u:
            return httpx.Response(200, json=[{"loader": {"version": "0.19.5", "stable": True}}])
        if "modrinth" in u:
            return httpx.Response(200, json=[{"version_number": "0.161.0+26.3"}])
        if "fabric-loom" in u:
            return httpx.Response(200, text="<metadata><versioning><release>1.18.2</release></versioning></metadata>")
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(transport)) as c:
        v = minecraft.versions(None, client=c, cache=tmp_path)
    assert (v.jeu, v.fabric_api, v.loom, v.java, v.verifie) == ("26.3", "0.161.0+26.3", "1.18.2", 25, True)
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))) as c:
        assert minecraft.versions(None, client=c, cache=tmp_path).fabric_api == "0.161.0+26.3"  # servi par le cache


def test_import_cles_utiles_sans_variables_vercel(tmp_path, monkeypatch):
    from atelier.config import importer_env, lire_env, fichier_config

    src = tmp_path / "atelier-cles.env"
    src.write_text(
        "PROVIDER_1_NAME=Groq\nPROVIDER_1_BASE_URL=https://api.groq.com/openai/v1\nPROVIDER_1_API_KEY=gsk_x\n"
        "PROVIDER_1_MODEL=m\nPROVIDER_1_CONTEXT=1000\nBRAVE_API_KEY=b\nAPP_PASSWORD=p\nDATABASE_URL=postgres://x\n"
        "KV_REST_API_TOKEN=k\nQSTASH_TOKEN=q\nGITHUB_TOKEN=g\nSESSION_SECRET=s\n"
    )
    n, _ = importer_env(src)
    v = lire_env(fichier_config())
    assert n == 1 and v["BRAVE_API_KEY"] == "b"
    for cle in ("APP_PASSWORD", "DATABASE_URL", "KV_REST_API_TOKEN", "QSTASH_TOKEN", "GITHUB_TOKEN", "SESSION_SECRET"):
        assert cle not in v


def test_import_automatique_depuis_telechargements(tmp_path, monkeypatch):
    from atelier.config import charger_fournisseurs, importer_cles_si_absentes

    maison = tmp_path / "maison"
    (maison / "Téléchargements").mkdir(parents=True)
    monkeypatch.setenv("HOME", str(maison))
    monkeypatch.chdir(tmp_path)
    assert importer_cles_si_absentes() is None  # rien à importer
    (maison / "Téléchargements" / "atelier-cles.env").write_text(
        "PROVIDER_1_NAME=Groq\nPROVIDER_1_BASE_URL=https://api.groq.com/openai/v1\nPROVIDER_1_API_KEY=gsk_x\nPROVIDER_1_MODEL=m\nPROVIDER_1_CONTEXT=1000\n"
    )
    n, f = importer_cles_si_absentes()
    assert n == 1 and f.name == "atelier-cles.env"
    assert [x.nom for x in charger_fournisseurs()[0]] == ["Groq"]
    assert importer_cles_si_absentes() is None  # déjà configuré : on ne touche plus à rien
