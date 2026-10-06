from atelier.fichiers import (
    appliquer_remplacement,
    chemin_depuis_info,
    extraire_fichiers,
    extraire_modifications,
    masquer_blocs,
    nettoyer_chemin,
    suppressions_demandees,
)


def test_conventions_de_chemin():
    md = "\n".join(
        [
            '```json title="fabric.mod.json"', '{"id":"m"}', "```",
            "**src/main/java/A.java**", "```java", "class A {}", "```",
            "### 1. `build.gradle` (corrigé)", "```groovy", "plugins {}", "```",
            "**Fichier : `src/B.java`**", "```java", "class B {}", "```",
            "```", "// src/main/resources/x.mixins.json", "{}", "```",
            "```bash", "./gradlew build", "```",
        ]
    )
    assert [f.chemin for f in extraire_fichiers(md)] == ["fabric.mod.json", "src/main/java/A.java", "build.gradle", "src/B.java", "src/main/resources/x.mixins.json"]


def test_info_de_bloc():
    assert chemin_depuis_info("java src/A.java") == ("java", "src/A.java")
    assert chemin_depuis_info("yaml:config/a.yml") == ("yaml", "config/a.yml")
    assert chemin_depuis_info("groovy build.gradle (inchangé)") == ("groovy", "build.gradle")
    assert chemin_depuis_info("python") == ("python", None)


def test_chemins_dangereux_refuses():
    for c in ["../x.txt", "/etc/passwd", "a//b.txt", "a/./b.txt", "a/../../b.txt", "a b.txt"]:
        assert nettoyer_chemin(c) is None, c
    md = "```txt ../../etc/passwd\nx\n```\n```txt .github/workflows/w.yml\nx\n```\n```txt gradlew\nx\n```\n```txt .git/config\nx\n```"
    assert extraire_fichiers(md) == []


def test_fence_externe_plus_longue():
    md = "\n".join(["````markdown README.md", "# T", "```bash", "gradle build", "```", "fin", "````"])
    (f,) = extraire_fichiers(md)
    assert f.chemin == "README.md" and "```bash" in f.contenu and "fin" in f.contenu


def test_blocs_modif():
    md = "```modif src/A.java\n<<<<<<< CHERCHER\nint v = 1;\n=======\nint v = 2;\n>>>>>>> REMPLACER\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n```"
    (m,) = extraire_modifications(md)
    assert m.chemin == "src/A.java" and m.remplacements == [("int v = 1;", "int v = 2;"), ("x", "y")]
    assert extraire_fichiers(md) == []  # un bloc modif n'est jamais un fichier entier


def test_appliquer_remplacement_tolerances():
    contenu = "class A {\n    void f() {\n        int v = 1;   \n        g();\n    }\n}\n"
    assert "int v = 2;" in appliquer_remplacement(contenu, "        int v = 1;   ", "        int v = 2;")
    assert "int v = 3;" in appliquer_remplacement(contenu, "int v = 1;", "int v = 3;")  # espaces de fin
    r = appliquer_remplacement(contenu, "int v = 1;\ng();", "int v = 4;\nh();")  # indentation différente
    assert "        int v = 4;\n        h();" in r
    assert appliquer_remplacement(contenu, "absent()", "x") is None
    assert appliquer_remplacement(contenu, "  ", "x") is None


def test_suppressions_et_masquage():
    assert suppressions_demandees("Supprimer : src/Vieux.java\n- Supprimer : `b.txt`\nSupprimer : ../x") == ["src/Vieux.java", "b.txt"]
    md = "Voici :\n```java src/A.java\nclass A {}\n```\nFin."
    assert masquer_blocs(md, {"src/A.java"}) == "Voici :\n[fichier `src/A.java` : voir l'état du projet]\nFin."
    assert masquer_blocs(md, set()) == md


def test_marqueurs_nus_acceptes():
    md = "```modif src/A.java\n<<<<<<<\nint v = 1;\n=======\nint v = 2;\n>>>>>>>\n```"
    (m,) = extraire_modifications(md)
    assert m.remplacements == [("int v = 1;", "int v = 2;")]


def test_separateur_en_trop_avant_la_fin_ignore():
    """Cas réel (NVIDIA) : « ======= » répété juste avant >>>>>>> REMPLACER, qui corrompait le fichier."""
    from atelier.fichiers import lire_paires

    corps = "<<<<<<< CHERCHER\nancien();\n=======\nnouveau();\n=======\n>>>>>>> REMPLACER"
    assert lire_paires(corps) == [("ancien();", "nouveau();")]
