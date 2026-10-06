"""Interface en ligne de commande de l'atelier IA local.

  atelier                      choisir ou créer un projet, puis discuter
  atelier nouveau NOM          créer un projet (dans ~/AtelierProjets) et discuter
  atelier ouvrir [DOSSIER]     discuter sur un dossier existant (par défaut : le dossier courant)
  atelier demander "TEXTE"     un seul tour, sans interaction (scripts)
  atelier build [DOSSIER]      gradle build local (+ --corriger N pour corriger en boucle)
  atelier installer            installer JDK 25 et Gradle 9.7.1 (sans sudo)
  atelier config               configurer les fournisseurs IA (clés API)
  atelier doctor               vérifier l'installation
  atelier tester               tester chaque fournisseur
  atelier projets              lister les projets
  atelier ui                   ouvrir l'application de bureau (la même interface que la version web)
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table

from . import __version__
from .chat import Session, Tour
from .config import (
    GRADLE_VERSION,
    JDK_VERSION,
    charger_fournisseurs,
    charger_reglages,
    ecrire_env,
    fichier_config,
    importer_env,
    lire_env,
)
from .fournisseurs import Annule, ErreurFournisseur, Rotation, est_degenere, tenter
from .gradle import ResultatCompilation, trouver_chaine
from .projet import Projet, Rapport

console = Console(highlight=False)

AIDE_REPL = """[bold]Commandes[/bold] (le reste est envoyé au modèle) :
  [cyan]/build[/cyan]              compiler maintenant (gradle build)
  [cyan]/auto [N][/cyan]           compiler et corriger en boucle jusqu'au jar (N corrections max, 0 = sans limite)
  [cyan]/compilauto on|off[/cyan]  compilation automatique après chaque réponse qui change le projet
  [cyan]/fichiers[/cyan]           lister les fichiers du projet
  [cyan]/jar[/cyan]                afficher le(s) jar(s) produit(s)
  [cyan]/journal[/cyan]            afficher le journal complet de la dernière compilation
  [cyan]/ouvrir[/cyan]             ouvrir le dossier du projet dans le gestionnaire de fichiers
  [cyan]/annuler[/cyan]            oublier le dernier échange (les fichiers restent sur le disque)
  [cyan]/raisonnement N[/cyan]     aucun | faible | moyen | eleve
  [cyan]/modele[/cyan]             fournisseurs et état de la rotation
  [cyan]/effacer[/cyan]            vider l'historique de conversation (garde les fichiers)
  [cyan]/quitter[/cyan]            quitter (ou Ctrl+D)
Message sur plusieurs lignes : tapez [cyan]\"\"\"[/cyan], collez le texte, puis [cyan]\"\"\"[/cyan] sur une ligne seule.
Ctrl+C interrompt la génération ou la compilation en cours."""


# --------------------------------------------------------------------------- affichage


class Affichage:
    """Rendu en direct d'un tour : texte du modèle, raisonnement discret, infos de rotation."""

    def __init__(self) -> None:
        self.en_raisonnement = False
        self.texte_commence = False

    def texte(self, morceau: str) -> None:
        if self.en_raisonnement:
            console.print()
            self.en_raisonnement = False
        self.texte_commence = True
        console.out(morceau, end="", highlight=False)

    def raisonnement(self, _morceau: str) -> None:
        if not self.en_raisonnement and not self.texte_commence:
            console.print("[dim]… réflexion en cours[/dim]", end="")
            self.en_raisonnement = True

    def info(self, message: str) -> None:
        if self.texte_commence or self.en_raisonnement:
            console.print()
            self.texte_commence = self.en_raisonnement = False
        console.print(f"[yellow]↻ {message}[/yellow]")


def afficher_rapport(rapport: Rapport) -> None:
    if not (rapport.change or rapport.echecs):
        return
    t = Table.grid(padding=(0, 1))
    for c in rapport.ecrits:
        t.add_row("[green]écrit[/green]", c)
    for c in rapport.modifies:
        t.add_row("[cyan]modifié[/cyan]", c)
    for c in rapport.supprimes:
        t.add_row("[red]supprimé[/red]", c)
    for e in rapport.echecs:
        t.add_row("[yellow]non appliqué[/yellow]", e)
    console.print(Panel(t, title="Fichiers", title_align="left", border_style="dim"))


def afficher_compilation(r: ResultatCompilation) -> None:
    if r.ok:
        jars = "\n".join(f"  [bold green]{j}[/bold green]" for j in r.jars) or "  (aucun jar dans build/libs)"
        console.print(Panel(f"BUILD SUCCESSFUL en {r.duree:.0f} s\n{jars}", title="✔ Compilation réussie", border_style="green", title_align="left"))
    else:
        console.print(Panel(r.resume or "(journal vide)", title=f"✘ Compilation échouée ({r.duree:.0f} s)", border_style="red", title_align="left"))


def compiler_avec_statut(session: Session) -> ResultatCompilation:
    with console.status("[bold]gradle build[/bold] …", spinner="dots") as statut:
        def sortie(ligne: str) -> None:
            if ligne.strip():
                statut.update(f"[bold]gradle build[/bold] [dim]{ligne.strip()[:110]}[/dim]")

        session.sur_compilation = sortie
        return session.compiler()


def boucle_correction(session: Session, max_corrections: int) -> ResultatCompilation:
    def avant_compilation(n: int) -> None:
        console.print(f"[bold]▶ Compilation{f' après la correction {n}' if n else ''}[/bold]")

    def apres_compilation(r: ResultatCompilation, _n: int) -> None:
        afficher_compilation(r)

    def avant_correction(n: int) -> None:
        limite = f"/{max_corrections}" if max_corrections else " (sans limite)"
        console.print(f"[bold magenta]▶ Correction {n}{limite}[/bold magenta] : le journal est envoyé au modèle")

    aff = Affichage()

    def apres_correction(t: Tour) -> None:
        console.print()
        afficher_rapport(t.rapport)

    session.sur_texte, session.sur_raisonnement, session.sur_info = aff.texte, aff.raisonnement, aff.info
    with_statut = {"statut": None}

    def sortie(ligne: str) -> None:
        if with_statut["statut"] and ligne.strip():
            with_statut["statut"].update(f"[bold]gradle build[/bold] [dim]{ligne.strip()[:110]}[/dim]")

    session.sur_compilation = sortie
    original = session.compiler

    def compiler_statut() -> ResultatCompilation:
        with console.status("[bold]gradle build[/bold] …", spinner="dots") as s:
            with_statut["statut"] = s
            try:
                return original()
            finally:
                with_statut["statut"] = None

    session.compiler = compiler_statut  # type: ignore[method-assign]
    try:
        return session.corriger_en_boucle(max_corrections, avant_compilation, apres_compilation, avant_correction, apres_correction)
    finally:
        session.compiler = original  # type: ignore[method-assign]


# --------------------------------------------------------------------------- session interactive


def preparer_session(projet: Projet) -> Session | None:
    fournisseurs, problemes = charger_fournisseurs()
    for p in problemes:
        console.print(f"[yellow]Fournisseur ignoré : {p}[/yellow]")
    if not fournisseurs:
        console.print("[red]Aucun fournisseur IA configuré.[/red] Lancez [bold]atelier config[/bold] pour ajouter une clé API.")
        return None
    return Session(projet, fournisseurs, charger_reglages())


def lire_message() -> str | None:
    try:
        ligne = input("\n\001\033[1;34m\002vous ›\001\033[0m\002 ")
    except EOFError:
        return None
    if ligne.strip() == '"""':
        lignes: list[str] = []
        while True:
            try:
                l = input()
            except EOFError:
                break
            if l.strip() == '"""':
                break
            lignes.append(l)
        return "\n".join(lignes)
    return ligne


def tour_interactif(session: Session, texte: str) -> None:
    aff = Affichage()
    session.sur_texte, session.sur_raisonnement, session.sur_info = aff.texte, aff.raisonnement, aff.info
    console.print("[bold green]modèle ›[/bold green] ", end="")
    try:
        t = session.tour(texte)
    except (Annule, KeyboardInterrupt):
        console.print("\n[yellow]Réponse interrompue.[/yellow]")
        if session.historique and session.historique[-1]["role"] == "user":
            session.historique.pop()
            session.projet.enregistrer_historique(session.historique)
        return
    console.print()
    r = t.reponse
    if r.erreur:
        console.print(f"[red]{r.erreur}[/red]")
    if r.fournisseur:
        console.print(f"[dim]{r.fournisseur.nom} · {r.fournisseur.modele} · {r.entree} → {r.sortie} tokens[/dim]")
    afficher_rapport(t.rapport)
    if session.doit_compiler(t.rapport):
        try:
            res = compiler_avec_statut(session)
        except KeyboardInterrupt:
            console.print("[yellow]Compilation interrompue.[/yellow]")
            return
        afficher_compilation(res)
        n = session.reglages.corrections_max
        if not res.ok and n > 0:
            console.print(f"[magenta]Correction automatique (jusqu'à {n} essais ; Ctrl+C pour arrêter).[/magenta]")
            try:
                boucle_correction_depuis_echec(session, res, n)
            except (Annule, KeyboardInterrupt):
                console.print("\n[yellow]Correction interrompue.[/yellow]")


def boucle_correction_depuis_echec(session: Session, echec: ResultatCompilation, n: int) -> None:
    # La compilation vient d'échouer : on enchaîne directement sur les corrections.
    from .chat import texte_correction

    aff = Affichage()
    session.sur_texte, session.sur_raisonnement, session.sur_info = aff.texte, aff.raisonnement, aff.info
    console.print("[bold magenta]▶ Correction 1[/bold magenta] : le journal est envoyé au modèle")
    console.print("[bold green]modèle ›[/bold green] ", end="")
    t = session.tour(texte_correction(echec.resume))
    console.print()
    afficher_rapport(t.rapport)
    if not t.rapport.change:
        console.print("[yellow]La correction ne modifie aucun fichier.[/yellow]")
        return
    if n > 1:
        boucle_correction(session, n - 1)
    else:
        afficher_compilation(compiler_avec_statut(session))


def commande(session: Session, ligne: str) -> bool:
    """Exécute une commande /…. Renvoie False pour quitter."""
    parties = ligne.strip().split()
    cmd, args = parties[0].lower(), parties[1:]
    p = session.projet
    if cmd in ("/quitter", "/q", "/exit", "/quit"):
        return False
    if cmd in ("/aide", "/help", "/?"):
        console.print(AIDE_REPL)
    elif cmd == "/build":
        if not p.est_gradle():
            console.print("[yellow]Pas de build.gradle / settings.gradle à la racine du projet.[/yellow]")
        else:
            try:
                afficher_compilation(compiler_avec_statut(session))
            except KeyboardInterrupt:
                console.print("[yellow]Compilation interrompue.[/yellow]")
    elif cmd == "/auto":
        n = int(args[0]) if args and args[0].isdigit() else 0
        if not p.est_gradle():
            console.print("[yellow]Pas de projet Gradle à compiler.[/yellow]")
        else:
            try:
                r = boucle_correction(session, n)
                console.print("[bold green]Terminé : le jar est prêt.[/bold green]" if r.ok else "[bold red]Arrêt sans compilation réussie.[/bold red]")
            except (Annule, KeyboardInterrupt):
                console.print("\n[yellow]Boucle interrompue.[/yellow]")
    elif cmd == "/compilauto":
        if args and args[0].lower() in ("on", "oui", "1", "off", "non", "0"):
            session.reglages.compilation_auto = args[0].lower() in ("on", "oui", "1")
        console.print(f"Compilation automatique : [bold]{'activée' if session.reglages.compilation_auto else 'désactivée'}[/bold]")
    elif cmd == "/fichiers":
        fichiers = p.lister()
        console.print("\n".join(f"  {f}" for f in fichiers) or "  (projet vide)")
        console.print(f"[dim]{len(fichiers)} fichier(s) dans {p.dossier}[/dim]")
    elif cmd == "/jar":
        from .gradle import trouver_jars

        jars = trouver_jars(p.dossier)
        console.print("\n".join(f"  [green]{j}[/green]" for j in jars) or "  aucun jar : lancez /build")
    elif cmd == "/journal":
        j = p.meta / "derniere-compilation.log"
        console.print(j.read_text(encoding="utf-8") if j.exists() else "Aucune compilation pour l'instant.")
    elif cmd == "/ouvrir":
        subprocess.Popen(["xdg-open", str(p.dossier)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif cmd == "/annuler":
        console.print("Dernier échange oublié." if session.annuler_dernier() else "Rien à annuler.")
    elif cmd == "/effacer":
        if Confirm.ask("Vider l'historique de conversation (les fichiers restent) ?", default=False):
            session.historique = []
            p.enregistrer_historique([])
            console.print("Historique vidé.")
    elif cmd == "/raisonnement":
        if args and args[0] in ("aucun", "faible", "moyen", "eleve"):
            session.reglages.raisonnement = args[0]
        console.print(f"Raisonnement : [bold]{session.reglages.raisonnement}[/bold]")
    elif cmd == "/modele":
        afficher_fournisseurs(session.rotation)
    else:
        console.print(f"Commande inconnue : {cmd} (tapez /aide)")
    return True


def afficher_fournisseurs(rotation: Rotation) -> None:
    t = Table("Rang", "Fournisseur", "Modèle", "Contexte", "État")
    for f in rotation.fournisseurs:
        jusqua, raison = rotation.ecartes.get(f.id, (0.0, ""))
        etat = f"[yellow]écarté jusqu'à {time.strftime('%H:%M', time.localtime(jusqua))}[/yellow] {raison[:60]}" if jusqua > time.time() else "[green]disponible[/green]"
        t.add_row(str(f.rang), f.nom, f.modele, f"{f.contexte:,}".replace(",", " "), etat)
    console.print(t)


def boucle_interactive(projet: Projet) -> int:
    session = preparer_session(projet)
    if not session:
        return 1
    try:
        import readline  # noqa: F401  (historique et édition de la ligne de saisie)

        hist = projet.meta / "saisies.txt"
        try:
            readline.read_history_file(hist)
        except OSError:
            pass
    except ImportError:
        hist = None
    chaine = trouver_chaine()
    console.print(
        Panel(
            f"[bold]{projet.nom}[/bold]  [dim]{projet.dossier}[/dim]\n"
            f"{len(projet.lister())} fichier(s) · {len(session.historique)} message(s) · compilation auto "
            f"{'[green]activée[/green]' if session.reglages.compilation_auto else '[yellow]désactivée[/yellow]'}"
            f"{'' if chaine.complete else ' · [red]JDK/Gradle absents : atelier installer[/red]'}\n"
            "[dim]/aide pour les commandes · Ctrl+D pour quitter[/dim]",
            title=f"Atelier IA local {__version__}",
            title_align="left",
            border_style="blue",
        )
    )
    try:
        while True:
            texte = lire_message()
            if texte is None:
                console.print()
                break
            if not texte.strip():
                continue
            if texte.strip().startswith("/"):
                if not commande(session, texte):
                    break
                continue
            tour_interactif(session, texte)
    except KeyboardInterrupt:
        console.print()
    finally:
        if hist is not None:
            try:
                import readline

                hist.parent.mkdir(parents=True, exist_ok=True)
                readline.write_history_file(hist)
            except OSError:
                pass
    return 0


# --------------------------------------------------------------------------- sous-commandes


def _nom_valide(nom: str) -> str:
    propre = re.sub(r"[^\w.-]+", "-", nom.strip()).strip("-.")
    if not propre:
        raise SystemExit("Nom de projet invalide.")
    return propre


def cmd_nouveau(a: argparse.Namespace) -> int:
    reglages = charger_reglages()
    dossier = Path.cwd() if a.ici else reglages.dossier_projets / _nom_valide(a.nom)
    projet = Projet(dossier)
    projet.creer()
    console.print(f"Projet prêt : [bold]{projet.dossier}[/bold]")
    return boucle_interactive(projet)


def cmd_ouvrir(a: argparse.Namespace) -> int:
    dossier = Path(a.dossier or ".").expanduser()
    if not dossier.is_dir():
        candidat = charger_reglages().dossier_projets / a.dossier
        if a.dossier and candidat.is_dir():
            dossier = candidat
        else:
            console.print(f"[red]Dossier introuvable : {dossier}[/red]")
            return 1
    projet = Projet(dossier)
    projet.creer()
    return boucle_interactive(projet)


def lister_projets() -> list[Projet]:
    racine = charger_reglages().dossier_projets
    if not racine.is_dir():
        return []
    projets = [Projet(d) for d in racine.iterdir() if d.is_dir() and (d / ".atelier").is_dir()]
    return sorted(projets, key=lambda p: p.meta.stat().st_mtime, reverse=True)


def cmd_projets(_a: argparse.Namespace) -> int:
    projets = lister_projets()
    if not projets:
        console.print("Aucun projet. Créez-en un : [bold]atelier nouveau mon-mod[/bold]")
        return 0
    t = Table("N°", "Projet", "Fichiers", "Dernière activité", "Dernière compilation")
    for i, p in enumerate(projets, 1):
        dc = p.lire_etat().get("derniere_compilation")
        etat = ("[green]réussie[/green]" if dc["ok"] else "[red]échouée[/red]") if dc else "-"
        t.add_row(str(i), p.nom, str(len(p.lister())), time.strftime("%d/%m %H:%M", time.localtime(p.meta.stat().st_mtime)), etat)
    console.print(t)
    return 0


def cmd_accueil(_a: argparse.Namespace) -> int:
    if (Path.cwd() / ".atelier").is_dir():
        return boucle_interactive(Projet(Path.cwd()))
    if not fichier_config().exists():
        console.print("[bold]Bienvenue ![/bold] Première utilisation : configurons un fournisseur IA.")
        cmd_config(argparse.Namespace(importer=None, afficher=False, regler=None))
    projets = lister_projets()
    if projets:
        cmd_projets(_a)
        choix = Prompt.ask("Numéro du projet à ouvrir, ou nom d'un nouveau projet", default="1")
        if choix.isdigit() and 1 <= int(choix) <= len(projets):
            return boucle_interactive(projets[int(choix) - 1])
        return cmd_nouveau(argparse.Namespace(nom=choix, ici=False))
    nom = Prompt.ask("Nom du nouveau projet", default="mon-projet")
    return cmd_nouveau(argparse.Namespace(nom=nom, ici=False))


def cmd_demander(a: argparse.Namespace) -> int:
    projet = Projet(Path(a.dossier).expanduser() if a.dossier else Path.cwd())
    projet.creer()
    session = preparer_session(projet)
    if not session:
        return 1
    if a.sans_compilation:
        session.reglages.compilation_auto = False
    texte = a.texte if a.texte != "-" else sys.stdin.read()
    aff = Affichage()
    session.sur_texte, session.sur_raisonnement, session.sur_info = aff.texte, aff.raisonnement, aff.info
    t = session.tour(texte)
    console.print()
    if t.reponse.erreur:
        console.print(f"[red]{t.reponse.erreur}[/red]")
    afficher_rapport(t.rapport)
    if session.doit_compiler(t.rapport):
        r = boucle_correction(session, a.corriger) if a.corriger is not None else compiler_avec_statut(session)
        if a.corriger is None:
            afficher_compilation(r)
        return 0 if r.ok else 2
    return 1 if t.reponse.erreur else 0


def cmd_build(a: argparse.Namespace) -> int:
    projet = Projet(Path(a.dossier).expanduser() if a.dossier else Path.cwd())
    if not projet.est_gradle():
        console.print(f"[red]Pas de projet Gradle dans {projet.dossier}[/red]")
        return 1
    projet.creer()
    if a.corriger is not None:
        session = preparer_session(projet)
        if not session:
            return 1
        r = boucle_correction(session, a.corriger)
    else:
        from .gradle import compiler

        if a.verbeux:
            r = compiler(projet.dossier, sortie=lambda l: console.out(l, highlight=False))
        else:
            with console.status("[bold]gradle build[/bold] …") as s:
                r = compiler(projet.dossier, sortie=lambda l: l.strip() and s.update(f"[bold]gradle build[/bold] [dim]{l.strip()[:110]}[/dim]"))
        afficher_compilation(r)
    return 0 if r.ok else 2


def cmd_installer(a: argparse.Namespace) -> int:
    from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TransferSpeedColumn

    from .installation import ErreurInstallation, installer_gradle, installer_jdk

    with Progress(TextColumn("{task.description}"), BarColumn(), DownloadColumn(), TransferSpeedColumn(), console=console) as prog:
        taches: dict[str, int] = {}

        def progression(libelle: str, recu: int, total: int) -> None:
            if libelle not in taches:
                taches[libelle] = prog.add_task(libelle, total=total or None)
            prog.update(taches[libelle], completed=recu)

        try:
            jdk = installer_jdk(progression, forcer=a.forcer)
            gradle = installer_gradle(progression, forcer=a.forcer)
        except (ErreurInstallation, OSError) as e:
            console.print(f"[red]Installation impossible : {e}[/red]")
            return 1
    console.print(f"[green]✔ JDK {JDK_VERSION}[/green] : {jdk.resolve()}")
    console.print(f"[green]✔ Gradle {GRADLE_VERSION}[/green] : {gradle.resolve()}")
    # Le diagnostic est informatif ici : des clés pas encore configurées ne sont pas un échec d'installation.
    cmd_doctor(a)
    return 0


def _barre_progression():
    from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn, TransferSpeedColumn

    prog = Progress(TextColumn("{task.description}"), BarColumn(), DownloadColumn(), TransferSpeedColumn(), console=console)
    taches: dict[str, int] = {}

    def progression(libelle: str, recu: int, total: int) -> None:
        if libelle not in taches:
            taches[libelle] = prog.add_task(libelle, total=total or None)
        prog.update(taches[libelle], completed=recu)

    return prog, progression


def cmd_ui(a: argparse.Namespace) -> int:
    from . import ui
    from .installation import ErreurInstallation

    try:
        if a.arreter:
            console.print("[green]✔ Serveur arrêté.[/green]" if ui.arreter() else "Le serveur ne tournait pas.")
            return 0
        if ui.trouver_node() is None:
            prog, progression = _barre_progression()
            with prog:
                ui.installer_node(progression)
        if a.reconstruire:
            depot = Path(a.reconstruire).expanduser().resolve() if isinstance(a.reconstruire, str) else ui.ICI.parent.parent
            ui.arreter()
            console.print(f"Construction de l'application depuis {depot} (plusieurs minutes)…")
            ui.construire_depuis_sources(depot, ui.trouver_node())  # type: ignore[arg-type]
            console.print("[green]✔ Application reconstruite.[/green]")
        if ui.trouver_app() is None:
            console.print("[red]Application graphique absente.[/red] Relancez l'installation depuis l'archive : python3 installer.py")
            return 1
        raccourci = ui.creer_raccourci()
        veut_bureau = not a.navigateur and (a.preparer or os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        if veut_bureau and ui.trouver_electron() is None:
            console.print("Installation de l'application de bureau (Electron, une seule fois)…")
            prog, progression = _barre_progression()
            with prog:
                ui.installer_electron(progression)
        if a.preparer:
            console.print(f"[green]✔ Node[/green] : {ui.trouver_node()}")
            console.print(f"[green]✔ Application de bureau[/green] : Electron {ui.ELECTRON_VERSION} ({ui.trouver_electron()})")
            console.print(f"[green]✔ Entrée de menu[/green] : {raccourci} (« Atelier IA » dans vos applications)")
            return 0
        if a.redemarrer:
            ui.arreter()
        with console.status("[bold]Démarrage de l'interface…[/bold]"):
            etat, comment = ui.assurer_serveur(a.port)
    except (ErreurInstallation, OSError, subprocess.CalledProcessError) as e:
        console.print(f"[red]Interface impossible à lancer : {e}[/red]")
        return 1
    message = {"deja": "déjà démarrée", "demarre": "démarrée", "redemarre": "redémarrée (configuration ou version changée)"}[comment]
    console.print(f"[green]✔ Interface {message}[/green] : [bold]{etat.url}[/bold]")
    if not a.sans_fenetre:
        try:
            ouvert = ui.ouvrir_fenetre(etat.url, navigateur=a.navigateur)
        except (ErreurInstallation, OSError) as e:
            console.print(f"[yellow]Application de bureau impossible à ouvrir ({e}) : ouverture dans le navigateur.[/yellow]")
            ouvert = ui.ouvrir_fenetre(etat.url, navigateur=True)
        console.print(f"  Fenêtre : {ouvert}. Si rien ne s'ouvre, collez l'adresse dans votre navigateur.")
    console.print("  Arrêter : [bold]atelier ui --arreter[/bold]   ·   Journal : " + str(ui.fichier_journal()))
    return 0


def cmd_doctor(_a: argparse.Namespace) -> int:
    from .installation import diagnostic

    t = Table("", "Élément", "Détail")
    tout_ok = True
    for d in diagnostic():
        tout_ok &= d.ok
        t.add_row("[green]✔[/green]" if d.ok else "[red]✘[/red]", d.libelle, d.detail)
    console.print(t)
    return 0 if tout_ok else 1


def _masquer(cle: str, val: str) -> str:
    return (val[:6] + "…" + val[-4:]) if "API_KEY" in cle and len(val) > 12 else ("…" if "API_KEY" in cle else val)


def cmd_config(a: argparse.Namespace) -> int:
    from .installation import PRESETS

    cfg = fichier_config()
    if a.importer:
        n, chemin = importer_env(Path(a.importer).expanduser())
        console.print(f"{n} fournisseur(s) importé(s) dans {chemin} (droits 600).")
        return 0 if n else 1
    valeurs = lire_env(cfg)
    if a.regler:
        for paire in a.regler:
            if "=" not in paire:
                console.print(f"[red]Format attendu CLE=VALEUR : {paire}[/red]")
                return 1
            cle, val = paire.split("=", 1)
            valeurs[cle.strip()] = val.strip()
        ecrire_env(cfg, valeurs)
        console.print(f"Réglages enregistrés dans {cfg}.")
        return 0
    if a.afficher:
        for cle in sorted(valeurs):
            console.print(f"{cle}={_masquer(cle, valeurs[cle])}")
        return 0
    console.print(Panel(f"Fichier : {cfg}\nLes clés restent sur cet ordinateur (fichier en droits 600).", title="Configuration des fournisseurs IA", title_align="left"))
    fournisseurs, _ = charger_fournisseurs(valeurs)
    if fournisseurs:
        console.print("Déjà configurés : " + ", ".join(f"{f.rang}. {f.nom}" for f in fournisseurs))
        if not Confirm.ask("Ajouter ou remplacer un fournisseur ?", default=False):
            return 0
    while True:
        choix = Prompt.ask("Fournisseur", choices=[*PRESETS, "autre", "fin"], default="nvidia" if not fournisseurs else "fin")
        if choix == "fin":
            break
        preset = dict(PRESETS.get(choix, {"NAME": "", "BASE_URL": "", "MODEL": "", "CONTEXT": "128000", "aide": ""}))
        if preset.get("aide"):
            console.print(f"[dim]{preset['aide']}[/dim]")
        if choix == "autre":
            preset["NAME"] = Prompt.ask("Nom")
            preset["BASE_URL"] = Prompt.ask("URL de base OpenAI-compatible (…/v1)")
            preset["MODEL"] = Prompt.ask("Modèle")
            preset["CONTEXT"] = Prompt.ask("Taille du contexte (tokens)", default="128000")
        if "{compte}" in preset["BASE_URL"]:
            preset["BASE_URL"] = preset["BASE_URL"].replace("{compte}", Prompt.ask("Identifiant de compte Cloudflare"))
        cle = Prompt.ask("Clé API (saisie masquée)", password=True).strip()
        if not cle:
            console.print("[yellow]Clé vide : fournisseur ignoré.[/yellow]")
            continue
        preset["MODEL"] = Prompt.ask("Modèle", default=preset["MODEL"])
        # Rang : remplace un fournisseur du même nom, sinon s'ajoute à la fin.
        existants = {valeurs.get(f"PROVIDER_{n}_NAME", "").lower(): n for n in range(1, 51) if valeurs.get(f"PROVIDER_{n}_NAME")}
        rang = existants.get(preset["NAME"].lower()) or (max(existants.values(), default=0) + 1)
        for k in ("NAME", "BASE_URL", "MODEL", "CONTEXT"):
            valeurs[f"PROVIDER_{rang}_{k}"] = preset[k]
        valeurs[f"PROVIDER_{rang}_API_KEY"] = cle
        ecrire_env(cfg, valeurs)
        console.print(f"[green]✔ {preset['NAME']} enregistré (rang {rang}).[/green]")
    return 0


def cmd_tester(_a: argparse.Namespace) -> int:
    fournisseurs, problemes = charger_fournisseurs()
    for p in problemes:
        console.print(f"[yellow]{p}[/yellow]")
    code = 0
    for f in fournisseurs:
        debut = time.monotonic()
        try:
            t = tenter(f, [{"role": "user", "content": "Réponds uniquement : OK"}], temperature=0.4, max_tokens=64, raisonnement="aucun")
            duree = time.monotonic() - debut
            if est_degenere(t.texte) or not t.texte.strip():
                console.print(f"[yellow]⚠ {f.nom}[/yellow] ({f.modele}) {duree:.1f} s : réponse {'vide' if not t.texte.strip() else 'dégénérée'} (défaut passager ; l'atelier réessaie puis bascule automatiquement)")
            else:
                console.print(f"[green]✔ {f.nom}[/green] ({f.modele}) {duree:.1f} s : {t.texte.strip()[:40]!r}")
        except ErreurFournisseur as e:
            code = 1
            console.print(f"[red]✘ {f.nom}[/red] ({f.modele}) : {e}")
    if not fournisseurs:
        console.print("Aucun fournisseur : lancez [bold]atelier config[/bold].")
        return 1
    return code


def construire_parseur() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="atelier", description="Atelier IA local : discutez avec un modèle, les fichiers sont écrits dans votre projet et compilés avec gradle build.")
    p.add_argument("--version", action="version", version=f"atelier {__version__}")
    sp = p.add_subparsers(dest="commande")
    s = sp.add_parser("nouveau", help="créer un projet et discuter")
    s.add_argument("nom")
    s.add_argument("--ici", action="store_true", help="utiliser le dossier courant au lieu de ~/AtelierProjets/NOM")
    s.set_defaults(func=cmd_nouveau)
    s = sp.add_parser("ouvrir", help="discuter sur un dossier existant")
    s.add_argument("dossier", nargs="?")
    s.set_defaults(func=cmd_ouvrir)
    s = sp.add_parser("demander", help="un seul tour sans interaction")
    s.add_argument("texte", help='message (ou « - » pour lire l\'entrée standard)')
    s.add_argument("--dossier", "-d")
    s.add_argument("--corriger", type=int, metavar="N", help="corriger en boucle jusqu'à N fois si la compilation échoue (0 = sans limite)")
    s.add_argument("--sans-compilation", action="store_true")
    s.set_defaults(func=cmd_demander)
    s = sp.add_parser("build", help="gradle build local")
    s.add_argument("dossier", nargs="?")
    s.add_argument("--corriger", type=int, metavar="N", help="si échec, corriger avec le modèle jusqu'à N fois (0 = sans limite)")
    s.add_argument("--verbeux", "-v", action="store_true", help="afficher toute la sortie de Gradle")
    s.set_defaults(func=cmd_build)
    s = sp.add_parser("installer", help=f"installer JDK {JDK_VERSION} et Gradle {GRADLE_VERSION}")
    s.add_argument("--forcer", action="store_true")
    s.set_defaults(func=cmd_installer)
    s = sp.add_parser("config", help="configurer les fournisseurs IA")
    s.add_argument("--importer", metavar="FICHIER_ENV", help="importer les PROVIDER_n_* d'un .env (ex. .env.local de la version web)")
    s.add_argument("--afficher", action="store_true", help="afficher la configuration (clés masquées)")
    s.add_argument("--regler", nargs="+", metavar="CLE=VALEUR", help="ex. ATELIER_CORRECTIONS_MAX=10 ATELIER_COMPILATION_AUTO=0")
    s.set_defaults(func=cmd_config)
    sp.add_parser("doctor", help="vérifier l'installation").set_defaults(func=cmd_doctor)
    sp.add_parser("tester", help="tester chaque fournisseur").set_defaults(func=cmd_tester)
    sp.add_parser("projets", help="lister les projets").set_defaults(func=cmd_projets)
    s = sp.add_parser("ui", help="application de bureau (même interface que la version web)")
    s.add_argument("--port", type=int, default=3210)
    s.add_argument("--arreter", action="store_true", help="arrêter le serveur de l'interface")
    s.add_argument("--redemarrer", action="store_true", help="redémarrer le serveur")
    s.add_argument("--preparer", action="store_true", help="installer Node et l'entrée de menu, sans ouvrir")
    s.add_argument("--sans-fenetre", action="store_true", help="démarrer le serveur sans ouvrir de fenêtre")
    s.add_argument("--navigateur", action="store_true", help="ouvrir dans le navigateur au lieu de l'application de bureau")
    s.add_argument("--reconstruire", nargs="?", const=True, metavar="DEPOT", help=argparse.SUPPRESS)
    s.set_defaults(func=cmd_ui)
    return p


def main(argv: list[str] | None = None) -> int:
    a = construire_parseur().parse_args(argv)
    func = getattr(a, "func", cmd_accueil)
    try:
        return func(a) or 0
    except KeyboardInterrupt:
        console.print()
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
