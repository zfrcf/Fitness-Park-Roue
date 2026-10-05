"""Moteur de conversation de l'atelier : un tour = prompt (état du projet sur disque + historique)
→ réponse du modèle (rotation des fournisseurs) → fichiers écrits / modifiés dans le dossier
→ compilation locale éventuelle → correction en boucle à partir du journal d'erreurs.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

from . import minecraft
from .config import Fournisseur, Reglages
from .fichiers import masquer_blocs
from .fournisseurs import Reponse, Rotation, discuter
from .gradle import ResultatCompilation, compiler
from .projet import Projet, Rapport, estimer_tokens

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]

INSTRUCTION_MODIFICATIONS = (
    "Pour un changement localisé dans un fichier existant, n'écris pas le fichier entier : utilise un bloc de modification "
    "```modif chemin/du/fichier contenant une ou plusieurs paires exactes :\n"
    "<<<<<<< CHERCHER\n(lignes existantes, copiées à l'identique, assez longues pour être uniques)\n=======\n(nouvelles lignes)\n>>>>>>> REMPLACER\n"
    "Le texte CHERCHER doit exister tel quel dans le fichier (indentation comprise). Renvoie un fichier EN ENTIER seulement s'il est "
    "nouveau ou presque entièrement réécrit."
)


def date_du_jour() -> str:
    t = time.localtime()
    return f"{JOURS[t.tm_wday]} {t.tm_mday} {MOIS[t.tm_mon - 1]} {t.tm_year}"


def systeme_base() -> str:
    return (
        "Tu es un développeur expert qui travaille dans l'« atelier IA local » de l'utilisateur, sur son ordinateur Ubuntu. "
        "Tu réponds en français. "
        f"Nous sommes le {date_du_jour()} ; tes connaissances s'arrêtent avant : pour les versions récentes (jeux, bibliothèques), "
        "appuie-toi sur le contexte fourni ou dis ce que tu n'as pas pu vérifier.\n\n"
        "Les fichiers que tu produis sont ÉCRITS DIRECTEMENT dans le dossier du projet de l'utilisateur. Écris chaque fichier dans son "
        "propre bloc de code avec son chemin relatif complet sur la ligne d'ouverture, par exemple ```java src/main/java/com/exemple/App.java "
        "ou ```json src/main/resources/fabric.mod.json. Livre des projets complets et cohérents (pas de « … » ni de « à compléter »). "
        + INSTRUCTION_MODIFICATIONS
        + " Pour supprimer un fichier, écris une ligne « Supprimer : chemin ».\n\n"
        "Compilation : l'atelier lance « gradle build » en local dans le dossier du projet (Gradle et le JDK sont déjà installés : "
        "ne fournis jamais gradlew ni gradle-wrapper). Après chaque réponse qui change un projet Gradle, la compilation est lancée "
        "automatiquement et, en cas d'échec, le journal d'erreurs t'est renvoyé : corrige alors la cause en ne touchant qu'aux "
        "fichiers concernés. Personne ne répondra à une question pendant une correction automatique : si tu hésites sur une API, "
        "choisis la plus probable et livre la correction."
    )


def texte_correction(journal: str) -> str:
    return (
        "La compilation locale (gradle build) a échoué. Corrige le projet. "
        + INSTRUCTION_MODIFICATIONS
        + f" Journal :\n\n```text\n{journal}\n```"
    )


@dataclass
class Tour:
    reponse: Reponse
    rapport: Rapport


class Session:
    def __init__(
        self,
        projet: Projet,
        fournisseurs: list[Fournisseur],
        reglages: Reglages,
        *,
        sur_texte: Callable[[str], None] | None = None,
        sur_raisonnement: Callable[[str], None] | None = None,
        sur_info: Callable[[str], None] | None = None,
        sur_compilation: Callable[[str], None] | None = None,
        client=None,
    ):
        self.projet = projet
        self.reglages = reglages
        self.rotation = Rotation(fournisseurs)
        self.historique: list[dict] = projet.charger_historique()
        self.sur_texte = sur_texte
        self.sur_raisonnement = sur_raisonnement
        self.sur_info = sur_info or (lambda _m: None)
        self.sur_compilation = sur_compilation
        self.echecs_dernier: list[str] = []
        self.tokens = {"entree": 0, "sortie": 0}
        self.client = client  # httpx.Client injectable (tests)

    # ------------------------------------------------------------------ contexte

    def _contexte_min(self) -> int:
        dispo = self.rotation.disponibles() or self.rotation.fournisseurs
        return min((f.contexte for f in dispo), default=32_000)

    def _sortie_max(self) -> int:
        return min(self.reglages.max_tokens, max(1024, int(self._contexte_min() * 0.35)))

    def construire_messages(self) -> list[dict]:
        contexte = self._contexte_min()
        budget_entree = max(4000, contexte - self._sortie_max() - 1500)
        systeme = systeme_base()
        chemins = set(self.projet.lister())
        if chemins:
            etat = self.projet.bloc_etat(int(budget_entree * 0.45))
            systeme += (
                "\n\nÉtat ACTUEL du projet sur le disque (c'est la seule version qui compte ; les blocs de code de tes réponses "
                "précédentes ont été remplacés par des renvois) :\n" + etat
            )
        textes = [m["content"] for m in self.historique[-8:]]
        if self.projet.est_gradle() or minecraft.concerne_mod(textes):
            if minecraft.concerne_mod(textes) or self.projet.lire("src/main/resources/fabric.mod.json"):
                try:
                    version = minecraft.version_depuis_projet(self.projet.lire)
                    if not version:
                        users = [m["content"] for m in self.historique if m["role"] == "user"]
                        version = next((v for v in (minecraft.extraire_version(t) for t in reversed(users)) if v), None)
                    v = minecraft.versions(version)
                    systeme += "\n\n" + minecraft.bloc_contexte(v, minecraft.detecter_loader(textes))
                except Exception as e:  # le contexte Minecraft est un bonus : jamais bloquant
                    self.sur_info(f"contexte Minecraft indisponible : {e}")
        if self.echecs_dernier:
            systeme += (
                "\n\nATTENTION : dans ta dernière réponse, ces modifications n'ont PAS pu être appliquées (le texte CHERCHER ne "
                "correspondait pas exactement au fichier) :\n" + "\n".join(f"- {e}" for e in self.echecs_dernier)
                + "\nRenvoie ces fichiers EN ENTIER (ou refais la modification avec un texte CHERCHER copié à l'identique)."
            )
        # Historique : les fichiers déjà dans le projet sont remplacés par des renvois, puis on garde
        # le premier message (l'objectif) et les plus récents qui tiennent dans le budget.
        msgs = [
            {"role": m["role"], "content": masquer_blocs(m["content"], chemins) if m["role"] == "assistant" else m["content"]}
            for m in self.historique
        ]
        reste = budget_entree - estimer_tokens(systeme)
        garde: list[dict] = []
        for m in reversed(msgs[1:]):
            t = estimer_tokens(m["content"])
            if t > reste:
                break
            garde.insert(0, m)
            reste -= t
        if msgs:
            premier = dict(msgs[0])
            if estimer_tokens(premier["content"]) > max(reste, 1500):
                premier["content"] = premier["content"][: max(reste, 1500) * 3] + "\n[… message tronqué …]"
            if len(garde) < len(msgs) - 1:
                garde.insert(0, {"role": "user", "content": "[… messages intermédiaires omis faute de place …]"})
                garde.insert(1, {"role": "assistant", "content": "D'accord."})
            garde.insert(0, premier)
        # L'API exige l'alternance user/assistant et un dernier message utilisateur.
        return [{"role": "system", "content": systeme}, *_alterner(garde)]

    # ------------------------------------------------------------------ tours

    def tour(self, texte: str) -> Tour:
        self.historique.append({"role": "user", "content": texte})
        self.projet.enregistrer_historique(self.historique)
        reponse = discuter(
            self.rotation,
            self.construire_messages(),
            temperature=self.reglages.temperature,
            max_tokens=self._sortie_max(),
            raisonnement=self.reglages.raisonnement,
            sur_texte=self.sur_texte,
            sur_raisonnement=self.sur_raisonnement,
            sur_info=self.sur_info,
            client=self.client,
        )
        self.tokens["entree"] += reponse.entree
        self.tokens["sortie"] += reponse.sortie
        rapport = Rapport()
        if reponse.texte.strip():
            self.historique.append({"role": "assistant", "content": reponse.texte})
            self.projet.enregistrer_historique(self.historique)
            rapport = self.projet.appliquer_reponse(reponse.texte)
            self.echecs_dernier = list(rapport.echecs)
        return Tour(reponse, rapport)

    def annuler_dernier(self) -> bool:
        """Retire le dernier échange de l'historique (les fichiers déjà écrits restent sur le disque)."""
        if not self.historique:
            return False
        if self.historique[-1]["role"] == "assistant":
            self.historique.pop()
        if self.historique and self.historique[-1]["role"] == "user":
            self.historique.pop()
        self.projet.enregistrer_historique(self.historique)
        return True

    # ------------------------------------------------------------------ compilation

    def compiler(self) -> ResultatCompilation:
        r = compiler(self.projet.dossier, sortie=self.sur_compilation)
        etat = self.projet.lire_etat()
        etat["derniere_compilation"] = {"ok": r.ok, "a": time.time(), "duree": round(r.duree, 1), "jars": [str(j) for j in r.jars]}
        etat["empreinte_compilee"] = self.projet.empreinte()
        self.projet.ecrire_etat(etat)
        return r

    def doit_compiler(self, rapport: Rapport) -> bool:
        """Compilation automatique : le projet est Gradle, la réponse l'a changé, et cet état n'a pas déjà été compilé."""
        if not (self.reglages.compilation_auto and rapport.change and self.projet.est_gradle()):
            return False
        return self.projet.lire_etat().get("empreinte_compilee") != self.projet.empreinte()

    def corriger_en_boucle(
        self,
        max_corrections: int,
        avant_compilation: Callable[[int], None] | None = None,
        apres_compilation: Callable[[ResultatCompilation, int], None] | None = None,
        avant_correction: Callable[[int], None] | None = None,
        apres_correction: Callable[[Tour], None] | None = None,
        plafond_tokens: int = 2_000_000,
    ) -> ResultatCompilation:
        """Compile, et tant que ça échoue, renvoie le journal au modèle et applique sa correction.
        max_corrections = 0 : sans limite (borné par le plafond de tokens). Un projet inchangé
        n'est jamais recompilé : le modèle est relancé une fois, puis la boucle s'arrête."""
        n = 0
        while True:
            if avant_compilation:
                avant_compilation(n)
            r = self.compiler()
            if apres_compilation:
                apres_compilation(r, n)
            if r.ok:
                return r
            consigne = texte_correction(r.resume)
            for essai in range(2):
                if max_corrections and n >= max_corrections:
                    return r
                if self.tokens["entree"] + self.tokens["sortie"] > plafond_tokens:
                    self.sur_info(f"plafond de {plafond_tokens:,} tokens atteint : arrêt des corrections".replace(",", " "))
                    return r
                n += 1
                if avant_correction:
                    avant_correction(n)
                t = self.tour(consigne)
                if apres_correction:
                    apres_correction(t)
                if t.reponse.erreur and not t.reponse.texte:
                    self.sur_info(f"correction impossible : {t.reponse.erreur}")
                    return r
                if t.rapport.change:
                    break
                if essai == 1:
                    self.sur_info("le modèle ne modifie plus aucun fichier : arrêt des corrections")
                    return r
                consigne = (
                    "Ta réponse ne modifiait aucun fichier du projet, donc la compilation échouerait de la même façon. "
                    "Livre la correction maintenant, sous forme de blocs de code complets ou de blocs ```modif."
                )


def _alterner(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        if out and out[-1]["role"] == m["role"]:
            out[-1] = {"role": m["role"], "content": out[-1]["content"] + "\n\n" + m["content"]}
        else:
            out.append(dict(m))
    while out and out[0]["role"] == "assistant":
        out.pop(0)
    return out
