/**
 * Modules Python de lancement de la console du navigateur :
 *  - `atelier_run` : `python fichier.py` / `-c` / `-m` / `%run`, cellules de la console (sys.exit() propre),
 *    input() par boîte de saisie, installation automatique des modules manquants, garde-fou contre les
 *    attentes sans fin ;
 *  - `atelier_mpl` : backend matplotlib (plt.show() → image dans le terminal, plt.pause() sans fermer) ;
 *  - cales : `PIL.ImageTk` et `matplotlib.backends.backend_tkagg` pour le tkinter de la console ;
 *  - `_tkinter` : module natif factice.
 */

export const RUN = String.raw`
"""Lancement de programmes Python dans la console du navigateur."""
import builtins
import importlib
import importlib.abc
import importlib.util
import os
import re
import runpy
import shlex
import sys
import time
import traceback

import atelier_ui as _ui

DOSSIER = "/home/pyodide"
CALES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "atelier_cales")
LIMITE = 60

AIDE = """usage : python [option] fichier.py [arguments]
  -c code   exécuter du code ;   -m module   lancer un module ;   -V   version
Les fichiers du projet de la conversation (et ceux importés) sont dans le dossier courant."""

# Nom à importer → paquet à installer, quand ils diffèrent.
PAQUETS = {
    "cv2": "opencv-python", "PIL": "pillow", "sklearn": "scikit-learn", "skimage": "scikit-image", "yaml": "pyyaml",
    "bs4": "beautifulsoup4", "dateutil": "python-dateutil", "docx": "python-docx", "pptx": "python-pptx",
    "Crypto": "pycryptodome", "serial": "pyserial", "dotenv": "python-dotenv", "jwt": "PyJWT", "attr": "attrs",
    "OpenSSL": "pyopenssl", "fitz": "pymupdf", "Levenshtein": "python-Levenshtein", "magic": "python-magic",
    "google": "protobuf", "faker": "Faker", "telegram": "python-telegram-bot", "discord": "discord.py",
}

# ─── input() : boîte de saisie du navigateur, avec les dernières lignes affichées ───


def _peut_attendre():
    """JSPI : Python peut attendre une promesse sans figer la page (sinon : boîte de saisie, attente active)."""
    try:
        from pyodide.ffi import can_run_sync

        import js

        return bool(can_run_sync()) and not getattr(js, "__atelierSansJSPI", False)
    except Exception:
        return False


def _attendre(promesse_ou_coroutine):
    from pyodide.ffi import run_sync

    r = run_sync(promesse_ou_coroutine)
    if _ui.arretDemande():
        raise KeyboardInterrupt("arrêt demandé")
    return r


def _input(prompt=""):
    texte = "" if prompt is None else str(prompt)
    if texte:
        sys.stdout.write(texte)
    sys.stdout.flush()
    sys.stderr.flush()
    # Avec JSPI, la saisie se fait dans la console elle-même (la page reste utilisable) ; sinon, boîte du navigateur.
    reponse = _attendre(_ui.saisieAsync(texte)) if _peut_attendre() else _ui.saisie(texte)
    if reponse is None:
        sys.stdout.write("\n")
        raise KeyboardInterrupt("saisie annulée")
    reponse = str(reponse)
    sys.stdout.write(reponse + "\n")
    return reponse


builtins.input = _input

# ─── Garde-fou : un programme qui attend trop longtemps fige la page ───

_dormir = time.sleep
_debut = [time.monotonic()]


def _debut_execution():
    _debut[0] = time.monotonic()


def _sleep(secondes):
    s = max(0.0, float(secondes))
    if _peut_attendre():
        # La page continue de vivre pendant l'attente (dessin, clics, animations turtle / tkinter).
        import asyncio

        _attendre(asyncio.sleep(s))
        return
    if time.monotonic() - _debut[0] + s > LIMITE:
        raise RuntimeError(
            f"Programme arrêté après {LIMITE} s d'attente : dans le navigateur, un programme qui attend (time.sleep) "
            "bloque toute la page. Pour une animation ou un jeu, programmez la suite avec root.after(ms, fonction) "
            "(tkinter) ou ontimer (turtle) au lieu d'une boucle avec time.sleep."
        )
    _dormir(s)


time.sleep = _sleep

# ─── asyncio.run() : la page a déjà une boucle d'événements ───

try:
    import asyncio

    def _run(main, *, debug=None, loop_factory=None):
        async def _garde():
            # Une exception (ou sys.exit) dans la tâche ne doit pas arrêter la boucle de la page.
            try:
                return await main
            except SystemExit as e:
                _signaler_sortie(e)
            except KeyboardInterrupt:
                print("[programme interrompu]", file=sys.stderr)
            except BaseException:
                traceback.print_exc()
            finally:
                sys.stdout.flush()
                sys.stderr.flush()

        asyncio.ensure_future(_garde())
        return None

    asyncio.run = _run
except Exception:
    pass

# ─── matplotlib : images dans le terminal ───

os.environ.setdefault("MPLBACKEND", "module://atelier_mpl")


# ─── Cales d'import (PIL.ImageTk, backend Tk de matplotlib) ───


class _Cales(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    NOMS = {
        "PIL.ImageTk": "imagetk.py",
        "matplotlib.backends.backend_tkagg": "tkagg.py",
        "matplotlib.backends._backend_tk": "tkagg.py",
        "matplotlib.backends.backend_tkcairo": "tkagg.py",
    }

    def find_spec(self, fullname, path, target=None):
        if fullname in self.NOMS:
            return importlib.util.spec_from_loader(fullname, self)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        with open(os.path.join(CALES, self.NOMS[module.__name__]), encoding="utf-8") as f:
            exec(compile(f.read(), module.__name__, "exec"), module.__dict__)


if not any(isinstance(f, _Cales) for f in sys.meta_path):
    sys.meta_path.insert(0, _Cales())


# ─── Modules manquants : chargés depuis Pyodide, sinon installés depuis PyPI ───


def _locaux():
    noms = set()
    try:
        for n in os.listdir(os.getcwd()):
            if n.endswith(".py"):
                noms.add(n[:-3])
            elif os.path.isdir(n):
                noms.add(n)
    except OSError:
        pass
    return noms


def _imports(sources):
    import ast

    noms = set()
    for src in sources:
        try:
            arbre = ast.parse(src)
        except (SyntaxError, ValueError):
            continue
        for n in ast.walk(arbre):
            if isinstance(n, ast.Import):
                noms.update(a.name.split(".")[0] for a in n.names)
            elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
                noms.add(n.module.split(".")[0])
    return noms


async def preparer_imports(*sources):
    """Charge les paquets importés par le code : distribution Pyodide d'abord, PyPI ensuite (micropip)."""
    noms = _imports(sources) - _locaux() - set(sys.builtin_module_names)
    manquants = sorted(n for n in noms if n and importlib.util.find_spec(n) is None)
    if not manquants:
        return
    import pyodide_js

    try:
        await pyodide_js.loadPackagesFromImports("\n".join(f"import {n}" for n in manquants))
    except Exception:
        pass
    importlib.invalidate_caches()
    encore = [n for n in manquants if importlib.util.find_spec(n) is None]
    if not encore:
        return
    try:
        await pyodide_js.loadPackage("micropip")
        import micropip
    except Exception:
        return
    for n in encore:
        paquet = PAQUETS.get(n, n)
        try:
            await micropip.install(paquet)
        except Exception as e:
            print(f"(module « {n} » : installation automatique de « {paquet} » impossible — {_raison_echec(e)})", file=sys.stderr)
            continue
        importlib.invalidate_caches()
        # « installé » seulement si le module s'importe vraiment (un paquet peut s'installer sans fournir ce nom).
        try:
            importlib.import_module(n)
        except (Exception, SystemExit) as e:
            detail = f"{type(e).__name__}: {e}".strip().splitlines()[0][:200]
            print(f"(module « {n} » : le paquet « {paquet} » s'est installé mais « import {n} » échoue — {detail})", file=sys.stderr)
        else:
            print(f"(module « {n} » installé automatiquement : {paquet})")
    importlib.invalidate_caches()


def _raison_echec(e):
    texte = str(e).strip()
    if "pure Python 3 wheel" in texte or "pure python 3 wheel" in texte.lower():
        return "il contient du code compilé (C, Rust…) sans version pour le navigateur"
    if "Can't fetch metadata" in texte or "No matching distribution" in texte or "404" in texte:
        return "paquet introuvable sur PyPI (ou réseau indisponible)"
    return (texte.splitlines()[0] if texte else type(e).__name__)[:200]


# ─── Lancement ───


def _fichiers_python():
    out = []
    for racine, dossiers, noms in os.walk(os.getcwd()):
        dossiers[:] = sorted(d for d in dossiers if not d.startswith(".") and d not in ("__pycache__", "node_modules", "venv"))
        out.extend(os.path.relpath(os.path.join(racine, n)) for n in sorted(noms) if n.endswith(".py"))
        if len(out) > 60:
            break
    return out


def _trouver_script(nom):
    if os.path.isfile(nom):
        return os.path.abspath(nom)
    if os.path.isdir(nom) and os.path.isfile(os.path.join(nom, "__main__.py")):
        return os.path.abspath(os.path.join(nom, "__main__.py"))
    base = os.path.basename(nom)
    trouves = [f for f in _fichiers_python() if os.path.basename(f) == base]
    if len(trouves) == 1:
        print(f"(« {nom} » trouvé dans {trouves[0]})")
        return os.path.abspath(trouves[0])
    dispo = ", ".join(_fichiers_python()[:15]) or "aucun — importez-les avec le bouton « Importer des fichiers »"
    if len(trouves) > 1:
        print(f"python : plusieurs fichiers « {base} » : {', '.join(trouves)}. Précisez le chemin.", file=sys.stderr)
    else:
        print(f"python : impossible d'ouvrir « {nom} » : ce fichier n'existe pas dans le dossier de la console.\nFichiers Python disponibles : {dispo}", file=sys.stderr)
    return None


def _oublier_modules_du_projet():
    """Un module du projet modifié depuis le dernier lancement doit être relu (pas de cache périmé)."""
    racine = os.path.abspath(os.getcwd()) + os.sep
    for nom, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if f and os.path.abspath(f).startswith(racine):
            sys.modules.pop(nom, None)


def _fermer_fenetres_precedentes():
    if "turtle" in sys.modules:
        try:
            sys.modules["turtle"]._reinitialiser()
        except Exception:
            pass
    if "tkinter" in sys.modules:
        try:
            sys.modules["tkinter"]._tout_detruire()
        except Exception:
            pass


def _repartir_a_neuf():
    """Bouton « Exécuter » d'un bloc de code : repart d'un état propre (fenêtres, tortue, figures)."""
    _fermer_fenetres_precedentes()
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        try:
            plt.close("all")
        except Exception:
            pass


def _signaler_sortie(e):
    """sys.exit() / exit() / raise SystemExit : fin propre, sans traceback, comme l'interpréteur."""
    code = e.code
    if code is None or (isinstance(code, int) and int(code) == 0):
        return
    if isinstance(code, int):
        print(f"[programme terminé avec le code {int(code)}]", file=sys.stderr)
    else:
        print(str(code), file=sys.stderr)


async def cellule(code):
    """Exécute une cellule de la console (comme runPythonAsync). SystemExit et KeyboardInterrupt sont
    traités ici : sortis de la cellule, ils arrêteraient la boucle d'événements de la page."""
    from pyodide.code import eval_code_async

    import __main__

    try:
        return await eval_code_async(code, __main__.__dict__, filename="<exec>")
    except SystemExit as e:
        _signaler_sortie(e)
        if e.code is None and re.fullmatch(r"\s*(exit|quit)\(\s*\)\s*", code):
            print("(la console reste ouverte : les variables sont conservées)")
    except KeyboardInterrupt as e:
        print(f"[programme interrompu{' : ' + str(e) if str(e) else ''}]", file=sys.stderr)
    return None


def _fin_execution():
    """Fin d'une exécution de la console : figures matplotlib modifiées affichées, flux vidés."""
    tk = sys.modules.get("tkinter")
    if tk is not None and hasattr(tk, "_apres_execution"):
        try:
            tk._apres_execution()
        except Exception:
            pass
    mpl = sys.modules.get("atelier_mpl")
    if mpl is not None:
        try:
            mpl.vider()
        except Exception:
            pass
    sys.stdout.flush()
    sys.stderr.flush()


def _afficher_erreur():
    exc, val, tb = sys.exc_info()
    while tb is not None and tb.tb_frame.f_code.co_filename.endswith(("runpy.py", "atelier_run.py", "<frozen runpy>")):
        tb = tb.tb_next
    traceback.print_exception(exc, val, tb)
    if isinstance(val, ModuleNotFoundError) and getattr(val, "name", None):
        print(f"→ Installez-le avec : pip install {PAQUETS.get(val.name.split('.')[0], val.name.split('.')[0])}", file=sys.stderr)


async def lancer(ligne=""):
    """« python fichier.py args », « python -c code », « python -m module », « %run fichier.py »."""
    try:
        args = shlex.split(ligne)
    except ValueError as e:
        print(f"python : ligne de commande invalide ({e}).", file=sys.stderr)
        return
    code = module = script = None
    reste = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-c":
            code = args[i + 1] if i + 1 < len(args) else ""
            reste = args[i + 2:]
            break
        if a == "-m":
            module = args[i + 1] if i + 1 < len(args) else ""
            reste = args[i + 2:]
            break
        if a in ("-V", "--version"):
            print(f"Python {sys.version.split()[0]}")
            return
        if a in ("-h", "--help", "-?"):
            print(AIDE)
            return
        if a in ("-W", "-X", "--check-hash-based-pycs"):
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        script = a
        reste = args[i + 1:]
        break
    if code is None and module is None and script is None:
        print("Vous êtes déjà dans Python : tapez votre code directement, ou « python fichier.py » pour lancer un fichier.")
        return
    chemin = None
    if script is not None:
        chemin = _trouver_script(script)
        if chemin is None:
            return
    _fermer_fenetres_precedentes()
    _oublier_modules_du_projet()
    sources = []
    if code is not None:
        sources.append(code)
    elif chemin is not None:
        for f in [chemin] + [os.path.abspath(p) for p in _fichiers_python()]:
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    sources.append(fh.read())
            except OSError:
                pass
            if len(sources) > 40:
                break
    await preparer_imports(*sources)
    ancien_argv, ancien_path = sys.argv[:], sys.path[:]
    _debut_execution()
    try:
        if code is not None:
            sys.argv = ["-c", *reste]
            exec(compile(code, "<string>", "exec"), {"__name__": "__main__", "__builtins__": builtins})
        elif module is not None:
            sys.argv = [module, *reste]
            runpy.run_module(module, run_name="__main__", alter_sys=True)
        else:
            sys.argv = [script, *reste]
            sys.path.insert(0, os.path.dirname(chemin))
            runpy.run_path(script if os.path.isfile(script) else chemin, run_name="__main__")
    except SystemExit as e:
        _signaler_sortie(e)
    except KeyboardInterrupt:
        print("[programme interrompu]", file=sys.stderr)
    except BaseException:
        _afficher_erreur()
    finally:
        sys.argv = ancien_argv
        sys.path[:] = ancien_path
        sys.stdout.flush()
        sys.stderr.flush()
`;

export const MPL = String.raw`
"""Backend matplotlib de la console : les figures s'affichent comme images dans le terminal.

plt.show() affiche les figures puis les ferme ; plt.show(block=False) et plt.pause() les affichent sans
les fermer ; en fin d'exécution, vider() affiche celles qui ont changé depuis leur dernier affichage.
Une figure inchangée déjà affichée n'est jamais renvoyée."""
import base64
import hashlib
import io
import itertools
import sys

import atelier_ui as _ui
from matplotlib._pylab_helpers import Gcf
from matplotlib.backend_bases import _Backend
from matplotlib.backends.backend_agg import FigureCanvasAgg, _BackendAgg

_numeros = itertools.count(1)


def envoyer_figure(fig):
    """Affiche la figure comme image PNG, sauf si elle est identique à son dernier affichage."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor())
    fig.stale = False  # savefig peut la marquer « modifiée » (dpi, cadrage) : seul un vrai changement compte
    png = buf.getvalue()
    empreinte = hashlib.sha1(png).hexdigest()
    if getattr(fig, "_atelier_empreinte", None) == empreinte:
        return False
    fig._atelier_empreinte = empreinte
    if getattr(fig, "_atelier_numero", None) is None:
        fig._atelier_numero = next(_numeros)
    sys.stdout.flush()  # l'image s'affiche après le texte déjà écrit
    sys.stderr.flush()
    _ui.image("data:image/png;base64," + base64.b64encode(png).decode(), fig._atelier_numero)
    return True


def _figures(fenetres_fermees=False):
    """Figures de pyplot à afficher dans le terminal : pas celles intégrées à une fenêtre tkinter
    (FigureCanvasTkAgg), sauf, si demandé, quand cette fenêtre a été fermée."""
    for manager in Gcf.get_all_fig_managers():
        fig = manager.canvas.figure
        widget = getattr(fig.canvas, "get_tk_widget", None)
        if widget is None or (fenetres_fermees and not widget().winfo_exists()):
            yield fig


def vider():
    """Fin d'exécution : affiche les figures encore ouvertes modifiées depuis leur dernier affichage."""
    for fig in list(_figures()):
        if not fig.axes or (getattr(fig, "_atelier_empreinte", None) and not fig.stale):
            continue
        try:
            envoyer_figure(fig)
        except Exception:
            pass


class FigureCanvasAtelier(FigureCanvasAgg):
    def draw_idle(self, *args, **kwargs):
        """Rien à redessiner « plus tard » : l'image est rendue au moment où elle s'affiche (show, pause, fin)."""

    def start_event_loop(self, timeout=0):
        """plt.pause() : la page ne se redessine pas pendant que Python tourne, attendre ne servirait à rien."""
        self.flush_events()


@_Backend.export
class _BackendAtelier(_BackendAgg):
    FigureCanvas = FigureCanvasAtelier

    @classmethod
    def show(cls, *args, block=None, **kwargs):
        for fig in list(_figures(fenetres_fermees=True)):
            envoyer_figure(fig)
        if block is False:
            return  # plt.show(block=False), plt.pause() : les figures restent ouvertes
        Gcf.destroy_all()
`;

export const CALE_TKAGG = String.raw`
"""matplotlib.backends.backend_tkagg pour le tkinter de la console : la figure s'affiche dans la fenêtre
(un Canvas, comme le vrai TkAgg) et suit la taille du widget quand la fenêtre est redimensionnée."""
import io
import os
import tkinter

from matplotlib.backend_bases import _Backend
from matplotlib.backends.backend_agg import FigureCanvasAgg

import atelier_mpl


class FigureCanvasTkAgg(FigureCanvasAgg):
    def __init__(self, figure=None, master=None, resize_callback=None):
        super().__init__(figure)
        self._master = master
        self._rappel_taille = resize_callback
        l, h = (max(1, int(round(v))) for v in self.figure.bbox.size)
        self._widget = tkinter.Canvas(master, width=l, height=h, bg="white", bd=0, highlightthickness=0)
        self._tkcanvas = self._widget
        self._taille = (l, h)
        self._item = None
        self._image = None
        self._attente = None
        self._widget.bind("<Configure>", self._redimensionner, "+")
        self._rendu()

    def _rendu(self):
        buf = io.BytesIO()
        self.figure.savefig(buf, format="png", dpi=self.figure.dpi, facecolor=self.figure.get_facecolor())
        image = tkinter.PhotoImage(data=buf.getvalue())
        if self._item is None:
            self._item = self._widget.create_image(0, 0, anchor="nw", image=image)
        else:
            self._widget.itemconfigure(self._item, image=image)
        self._image = image

    def _redimensionner(self, event):
        l, h = int(event.width), int(event.height)
        if l < 10 or h < 10 or (l, h) == self._taille:
            return
        self._taille = (l, h)
        if self._attente is not None:
            self._widget.after_cancel(self._attente)
        self._attente = self._widget.after(80, lambda: self._appliquer_taille(event))

    def _appliquer_taille(self, event):
        """Comme le vrai TkAgg : la figure prend la taille du widget, puis est redessinée."""
        self._attente = None
        l, h = self._taille
        dpi = self.figure.dpi
        self.figure.set_size_inches(l / dpi, h / dpi, forward=False)
        if self._rappel_taille is not None:
            self._rappel_taille(event)
        self.draw()

    def draw(self):
        super().draw()
        self._rendu()

    def draw_idle(self, *args, **kwargs):
        self.draw()

    def show(self):
        self.draw()

    def get_tk_widget(self):
        return self._widget

    def flush_events(self):
        pass

    def start_event_loop(self, timeout=0):
        pass


FigureCanvasTk = FigureCanvasTkAgg


class NavigationToolbar2Tk(tkinter.Frame):
    def __init__(self, canvas, window=None, *, pack_toolbar=True):
        super().__init__(window)
        self.canvas = canvas

        def enregistrer():
            nom = "figure.png"
            i = 1
            while os.path.exists(nom):
                i += 1
                nom = f"figure_{i}.png"
            canvas.figure.savefig(nom)
            print(f"Figure enregistrée : {os.path.abspath(nom)}")

        tkinter.Button(self, text="Enregistrer l'image", command=enregistrer).pack(side="left", padx=2, pady=2)
        if pack_toolbar:
            self.pack(side="bottom", fill="x")

    def update(self):
        pass

    def set_message(self, s):
        pass

    def push_current(self):
        pass


NavigationToolbar2TkAgg = NavigationToolbar2Tk


@_Backend.export
class _BackendTkAgg(atelier_mpl._BackendAtelier):
    pass
`;

export const CALE_IMAGETK = String.raw`
"""PIL.ImageTk pour le tkinter de la console : convertit une image PIL en PhotoImage."""
import io

import tkinter


def _png(image):
    buf = io.BytesIO()
    im = image if image.mode in ("RGB", "RGBA", "L", "LA", "P") else image.convert("RGBA")
    im.save(buf, format="PNG")
    return buf.getvalue()


class PhotoImage(tkinter.PhotoImage):
    def __init__(self, image=None, size=None, **kw):
        if image is not None and not isinstance(image, str) and hasattr(image, "save"):
            self._pil = image
            super().__init__(data=_png(image), **kw)
        elif isinstance(image, str):
            super().__init__(**kw)
        else:
            super().__init__(file=kw.pop("file", None), data=kw.pop("data", None), **kw)

    def paste(self, im, box=None):
        self._pil = im
        self.configure(data=_png(im))


class BitmapImage(tkinter.BitmapImage):
    def __init__(self, image=None, **kw):
        super().__init__(**kw)


def getimage(photo):
    from PIL import Image

    return getattr(photo, "_pil", None) or Image.open(io.BytesIO(getattr(photo, "_brut", b"")))
`;

export const TKINTER_NATIF = String.raw`
"""Module natif factice : le vrai tkinter de la console est en Python pur (pas de Tcl/Tk)."""
TK_VERSION = TCL_VERSION = "8.6"
READABLE = 2
WRITABLE = 4
EXCEPTION = 8


class TclError(Exception):
    pass


def create(*args, **kw):
    raise TclError("Tcl/Tk n'est pas disponible dans le navigateur : utilisez « import tkinter ».")
`;
