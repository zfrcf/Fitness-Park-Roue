import os

from atelier.projet import Projet

from .conftest import ecrire

REPONSE = """Voici le projet.

```groovy build.gradle
plugins { id 'java' }
```

```java src/main/java/com/demo/App.java
package com.demo;

public class App {
    static final int VERSION = 1;

    public static void main(String[] args) {
        System.out.println("Bonjour");
    }
}
```
"""


def test_reponse_ecrite_puis_modifiee_sur_le_disque(projet_tmp: Projet):
    r = projet_tmp.appliquer_reponse(REPONSE)
    assert r.ecrits == ["build.gradle", "src/main/java/com/demo/App.java"] and not r.echecs
    assert projet_tmp.est_gradle()
    modif = "```modif src/main/java/com/demo/App.java\n<<<<<<< CHERCHER\n    static final int VERSION = 1;\n=======\n    static final int VERSION = 2;\n>>>>>>> REMPLACER\n```\nSupprimer : build.gradle"
    r2 = projet_tmp.appliquer_reponse(modif)
    assert r2.modifies == ["src/main/java/com/demo/App.java"] and r2.supprimes == ["build.gradle"]
    contenu = (projet_tmp.dossier / "src/main/java/com/demo/App.java").read_text()
    assert "VERSION = 2" in contenu and 'println("Bonjour")' in contenu
    assert not (projet_tmp.dossier / "build.gradle").exists()


def test_echecs_signales_sans_toucher_au_fichier(projet_tmp: Projet):
    projet_tmp.appliquer_reponse(REPONSE)
    avant = (projet_tmp.dossier / "src/main/java/com/demo/App.java").read_text()
    md = (
        "```modif src/Inconnu.java\n<<<<<<< CHERCHER\na\n=======\nb\n>>>>>>> REMPLACER\n```\n"
        "```modif src/main/java/com/demo/App.java\n<<<<<<< CHERCHER\nabsent();\n=======\nb\n>>>>>>> REMPLACER\n```\n"
        "```modif src/main/java/com/demo/App.java\nrien\n```"
    )
    r = projet_tmp.appliquer_reponse(md)
    assert len(r.echecs) == 3 and not r.change
    assert "inconnu" in r.echecs[0] and "introuvable" in r.echecs[1] and "mal formé" in r.echecs[2]
    assert (projet_tmp.dossier / "src/main/java/com/demo/App.java").read_text() == avant


def test_jamais_d_ecriture_hors_du_projet(projet_tmp: Projet, tmp_path):
    dehors = tmp_path / "dehors"
    dehors.mkdir()
    os.symlink(dehors, projet_tmp.dossier / "lien")
    r = projet_tmp.appliquer_reponse("```txt lien/pirate.txt\nx\n```\n```txt ../evade.txt\nx\n```")
    assert not (dehors / "pirate.txt").exists() and not (tmp_path / "evade.txt").exists()
    assert r.echecs == ["lien/pirate.txt : chemin refusé"]
    assert projet_tmp.chemin_sur("../x") is None and projet_tmp.chemin_sur(".atelier/conversation.json") is None


def test_lister_ignore_sorties_et_binaires(projet_tmp: Projet):
    d = projet_tmp.dossier
    ecrire(d, "src/A.java", "class A {}")
    ecrire(d, "build/libs/x.txt", "sortie")
    ecrire(d, ".gradle/cache.txt", "cache")
    (d / "image.png").write_bytes(b"\x89PNG\x00\x01")
    assert projet_tmp.lister() == ["src/A.java"]


def test_bloc_etat_respecte_le_budget(projet_tmp: Projet):
    ecrire(projet_tmp.dossier, "petit.txt", "court")
    ecrire(projet_tmp.dossier, "gros.txt", "x" * 30_000)
    bloc = projet_tmp.bloc_etat(500)
    assert "```" in bloc and "court" in bloc
    assert "- gros.txt (30000 caractères, contenu omis" in bloc


def test_historique_et_empreinte(projet_tmp: Projet):
    projet_tmp.enregistrer_historique([{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "tool", "content": "x"}])
    assert projet_tmp.charger_historique() == [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]
    e1 = projet_tmp.empreinte()
    ecrire(projet_tmp.dossier, "a.txt", "1")
    assert projet_tmp.empreinte() != e1


def test_droits_des_fichiers_ecrits(projet_tmp: Projet):
    ancien = os.umask(0o022)
    try:
        projet_tmp.ecrire("a.txt", "x")
        assert (projet_tmp.dossier / "a.txt").stat().st_mode & 0o777 == 0o644
        os.chmod(projet_tmp.dossier / "a.txt", 0o755)
        projet_tmp.ecrire("a.txt", "y")
        assert (projet_tmp.dossier / "a.txt").stat().st_mode & 0o777 == 0o755  # droits existants conservés
    finally:
        os.umask(ancien)
