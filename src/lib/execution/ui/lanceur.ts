/**
 * Modules Python de lancement de la console du navigateur :
 *  - `atelier_run` : `python fichier.py` / `-c` / `-m` / `%run`, cellules de la console (sys.exit() propre),
 *    sorties routées vers l'exécution qui écrit, input() / sys.stdin / getpass dans la console, bouton
 *    « Arrêter » (KeyboardInterrupt ponctuel, sleep et await interrompus), asyncio.run() bloquant,
 *    installation automatique des modules manquants, garde-fou contre les attentes sans fin ;
 *  - `atelier_mpl` : backend matplotlib (plt.show() → image dans le terminal, plt.pause() sans fermer) ;
 *  - cales : `PIL.ImageTk` et `matplotlib.backends.backend_tkagg` pour le tkinter de la console ;
 *  - `_tkinter` : module natif factice.
 */

export const RUN = String.raw`
"""Lancement de programmes Python dans la console du navigateur."""
import asyncio
import builtins
import codecs
import contextvars
import importlib
import importlib.abc
import importlib.util
import io
import os
import re
import runpy
import shlex
import sys
import time
import traceback
import weakref

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

# ─── Exécution en cours : identifiant posé par cellule() dans le contexte asyncio de sa tâche ───
# Hérité par les tâches que le programme crée (et par les rappels qui gardent ce contexte) : sa sortie, ses
# images et ses saisies vont à l'exécution qui les produit, même si une autre a démarré entre-temps.

_execution = contextvars.ContextVar("atelier_execution", default=None)
_cellules = weakref.WeakSet()  # tâches asyncio des cellules (le code tapé ou lancé)


def _ident():
    """Identifiant de l'exécution du code en cours (None : rappel ou code hors exécution)."""
    return _execution.get()


# Programme lancé (python x.py) terminé fenêtres ouvertes (sans JSPI, mainloop() rend la main) : ses rappels
# retrouvent son environnement (flux, sys.path, argv, module __main__), la console garde le sien.
_env_programmes = {}  # ident de l'exécution → environnement du programme


def _echanger_env(env):
    avant = {"argv": sys.argv, "path": sys.path[:], "flux": (sys.stdin, sys.stdout, sys.stderr),
             "main": sys.modules.get("__main__")}
    sys.argv = env["argv"]
    sys.path[:] = env["path"]
    sys.stdin, sys.stdout, sys.stderr = env["flux"]
    if env["main"] is not None:
        sys.modules["__main__"] = env["main"]
    return avant


def dans_execution(ident, fn, *args):
    """Appelle fn(*args) au nom de l'exécution « ident » (rappel de fenêtre, minuterie, relevé par _ident()
    à la création) : sa sortie, ses images et ses saisies vont à cette exécution, même si une autre a
    démarré depuis. Contexte copié à chaque appel : aucun effet sur l'appelant, rappels imbriqués permis."""
    env = _env_programmes.get(ident)

    def _appel():
        _execution.set(ident)
        if env is None or env.get("actif"):
            return fn(*args)
        env["actif"] = True
        console = _echanger_env(env)
        try:
            return fn(*args)
        finally:
            _vider_flux()
            env.update(_echanger_env(console))  # le rappel a pu changer sys.stdout, sys.path…
            env["actif"] = False

    return contextvars.copy_context().run(_appel)


# ─── sys.stdout / sys.stderr : chaque écriture part aussitôt vers l'exécution qui l'a produite ───


class _SortieOctets(io.BufferedIOBase):
    """sys.stdout.buffer : les octets sont décodés (UTF-8) et écrits comme du texte, dans le même ordre."""

    def __init__(self, texte):
        super().__init__()
        self._texte = texte
        self._decodeur = codecs.getincrementaldecoder("utf-8")("replace")

    def writable(self):
        return True

    def write(self, b):
        donnees = bytes(b)
        self._texte.write(self._decodeur.decode(donnees))
        return len(donnees)

    def isatty(self):
        return self._texte.isatty()

    def fileno(self):
        return self._texte.fileno()

    def close(self):
        """io.TextIOWrapper(sys.stdout.buffer) fermé par le programme : la console garde sa sortie."""


class _Sortie(io.TextIOBase):
    """sys.stdout / sys.stderr de la console. Rien n'est retenu en mémoire tampon : le texte s'affiche
    tout de suite (avant une attente, une image, une saisie), dans l'ordre exact."""

    encoding = "utf-8"
    errors = "strict"
    mode = "w"
    line_buffering = True
    write_through = True

    def __init__(self, origine, erreur):
        super().__init__()
        self._origine = origine
        self._erreur = erreur
        self._octets = _SortieOctets(self)

    @property
    def name(self):
        return "<stderr>" if self._erreur else "<stdout>"

    @property
    def buffer(self):
        return self._octets

    def writable(self):
        return True

    def isatty(self):
        try:
            return bool(self._origine.isatty())
        except Exception:
            return False

    def fileno(self):
        return self._origine.fileno()

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError(f"write() argument must be str, not {type(s).__name__}")
        if s:
            _ui.sortie(s, self._erreur, _execution.get())
        return len(s)

    def flush(self):
        try:
            self._origine.flush()  # écritures de bas niveau (os.write, modules en C)
        except Exception:
            pass

    def reconfigure(self, **options):
        """sys.stdout.reconfigure(encoding="utf-8") : sans objet ici, le texte part tel quel."""

    def close(self):
        """Fermer la sortie de la console la rendrait muette pour la suite : ignoré."""


if type(sys.stdout).__name__ != "_Sortie":
    sys.stdout = _Sortie(sys.stdout, False)
if type(sys.stderr).__name__ != "_Sortie":
    sys.stderr = _Sortie(sys.stderr, True)


def _excepthook(typ, val, tb):
    """Pyodide appelle sys.excepthook (PyErr_Print) pour composer le message d'une exception qui remonte vers
    la page ; ce texte doit aller au flux d'origine (que Pyodide capture), pas s'afficher brut dans la console :
    la page montre ensuite le traceback nettoyé."""
    origine = getattr(sys.stderr, "_origine", None) or sys.__stderr__
    traceback.print_exception(typ, val, tb, file=origine)


sys.excepthook = _excepthook


def _vider_flux():
    for f in (sys.stdout, sys.stderr):
        try:
            f.flush()
        except Exception:
            pass


# ─── Attentes et bouton « Arrêter » ───
# Comme un Ctrl+C, « Arrêter » est un signal ponctuel : l'attente en cours au moment du clic (sleep, input,
# asyncio.run…) lève l'interruption une fois et le signale (_ui.arretVu) ; le code de nettoyage (except,
# finally) et les attentes suivantes fonctionnent normalement. Dans une cellule ou un rappel, c'est
# KeyboardInterrupt (ArretDemande) ; dans une tâche asyncio du programme, CancelledError, comme CPython
# (Ctrl+C annule la tâche principale d'asyncio.run, qui lève ensuite KeyboardInterrupt).


class ArretDemande(KeyboardInterrupt):
    """KeyboardInterrupt du bouton « Arrêter » (ou d'une saisie abandonnée à la fin du programme)."""


def _peut_attendre():
    """JSPI : Python peut attendre une promesse sans figer la page (sinon : boîte de saisie, attente active)."""
    try:
        from pyodide.ffi import can_run_sync

        import js

        return bool(can_run_sync()) and not getattr(js, "__atelierSansJSPI", False)
    except Exception:
        return False


def _tache_du_programme():
    """Tâche asyncio créée par le programme (create_task, asyncio.run), ou None (cellule, rappel, hors tâche)."""
    try:
        t = asyncio.current_task()
    except RuntimeError:
        return None
    return None if t is None or t in _cellules else t


def _exception_arret(message="arrêt demandé"):
    if _tache_du_programme() is not None:
        return asyncio.CancelledError(message)
    return ArretDemande(message)


def _verifier_arret(n0):
    """« Arrêter » cliqué depuis le relevé n0 (donc pendant l'attente) : interruption, une seule fois."""
    if _ui.numeroArret() != n0:
        _ui.arretVu()
        raise _exception_arret()


def _attendre(promesse_ou_coroutine):
    """Attend une promesse (ou coroutine) sans figer la page (JSPI) ; « Arrêter » pendant l'attente l'interrompt."""
    from pyodide.ffi import run_sync

    _vider_flux()
    n0 = _ui.numeroArret()
    try:
        r = run_sync(promesse_ou_coroutine)
    except BaseException:
        _verifier_arret(n0)
        raise
    _verifier_arret(n0)
    return r


# ─── input(), sys.stdin, getpass : saisie dans la console (JSPI), sinon boîte du navigateur ───


def _lire_ligne(invite="", masque=False, flux=False):
    """Une ligne tapée par l'utilisateur. Renvoie (genre, texte) : genre « texte », « annule » (Échap),
    « eof » (plus aucune saisie possible) ou « arret » (programme terminé pendant la saisie)."""
    _vider_flux()
    if _peut_attendre():
        # L'invite est affichée par la page quand la demande passe (une à la fois, dans l'ordre).
        try:
            genre, texte = (str(x) for x in _attendre(_ui.lireLigne(invite, masque, flux, _execution.get())).to_py())
        except BaseException:
            if invite:
                sys.stdout.write("\n")
            raise
    else:
        if invite:
            sys.stdout.write(invite)
        r = _ui.saisie(invite)
        genre, texte = ("annule", "") if r is None else ("texte", str(r))
    if genre == "texte":
        sys.stdout.write(("" if masque else texte) + "\n")
    elif invite:
        sys.stdout.write("\n")
    return genre, texte


def _ligne_ou_exception(genre, texte):
    if genre == "texte":
        return texte
    if genre == "eof":
        raise EOFError("EOF when reading a line")
    if genre == "arret":
        raise _exception_arret("fin du programme")
    raise KeyboardInterrupt("saisie annulée")


def _input(prompt=""):
    texte = "" if prompt is None else str(prompt)
    entree = sys.stdin
    if entree is not None and not isinstance(entree, _EntreeConsole):
        # sys.stdin remplacé par le programme (io.StringIO, fichier) : input() le lit, comme CPython.
        if texte:
            sys.stdout.write(texte)
        _vider_flux()
        ligne = entree.readline()
        if not ligne:
            raise EOFError("EOF when reading a line")
        return ligne[:-1] if ligne.endswith("\n") else ligne
    return _ligne_ou_exception(*_lire_ligne(texte))


class _EntreeOctets(io.BufferedIOBase):
    """sys.stdin.buffer : les lignes tapées, en octets (UTF-8)."""

    def __init__(self, texte):
        super().__init__()
        self._texte = texte

    def readable(self):
        return True

    def read(self, size=-1):
        return self._texte.read(size).encode("utf-8")

    read1 = read

    def readline(self, size=-1):
        return self._texte.readline(size).encode("utf-8")

    def isatty(self):
        return True

    def fileno(self):
        return 0

    def close(self):
        pass


class _EntreeConsole(io.TextIOBase):
    """sys.stdin de la console : chaque lecture demande une ligne à l'utilisateur, comme un terminal.
    Échap = fin de fichier (Ctrl+D) : readline() renvoie « », read() et « for ligne in sys.stdin » s'arrêtent."""

    encoding = "utf-8"
    errors = "strict"
    mode = "r"
    newlines = None

    def __init__(self):
        super().__init__()
        self._tampon = ""
        self._octets = _EntreeOctets(self)

    @property
    def name(self):
        return "<stdin>"

    @property
    def buffer(self):
        return self._octets

    def readable(self):
        return True

    def isatty(self):
        return True

    def fileno(self):
        return 0

    def _ligne(self):
        genre, texte = _lire_ligne("", flux=True)
        if genre == "texte":
            return texte + "\n"
        if genre == "arret":
            raise _exception_arret("fin du programme")
        return ""  # Échap, ou plus aucune saisie : fin de fichier

    def readline(self, size=-1):
        if size is not None and not isinstance(size, int):
            raise TypeError(f"argument should be integer or None, not '{type(size).__name__}'")
        if size is None or size < 0:
            size = -1
        if size == 0:
            return ""
        if not self._tampon:
            self._tampon = self._ligne()
        n = len(self._tampon) if size < 0 else min(size, len(self._tampon))
        i = self._tampon.find("\n", 0, n)
        if i >= 0:
            n = i + 1
        ligne, self._tampon = self._tampon[:n], self._tampon[n:]
        return ligne

    def read(self, size=-1):
        if size is not None and not isinstance(size, int):
            raise TypeError(f"argument should be integer or None, not '{type(size).__name__}'")
        if size is None or size < 0:
            size = -1
        morceaux, total = [self._tampon], len(self._tampon)
        self._tampon = ""
        while size < 0 or total < size:
            ligne = self._ligne()
            if not ligne:
                break
            morceaux.append(ligne)
            total += len(ligne)
        tout = "".join(morceaux)
        if size >= 0:
            tout, self._tampon = tout[:size], tout[size:]
        return tout

    def close(self):
        """Fermer l'entrée de la console : ignoré (les cellules suivantes en ont besoin)."""


def _getpass(prompt="Password: ", stream=None):
    """getpass.getpass : saisie masquée dans la console, la réponse n'est pas réécrite dans la sortie."""
    return _ligne_ou_exception(*_lire_ligne("" if prompt is None else str(prompt), masque=True))


builtins.input = _input
sys.stdin = sys.__stdin__ = _EntreeConsole()  # le stdin d'origine de Pyodide ne sait pas lire (OSError 29)
try:
    import getpass as _module_getpass

    _module_getpass.getpass = _getpass
except Exception:
    pass

# ─── Garde-fou : un programme qui attend trop longtemps fige la page ───

_dormir = time.sleep
_debut = [time.monotonic()]


def _debut_execution():
    _debut[0] = time.monotonic()


def _sleep(secondes):
    s = max(0.0, float(secondes))
    if _peut_attendre():
        # La page continue de vivre pendant l'attente (dessin, clics, animations turtle / tkinter) ;
        # « Arrêter » réveille la pause tout de suite (_ui.dormir) et lève KeyboardInterrupt.
        # Pour tkinter, le programme « attend dans update() / sleep » : un sys.exit() lancé par un rappel
        # pendant la pause (onkeypress(sys.exit, "q")) lui est rendu à la sortie de la pause, comme Tk.
        tk = sys.modules.get("tkinter")
        compteur = getattr(tk, "_dans_ceder", None)
        if compteur is not None:
            compteur[0] += 1
        # Dans un rappel tkinter (commande, bind, after) : comme Tk, les événements attendent la fin du sommeil.
        dans_rappel = bool(getattr(tk, "_dans_rappel", lambda: False)())
        if dans_rappel:
            _ui.occupe(1)
        try:
            _attendre(_ui.dormir(s * 1000))
        finally:
            if dans_rappel:
                _ui.occupe(-1)
            if compteur is not None:
                compteur[0] -= 1
        relancer = getattr(tk, "_relancer_sortie", None)
        if relancer is not None:
            relancer()
        return
    if time.monotonic() - _debut[0] + s > LIMITE:
        raise RuntimeError(
            f"Programme arrêté après {LIMITE} s d'attente : dans le navigateur, un programme qui attend (time.sleep) "
            "bloque toute la page. Pour une animation ou un jeu, programmez la suite avec root.after(ms, fonction) "
            "(tkinter) ou ontimer (turtle) au lieu d'une boucle avec time.sleep."
        )
    _dormir(s)


time.sleep = _sleep

# ─── threading.Lock : pas de fils d'exécution dans le navigateur ───
# Un acquire() bloquant sur un verrou déjà pris tournerait sans fin et figerait tout l'onglet (le rappel ou
# le programme qui le tient ne peut plus reprendre). Avec JSPI, l'attente rend la main à la page (le
# détenteur finit et relâche le verrou ; « Arrêter » l'interrompt) ; sinon, erreur claire plutôt qu'un gel.

import _thread
import threading


class _Verrou:
    __slots__ = ("_v", "__weakref__")

    def __init__(self):
        self._v = _thread.allocate_lock()

    def acquire(self, blocking=True, timeout=-1):
        if not blocking and timeout != -1:
            raise ValueError("can't specify a timeout for a non-blocking call")
        if timeout is not None and timeout < 0 and timeout != -1:
            raise ValueError("timeout value must be a non-negative number")
        if self._v.acquire(False):
            return True
        if not blocking:
            return False
        if not _peut_attendre():
            if timeout == -1:
                raise RuntimeError(
                    "interblocage : ce verrou est déjà pris et rien ne peut le relâcher "
                    "(pas de fils d'exécution dans le navigateur)"
                )
            return self._v.acquire(True, timeout)
        fin = None if timeout == -1 else time.monotonic() + timeout
        while not self._v.acquire(False):
            if fin is not None and time.monotonic() >= fin:
                return False
            _attendre(_ui.dormir(10))
        return True

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *exc):
        self._v.release()

    def release(self):
        self._v.release()

    def locked(self):
        return self._v.locked()

    def _at_fork_reinit(self):
        self._v._at_fork_reinit()


threading.Lock = _Verrou

# ─── asyncio : la page a déjà une boucle d'événements ───

_jeton_run = contextvars.ContextVar("atelier_asyncio_run", default=None)


def _contexte(t):
    try:
        return t.get_context()
    except Exception:
        return {}


def _annuler_taches(filtre):
    try:
        taches = [t for t in asyncio.all_tasks() if not t.done() and filtre(t)]
    except RuntimeError:
        return []
    for t in taches:
        t.cancel("arrêt demandé")
    return taches


def interrompre():
    """« Arrêter » (appelé par la page) : annule les tâches asyncio des exécutions qui attendent un await
    (asyncio.sleep, requête…). Une tâche suspendue dans une attente de la console (time.sleep, input,
    mainloop : pas de _fut_waiter) n'est pas annulée : cette attente lève elle-même l'interruption."""
    _annuler_taches(lambda t: getattr(t, "_fut_waiter", None) is not None and _contexte(t).get(_execution) is not None)


def _run_bloquant(main, annuler_restantes=True):
    """asyncio.run() avec JSPI : bloque jusqu'à la fin de main(), renvoie sa valeur ou propage son exception,
    comme CPython. « Arrêter » annule main (CancelledError) puis lève KeyboardInterrupt ; les tâches créées
    par main et encore en cours à la fin sont annulées (sauf pour run_until_complete, comme CPython)."""
    from pyodide.ffi import run_sync

    jeton = object()
    boite = {}

    async def _principale():
        # Valeur et exception restent côté Python : rien ne traverse la page (ni traceback affiché en double,
        # ni BaseException qui casserait sa boucle d'événements) ; elles sont rendues à l'appelant.
        _jeton_run.set(jeton)
        try:
            boite["valeur"] = await main
        except BaseException as e:
            boite["exc"] = e

    _vider_flux()
    n0 = _ui.numeroArret()
    tache = asyncio.ensure_future(_principale())
    try:
        run_sync(tache)
    except asyncio.CancelledError:  # tâche annulée avant même d'avoir démarré main
        boite.setdefault("exc", asyncio.CancelledError())
    finally:
        # Comme CPython : les tâches créées par main et encore en cours sont annulées, et leur nettoyage
        # (except CancelledError, finally) a lieu avant le retour (attente bornée à 1 s).
        restantes = (
            _annuler_taches(lambda t: t is not tache and _contexte(t).get(_jeton_run) is jeton) if annuler_restantes else []
        )
        if restantes:
            try:
                run_sync(asyncio.wait(restantes, timeout=1.0))
            except BaseException:
                pass
    e = boite.pop("exc", None)
    if e is None:
        return boite.get("valeur")
    if isinstance(e, asyncio.CancelledError) and _ui.numeroArret() != n0:
        _ui.arretVu()
        raise _exception_arret() from None
    raise e


def _run(main, *, debug=None, loop_factory=None):
    if not asyncio.iscoroutine(main):
        raise ValueError(f"a coroutine was expected, got {main!r}")
    if _peut_attendre():
        return _run_bloquant(main)

    # Sans JSPI, impossible de bloquer : main() tourne en tâche (le code qui suit s'exécute avant elle).
    async def _garde():
        # Une exception (ou sys.exit) dans la tâche ne doit pas arrêter la boucle de la page.
        try:
            return await main
        except SystemExit as e:
            _signaler_sortie(e)
        except KeyboardInterrupt:
            print("[programme interrompu]", file=sys.stderr)
        except asyncio.CancelledError:
            print("[programme interrompu : arrêt demandé]", file=sys.stderr)
        except BaseException:
            traceback.print_exc()
        finally:
            _vider_flux()

    asyncio.ensure_future(_garde())
    return None


asyncio.run = _run

try:
    from pyodide.webloop import WebLoop as _WebLoop
except ImportError:
    _WebLoop = None

if _WebLoop is not None and not getattr(_WebLoop.run_until_complete, "_atelier", False):
    _ruc_pyodide = _WebLoop.run_until_complete

    def _run_until_complete(self, future):
        # CPython bloque jusqu'au résultat ; la boucle de Pyodide renverrait une tâche encore en cours.
        # Contrairement à asyncio.run, les autres tâches ne sont pas annulées à la fin.
        if _peut_attendre():
            return _run_bloquant(future, annuler_restantes=False)
        print(
            "Avertissement : sans JSPI (navigateur autre que Chrome récent), loop.run_until_complete() ne peut "
            "pas attendre ; la coroutine tourne en arrière-plan et l'appel renvoie une tâche, pas son résultat.",
            file=sys.stderr,
        )
        return _ruc_pyodide(self, future)

    _run_until_complete._atelier = True
    _WebLoop.run_until_complete = _run_until_complete

if hasattr(asyncio, "Runner") and not getattr(asyncio.Runner, "_atelier", False):

    class _Runner(asyncio.Runner):
        """with asyncio.Runner() as r: r.run(main()) — la boucle de la page tourne déjà : même attente que
        asyncio.run (JSPI) au lieu de « cannot be called from a running event loop »."""

        _atelier = True

        def _sur_la_page(self):
            return self._loop_factory is None and _peut_attendre()

        def _lazy_init(self):
            # Pas de nouvelle boucle (elle remplacerait celle de la page) : celle de la page sert.
            if not self._sur_la_page() or self._state is not asyncio.runners._State.CREATED:
                return super()._lazy_init()
            self._loop = asyncio.get_event_loop()
            self._page = True
            self._context = contextvars.copy_context()
            self._state = asyncio.runners._State.INITIALIZED

        def run(self, coro, *, context=None):
            if not self._sur_la_page():
                return super().run(coro, context=context)
            if not asyncio.iscoroutine(coro):
                raise ValueError(f"a coroutine was expected, got {coro!r}")
            self._lazy_init()
            return _run_bloquant(coro, annuler_restantes=False)

        def close(self):
            if getattr(self, "_page", False):
                self._loop = None
                self._state = asyncio.runners._State.CLOSED
                return
            super().close()

    asyncio.Runner = asyncio.runners.Runner = _Runner

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


# ─── Modules manquants : chargés depuis la distribution Pyodide (PyPI seulement via pip) ───


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


def _modules_du_projet():
    noms = set()
    for f in _fichiers_python():
        noms.update(p for p in os.path.splitext(f)[0].split(os.sep) if p not in ("", ".", ".."))
    return noms


async def preparer_imports(*sources):
    """Charge les paquets de la distribution Pyodide importés par le code.

    Jamais d'installation automatique depuis PyPI : un nom importé (souvent un module local, ou un
    paquet inventé par l'IA) pourrait y être déposé par n'importe qui et s'exécuterait sur l'origine
    de la page. PyPI passe uniquement par une commande pip explicite (suggérée à l'erreur d'import)."""
    noms = _imports(sources) - set(sys.builtin_module_names)
    manquants = {n for n in noms if n and importlib.util.find_spec(n) is None}
    if manquants:
        manquants = sorted(manquants - _locaux() - _modules_du_projet())
    if not manquants:
        return
    import pyodide_js

    try:
        await pyodide_js.loadPackagesFromImports("\n".join(f"import {n}" for n in manquants))
    except Exception:
        pass
    importlib.invalidate_caches()


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


_blocs = set()  # exécutions lancées par le bouton « Exécuter » d'un bloc du chat (option « neuf »)


def _fermer_fenetres_precedentes(choisir=None):
    """Ferme les fenêtres (tkinter, turtle) des exécutions retenues par choisir(ident) — toutes sans filtre."""
    for ident in list(_env_programmes):
        if choisir is None or choisir(ident):
            del _env_programmes[ident]
    if "turtle" in sys.modules:
        try:
            sys.modules["turtle"]._reinitialiser(choisir)
        except Exception:
            pass
    if "tkinter" in sys.modules:
        try:
            sys.modules["tkinter"]._tout_detruire(choisir)
        except Exception:
            pass


def _fenetres_ouvertes():
    tk = sys.modules.get("tkinter")
    try:
        return bool(tk._fenetres_ouvertes()) if hasattr(tk, "_fenetres_ouvertes") else False
    except Exception:
        return False


_cwd_a_retablir = [None]


def _retablir_dossier():
    """Un programme a changé de dossier (os.chdir) puis s'est terminé fenêtres ouvertes : le dossier de la
    console est rétabli au lancement suivant (ses fenêtres sont alors fermées)."""
    d, _cwd_a_retablir[0] = _cwd_a_retablir[0], None
    if d:
        try:
            os.chdir(d)
        except OSError:
            pass


def _repartir_a_neuf(ident=None):
    """Bouton « Exécuter » d'un bloc de code : repart d'un état propre (fenêtres, tortue, figures, dossier).
    Seul ce qu'ont ouvert les blocs précédents est fermé : un programme de la console continue (comme deux
    processus distincts)."""
    choisir = _blocs.__contains__
    _retablir_dossier()
    _fermer_fenetres_precedentes(choisir)
    if ident is not None:
        _blocs.add(ident)
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None:
        try:
            from matplotlib._pylab_helpers import Gcf

            for n, m in list(Gcf.figs.items()):
                if choisir(getattr(m.canvas.figure, "_atelier_execution", None)):
                    plt.close(n)
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


async def cellule(code, ident=None):
    """Exécute une cellule de la console (comme runPythonAsync), dans la tâche asyncio de l'exécution
    « ident » (sa sortie et ses saisies lui reviennent). SystemExit et KeyboardInterrupt sont traités ici :
    sortis de la cellule, ils arrêteraient la boucle d'événements de la page. « Arrêter » pendant un await
    du code (asyncio.sleep…) annule la tâche : l'annulation est convertie en interruption."""
    from pyodide.code import eval_code_async

    import __main__

    tache = asyncio.current_task()
    if tache is not None:
        _cellules.add(tache)
    _execution.set(ident)
    n0 = _ui.numeroArret()
    tortue = sys.modules.get("turtle")
    if tortue is not None and hasattr(tortue, "TurtleScreen"):
        # Fenêtre turtle fermée après la fin d'un programme sans done() : pas de Terminator résiduel.
        try:
            tortue.TurtleScreen._RUNNING = True
        except Exception:
            pass
    try:
        return await eval_code_async(code, __main__.__dict__, filename="<exec>")
    except SystemExit as e:
        _signaler_sortie(e)
        if e.code is None and re.fullmatch(r"\s*(exit|quit)\(\s*\)\s*", code):
            print("(la console reste ouverte : les variables sont conservées)")
    except KeyboardInterrupt as e:
        print(f"[programme interrompu{' : ' + str(e) if str(e) else ''}]", file=sys.stderr)
    except asyncio.CancelledError:
        if _ui.numeroArret() == n0:
            raise  # annulation demandée par le programme lui-même
        _ui.arretVu()
        print("[programme interrompu : arrêt demandé]", file=sys.stderr)
    return None


async def preparer(code, ident=None):
    """Avant l'exécution « ident » : paquets importés par le code chargés ou installés (messages vers elle)."""
    _execution.set(ident)
    await preparer_imports(code)


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


# runpy.run_path(chemin absolu) donne __file__ absolu comme CPython ≥ 3.9, mais mettrait aussi le chemin
# absolu dans sys.argv[0] : CPython y garde le chemin tapé (« python main.py » → « main.py »).
_argv0 = contextvars.ContextVar("atelier_argv0", default=None)
if hasattr(runpy, "_ModifiedArgv0") and not getattr(runpy._ModifiedArgv0, "_atelier", False):

    class _Argv0(runpy._ModifiedArgv0):
        _atelier = True

        def __init__(self, valeur):
            tape = _argv0.get()
            super().__init__(valeur if tape is None else tape)

    runpy._ModifiedArgv0 = _Argv0

_main_programme = [None]  # module __main__ temporaire de runpy (pickle, shelve le cherchent dans sys.modules)
if hasattr(runpy, "_TempModule") and not getattr(runpy._TempModule, "_atelier", False):

    class _ModuleTemp(runpy._TempModule):
        _atelier = True

        def __enter__(self):
            if self.mod_name == "__main__":
                _main_programme[0] = self.module
            return super().__enter__()

    runpy._TempModule = _ModuleTemp


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
    _retablir_dossier()  # le fichier se cherche dans le dossier de la console, pas dans celui d'un programme précédent
    chemin = None
    if script is not None:
        chemin = _trouver_script(script)
        if chemin is None:
            return
    _fermer_fenetres_precedentes(lambda i: i not in _blocs)  # pas celles d'un bloc « Exécuter » du chat
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
    # Comme un processus à part : argv, sys.path, flux standard et dossier courant rétablis à la fin.
    ancien_argv, ancien_path = sys.argv[:], sys.path[:]
    anciens_flux = (sys.stdin, sys.stdout, sys.stderr)
    ancien_cwd = os.getcwd()
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
            jeton = _argv0.set(script)
            try:
                runpy.run_path(chemin, run_name="__main__")  # __file__ absolu, comme CPython ≥ 3.9
            finally:
                _argv0.reset(jeton)
    except SystemExit as e:
        _signaler_sortie(e)
    except KeyboardInterrupt as e:
        print(f"[programme interrompu{' : ' + str(e) if str(e) else ''}]", file=sys.stderr)
    except BaseException:
        _afficher_erreur()
    finally:
        _vider_flux()
        programme = {"argv": sys.argv, "path": sys.path[:], "flux": (sys.stdin, sys.stdout, sys.stderr),
                     "main": _main_programme[0]}
        _main_programme[0] = None
        sys.argv = ancien_argv
        sys.path[:] = ancien_path
        sys.stdin, sys.stdout, sys.stderr = anciens_flux
        if _fenetres_ouvertes():
            _env_programmes[_ident()] = programme
        try:
            change = os.getcwd() != ancien_cwd
        except OSError:
            change = True
        if change:
            if _fenetres_ouvertes():
                _cwd_a_retablir[0] = ancien_cwd  # ses rappels lisent peut-être encore des chemins relatifs
            else:
                try:
                    os.chdir(ancien_cwd)
                except OSError:
                    pass
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
    lanceur = sys.modules.get("atelier_run")
    ident = lanceur._ident() if hasattr(lanceur, "_ident") else None  # exécution qui affiche la figure
    _ui.image("data:image/png;base64," + base64.b64encode(png).decode(), fig._atelier_numero, ident)
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
    def __init__(self, figure=None):
        super().__init__(figure)
        lanceur = sys.modules.get("atelier_run")
        # Exécution qui a créé la figure : « Exécuter » d'un bloc ne ferme que les figures des blocs précédents.
        self.figure._atelier_execution = lanceur._ident() if hasattr(lanceur, "_ident") else None

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
