/**
 * Module Python `tkinter` de la console du navigateur : mêmes classes et méthodes que tkinter, mais
 * les fenêtres sont dessinées en HTML par `fenetres.ts` (Pyodide n'a pas Tcl/Tk). Exécuté dans
 * Pyodide ; communique avec le moteur par le module JS `atelier_ui`.
 */
export const TK_INIT = String.raw`
"""tkinter pour la console Python du navigateur : les fenêtres sont dessinées en HTML dans la page."""

import base64
import enum
import itertools
import re
import struct
import sys
import time
import traceback

import asyncio

import js
from pyodide.ffi import create_once_callable, create_proxy, to_js

try:  # JSPI : un appel Python peut attendre une promesse sans figer la page (Chrome ≥ 137…)
    from pyodide.ffi import can_run_sync as _peut_suspendre, run_sync as _attendre_promesse
except ImportError:
    def _peut_suspendre():
        return False

    _attendre_promesse = None

import atelier_ui as _ui
from tkinter.constants import *

TkVersion = 8.6
TclVersion = 8.6
READABLE = 2
WRITABLE = 4
EXCEPTION = 8
wantobjects = 1


class TclError(Exception):
    pass


_compteur = itertools.count(1)
_widgets = {}
_variables = {}
_images = {}
_commandes = {}
_tout = {}
_classes = {}
_minuteries = {}
_noms_minuterie = itertools.count(1)
_default_root = None
_focus = {}
_pointeur = [0, 0]


def _js(v):
    return to_js(v, dict_converter=js.Object.fromEntries)


def _py(v):
    return v.to_py() if hasattr(v, "to_py") else v


# ─────────────────────────── Conversions Tk → CSS ───────────────────────────

_SYSTEME = {
    "systembuttonface": "#f0f0f0", "systemwindow": "#ffffff", "systembuttontext": "#000000",
    "systemwindowtext": "#000000", "systemhighlight": "#0078d7", "systemhighlighttext": "#ffffff",
    "systemmenu": "#f0f0f0", "systemscrollbar": "#c8c8c8", "systemdisabledtext": "#6d6d6d",
    "systemtransparent": "transparent", "systembackground": "#f0f0f0", "systemtextcolor": "#000000",
}


def _couleur(c):
    if c is None:
        return None
    c = str(c).strip()
    if not c:
        return ""
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 12:
            return "#" + h[0:2] + h[4:6] + h[8:10]
        if len(h) == 9:
            return "#" + h[0:2] + h[3:5] + h[6:8]
        return c
    b = c.lower().replace(" ", "")
    if b in _SYSTEME:
        return _SYSTEME[b]
    m = re.fullmatch(r"gr[ae]y(\d{1,3})", b)
    if m:
        v = round(min(100, int(m.group(1))) * 2.55)
        return f"rgb({v},{v},{v})"
    m = re.fullmatch(r"([a-z]+?)([1-4])", b)
    if m:
        f = {"1": 100, "2": 93, "3": 80, "4": 55}[m.group(2)]
        return f"color-mix(in srgb, {m.group(1)} {f}%, black)"
    return b


def _pixels(v, defaut=0):
    if v is None or v == "":
        return defaut
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    m = re.fullmatch(r"(-?[\d.]+)\s*([cimp]?)", s)
    if not m:
        return defaut
    n = float(m.group(1))
    return n * {"": 1, "c": 37.8, "m": 3.78, "i": 96, "p": 1.333}[m.group(2)]


_FAMILLES_TK = {"tkdefaultfont", "tktextfont", "tkheadingfont", "tkmenufont", "tkcaptionfont", "tksmallcaptionfont", "tkiconfont", "tktooltipfont"}


def _decomposer_police(f):
    """(famille, taille, [styles]) d'une police Tk : tuple, chaîne « Arial 12 bold », objet Font."""
    if isinstance(f, str):
        if f in _polices_nommees:
            p = _polices_nommees[f]
            return p._famille, p._taille, p._styles()
        m = re.match(r"\s*\{([^}]*)\}\s*(.*)", f)
        parts = [m.group(1)] + m.group(2).split() if m else f.split()
    else:
        parts = list(f)
    if not parts:
        return "TkDefaultFont", 10, []
    famille, taille, styles = str(parts[0]), 10, []
    if len(parts) > 1:
        try:
            taille = int(float(parts[1]))
        except (TypeError, ValueError):
            styles.extend(str(parts[1]).split())
    for p in parts[2:]:
        styles.extend(str(p).split())
    return famille, taille, styles


def _css_police(famille, taille, styles):
    s = [x.lower() for x in styles]
    poids = "bold" if "bold" in s else "normal"
    style = "italic" if "italic" in s else "normal"
    px = f"{-taille}px" if taille < 0 else (f"{taille * 4 / 3:.1f}px" if taille else "13px")
    fl = famille.lower()
    if fl in _FAMILLES_TK or fl in ("", "segoe ui", "helvetica", "arial", "sans-serif"):
        fam = f'"{famille}", "Segoe UI", system-ui, sans-serif' if fl not in _FAMILLES_TK else '"Segoe UI", system-ui, sans-serif'
    elif fl in ("courier", "courier new", "consolas", "monospace", "tkfixedfont", "monaco", "menlo", "fixedsys"):
        fam = f'"{famille}", Consolas, "Courier New", monospace'
    elif fl in ("times", "times new roman", "georgia", "serif"):
        fam = f'"{famille}", Georgia, "Times New Roman", serif'
    else:
        fam = f'"{famille}", "Segoe UI", system-ui, sans-serif'
    return f"{style} {poids} {px} {fam}"


def _police(f):
    if f is None or f == "":
        return None
    if hasattr(f, "_css"):
        return f._css()
    if isinstance(f, str) and f.lower() == "tkfixedfont":
        return '13px Consolas, "Courier New", monospace'
    return _css_police(*_decomposer_police(f))


def _taille_police(f):
    if not f:
        return 10
    try:
        return abs(_decomposer_police(f)[1]) or 10
    except Exception:
        return 10


def _taille_image(o):
    try:
        if o[:8] == b"\x89PNG\r\n\x1a\n":
            return struct.unpack(">II", o[16:24])
        if o[:4] == b"GIF8":
            return struct.unpack("<HH", o[6:10])
        if o[:2] == b"\xff\xd8":
            i = 2
            while i < len(o) - 9:
                if o[i] != 0xFF:
                    i += 1
                    continue
                marqueur = o[i + 1]
                longueur = struct.unpack(">H", o[i + 2:i + 4])[0]
                if marqueur in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, l = struct.unpack(">HH", o[i + 5:i + 9])
                    return l, h
                i += 2 + longueur
    except Exception:
        pass
    return 0, 0


def _aplatir(args):
    out = []
    for a in args:
        if isinstance(a, (list, tuple)):
            out.extend(_aplatir(a))
        else:
            out.append(float(a))
    return out


# ─────────────────────────── Rappels et erreurs ───────────────────────────

def _rapporter():
    racine = _default_root
    exc, val, tb = sys.exc_info()
    if racine is not None and getattr(racine, "report_callback_exception", None) and type(racine).report_callback_exception is not Tk.report_callback_exception:
        try:
            racine.report_callback_exception(exc, val, tb)
            return
        except Exception:
            pass
    print("Exception in Tkinter callback", file=sys.stderr)
    traceback.print_exception(exc, val, tb, file=sys.stderr)


def _appeler(fn, *args):
    try:
        _demarrer_tranche()
        return fn(*args)
    except SystemExit as e:
        _sortie_demandee(e)
    except KeyboardInterrupt:
        if _ui.arretDemande():
            _tout_detruire()  # bouton « Arrêter » pendant un rappel qui attendait
        else:
            _rapporter()
    except BaseException:
        _rapporter()
    return None


# ─────────────────────────── Attentes (JSPI) ───────────────────────────
# Avec JSPI, mainloop() attend vraiment la fermeture des fenêtres, update() et time.sleep() rendent la main
# au navigateur (la page se redessine, les clics arrivent). Sans JSPI (ou dans un rappel sans « suspender »),
# on garde le fonctionnement sans attente : mainloop() rend la main tout de suite.

_attentes = []  # boucles mainloop / wait_window / wait_variable en attente : [{"fut", "quitte"}]
_sortie = [None]  # sys.exit() appelé dans un rappel : la boucle principale le relance


def _peut_attendre():
    try:
        return bool(_peut_suspendre()) and not getattr(js, "__atelierSansJSPI", False)
    except Exception:
        return False


def _verifier_arret():
    if _ui.arretDemande():
        raise KeyboardInterrupt("arrêt demandé")


def _ceder(secondes=0.0):
    """Rend la main au navigateur (dessin, événements) : pour update() et time.sleep()."""
    _attendre_promesse(asyncio.sleep(max(0.0, float(secondes))))
    _verifier_arret()


def _attendre(condition, attente=None):
    """Attend (sans figer la page) que condition() devienne fausse ; réveillée à chaque changement."""
    moi = attente if attente is not None else {"fut": None, "quitte": False}
    _attentes.append(moi)
    _ui.attente(1)
    try:
        while condition() and not moi["quitte"]:
            moi["fut"] = asyncio.get_event_loop().create_future()
            _attendre_promesse(moi["fut"])
            _verifier_arret()
            if _sortie[0] is not None:
                e, _sortie[0] = _sortie[0], None
                raise e
    finally:
        _ui.attente(-1)
        if moi in _attentes:
            _attentes.remove(moi)
    return moi["quitte"]


def _reveiller():
    """Un état a changé (fenêtre détruite, variable écrite, quit) : chaque attente revérifie sa condition."""
    for a in list(_attentes):
        f = a.get("fut")
        if f is not None and not f.done():
            f.set_result(None)


def _sortie_demandee(e):
    """sys.exit() dans un rappel : comme Tk, le programme s'arrête (fenêtres fermées, mainloop relance)."""
    if any(a.get("boucle") for a in _attentes):
        _sortie[0] = e
    _tout_detruire()


def _fenetres_ouvertes():
    return any(isinstance(w, Wm) and not w._detruit for w in list(_widgets.values()))


def _boucle_principale():
    """mainloop() : attend la fermeture de toutes les fenêtres ou quit() (la plus récente boucle seulement)."""
    if not _peut_attendre() or not _fenetres_ouvertes():
        return
    if _attendre(_fenetres_ouvertes, {"fut": None, "quitte": False, "boucle": True}):
        _quitte[0] = True


_quitte = [False]


def _apres_execution():
    """Fin d'une exécution de la console : un programme sorti de mainloop() par quit() se termine, ses
    fenêtres se ferment (comme à la fin d'un vrai processus)."""
    if _quitte[0]:
        _quitte[0] = False
        if not any(a.get("boucle") for a in _attentes):
            _tout_detruire()


_debut_tranche = [None]


def _demarrer_tranche():
    _debut_tranche[0] = time.monotonic()
    lanceur = sys.modules.get("atelier_run")
    if lanceur is not None:
        lanceur._debut_execution()  # le garde-fou de time.sleep compte par rappel, pas depuis le lancement


def _surveiller_boucle():
    """update() appelé en boucle sans rendre la main : au-delà de 3 s, on arrête plutôt que de figer la page."""
    maintenant = time.monotonic()
    if _debut_tranche[0] is None:
        _debut_tranche[0] = maintenant
        js.setTimeout(create_once_callable(lambda: _debut_tranche.__setitem__(0, None)), 0)
    elif maintenant - _debut_tranche[0] > 3:
        _debut_tranche[0] = None
        raise RuntimeError(
            "Boucle sans fin avec update() : dans le navigateur, la fenêtre ne peut se redessiner que si le "
            "programme rend la main. Remplacez « while True: … update(); time.sleep(…) » par une fonction "
            "qui se reprogramme avec root.after(millisecondes, fonction)."
        )


def _rappel(cible, type_, donnees):
    r = None
    try:
        w = _widgets.get(int(cible))
        if w is not None:
            r = w._recevoir(str(type_), _py(donnees) or {})
    except SystemExit as e:
        _sortie_demandee(e)
    except KeyboardInterrupt:
        _tout_detruire() if _ui.arretDemande() else _rapporter()
    except BaseException:
        _rapporter()
    # Appel « promettant » (JSPI) : la page lit ce résultat tout de suite si le rappel n'a pas attendu.
    _ui.retour(r if isinstance(r, str) else None)
    return r


_ui.definirRappel(create_proxy(_rappel), _peut_attendre())


# ─────────────────────────── Séquences d'événements ───────────────────────────

class EventType(str, enum.Enum):
    KeyPress = "2"
    Key = "2"
    KeyRelease = "3"
    ButtonPress = "4"
    Button = "4"
    ButtonRelease = "5"
    Motion = "6"
    Enter = "7"
    Leave = "8"
    FocusIn = "9"
    FocusOut = "10"
    Expose = "12"
    Visibility = "15"
    Destroy = "17"
    Unmap = "18"
    Map = "19"
    Configure = "22"
    MouseWheel = "38"
    Activate = "36"
    Deactivate = "37"
    VirtualEvent = "35"

    def __str__(self):
        return self.name


class Event:
    def __init__(self, **kw):
        self.serial = 0
        self.num = "??"
        self.height = "??"
        self.width = "??"
        self.keycode = "??"
        self.state = 0
        self.time = int(time.time() * 1000)
        self.x = self.y = self.x_root = self.y_root = 0
        self.char = ""
        self.send_event = False
        self.keysym = "??"
        self.keysym_num = 0
        self.type = None
        self.widget = None
        self.delta = 0
        self.__dict__.update(kw)

    def __repr__(self):
        champs = {k: v for k, v in self.__dict__.items() if v not in ("??", None, "")}
        return f"<{self.type} event " + " ".join(f"{k}={v!r}" for k, v in champs.items() if k != "type") + ">"


_TYPES = {
    "key": "KeyPress", "keypress": "KeyPress", "keyrelease": "KeyRelease", "button": "ButtonPress",
    "buttonpress": "ButtonPress", "buttonrelease": "ButtonRelease", "motion": "Motion", "enter": "Enter",
    "leave": "Leave", "focusin": "FocusIn", "focusout": "FocusOut", "configure": "Configure",
    "destroy": "Destroy", "mousewheel": "MouseWheel", "map": "Map", "unmap": "Unmap", "expose": "Expose",
    "visibility": "Visibility", "activate": "Activate", "deactivate": "Deactivate",
}
_MODS = {
    "control": "Control", "shift": "Shift", "alt": "Alt", "option": "Alt", "command": "Control", "meta": "Control",
    "mod1": "Alt", "m1": "Alt", "lock": "Lock", "double": "Double", "triple": "Triple", "b1": "B1", "b2": "B2",
    "b3": "B3", "button1": "B1", "button2": "B2", "button3": "B3", "any": "Any",
}
_DOM = {
    "KeyPress": ["keydown"], "KeyRelease": ["keyup"], "ButtonPress": ["mousedown", "contextmenu"],
    "ButtonRelease": ["mouseup"], "Motion": ["mousemove"], "Enter": ["mouseover"], "Leave": ["mouseout"],
    "MouseWheel": ["wheel"], "FocusIn": ["focusin"], "FocusOut": ["focusout"],
}


def _analyser(seq):
    """« <Control-Shift-KeyPress-a> » → (modificateurs, type, détail)."""
    seq = str(seq).strip()
    if seq.startswith("<<") and seq.endswith(">>"):
        return (frozenset(), "Virtual", seq)
    if not (seq.startswith("<") and seq.endswith(">")):
        return (frozenset(), "KeyPress", seq)
    parts = seq[1:-1].split("-")
    if seq[1:-1].endswith("-"):  # « <Control-minus> » s'écrit sans « - » nu ; garde-fou
        parts = [p for p in parts if p] + ["minus"]
    mods, type_, detail = set(), None, None
    for i, p in enumerate(parts):
        pl = p.lower()
        dernier = i == len(parts) - 1
        if type_ is None and detail is None and pl in _MODS and not dernier:
            mods.add(_MODS[pl])
        elif type_ is None and pl in _TYPES:
            type_ = _TYPES[pl]
        elif p.isdigit() and type_ in (None, "ButtonPress", "ButtonRelease"):
            detail = p
            type_ = type_ or "ButtonPress"
        else:
            detail = p
            type_ = type_ or "KeyPress"
    if "Double" in mods or "Triple" in mods:
        type_ = type_ or "ButtonPress"
    return (frozenset(mods), type_ or "KeyPress", detail)


def _correspond(motif, ev):
    mods, type_, detail = motif
    if type_ != ev["type"]:
        return False
    if ("Double" in mods) != ev.get("double", False):
        return False
    if detail is not None:
        d = ev.get("detail")
        if type_ in ("KeyPress", "KeyRelease"):
            if d != detail and not (len(detail) == 1 and ev.get("char") == detail):
                return False
        elif str(d) != str(detail):
            return False
    actifs = ev.get("mods", set())
    for m in mods:
        if m in ("Double", "Triple", "Any"):
            continue
        if m not in actifs:
            return False
    return True


def _specificite(motif):
    mods, _, detail = motif
    return (detail is not None) * 10 + len([m for m in mods if m not in ("Any",)])


def _choisir(liaisons, ev):
    meilleur, score = None, -1
    for motif, fns in liaisons.items():
        if fns and _correspond(motif, ev):
            s = _specificite(motif)
            if s > score:
                meilleur, score = fns, s
    return meilleur or []


# ─────────────────────────── Variables ───────────────────────────

class Variable:
    _default = ""
    _noms = itertools.count()

    _ecritures = 0

    def __init__(self, master=None, value=None, name=None):
        self._name = name or f"PY_VAR{next(Variable._noms)}"
        self._valeur = self._default if value is None else value
        self._traces = {}
        self._liens = []
        self._root = master or _default_root
        _variables[self._name] = self

    def __str__(self):
        return self._name

    def __repr__(self):
        return f"<{type(self).__name__} {self._name!r}>"

    def set(self, value):
        self._valeur = value
        for w in list(self._liens):
            try:
                w._variable_changee(self)
            except Exception:
                pass
        self._declencher("write")

    initialize = set

    def get(self):
        self._declencher("read")
        return self._valeur

    def _declencher(self, mode):
        if mode == "write":
            self._ecritures += 1
            if _attentes:
                _reveiller()  # wait_variable()
        for nom, (modes, fn) in list(self._traces.items()):
            if mode in modes or mode[0] in modes:
                _appeler(fn, self._name, "", mode)

    def trace_add(self, mode, callback):
        modes = (mode,) if isinstance(mode, str) else tuple(mode)
        nom = f"{id(callback)}_{next(_compteur)}"
        self._traces[nom] = (modes, callback)
        return nom

    def trace_remove(self, mode, cbname):
        self._traces.pop(cbname, None)

    def trace_info(self):
        return [(m, n) for n, (m, _) in self._traces.items()]

    def trace_variable(self, mode, callback):
        modes = tuple({"w": "write", "r": "read", "u": "unset"}.get(c, c) for c in mode)
        nom = f"{id(callback)}_{next(_compteur)}"
        self._traces[nom] = (modes, callback)
        return nom

    trace = trace_variable

    def trace_vdelete(self, mode, cbname):
        self._traces.pop(cbname, None)

    def trace_vinfo(self):
        return self.trace_info()

    def _lier(self, w):
        if w not in self._liens:
            self._liens.append(w)

    def _delier(self, w):
        if w in self._liens:
            self._liens.remove(w)


class StringVar(Variable):
    _default = ""

    def get(self):
        v = super().get()
        return v if isinstance(v, str) else str(v)


class IntVar(Variable):
    _default = 0

    def get(self):
        v = super().get()
        if isinstance(v, bool):
            return int(v)
        try:
            return int(v)
        except (TypeError, ValueError):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                raise TclError(f'expected floating-point number but got "{v}"')


class DoubleVar(Variable):
    _default = 0.0

    def get(self):
        v = super().get()
        try:
            return float(v)
        except (TypeError, ValueError):
            raise TclError(f'expected floating-point number but got "{v}"')


class BooleanVar(Variable):
    _default = False

    def set(self, value):
        super().set(getboolean(value))

    def get(self):
        return getboolean(super().get())

    initialize = set


def _meme_valeur(var, v):
    """Valeur d'une variable comparée à onvalue / value : BooleanVar True == 1 == « 1 », IntVar 1 == « 1 »."""
    x = var._valeur
    if x == v or str(x) == str(v):
        return True
    if isinstance(var, BooleanVar) or isinstance(x, bool) or isinstance(v, bool):
        try:
            return getboolean(x) == getboolean(v)
        except Exception:
            return False
    return False


def getint(s):
    return int(s)


def getdouble(s):
    return float(s)


def getboolean(s):
    if isinstance(s, str):
        b = s.strip().lower()
        if b in ("1", "true", "yes", "on"):
            return True
        if b in ("0", "false", "no", "off", ""):
            return False
        raise TclError(f'expected boolean value but got "{s}"')
    return bool(s)


# ─────────────────────────── Images ───────────────────────────

class Image:
    _noms = itertools.count(1)

    def __init__(self, imgtype="photo", name=None, cnf={}, master=None, **kw):
        self.name = name or f"pyimage{next(Image._noms)}"
        self._src = None
        self._l = 0
        self._h = 0
        self._ex = 1.0
        self._ey = 1.0
        self._utilisateurs = []
        _images[self.name] = self

    def __str__(self):
        return self.name

    def width(self):
        return int(self._l * self._ex)

    def height(self):
        return int(self._h * self._ey)

    def _desc(self):
        return {"src": self._src, "largeur": self.width(), "hauteur": self.height()}

    def type(self):
        return "photo"

    def _avertir(self):
        for w in list(self._utilisateurs):
            try:
                w._image_changee()
            except Exception:
                pass


_cache_rgb = {}


def _rgb(c):
    """Couleur Tk / CSS → (r, g, b, a) ; None si inconnue. Les noms sont résolus par le navigateur."""
    c = str(c).strip()
    if c in _cache_rgb:
        return _cache_rgb[c]
    css = _couleur(c) or ""
    r = None
    h = css[1:] if css.startswith("#") else ""
    if h and all(x in "0123456789abcdefABCDEF" for x in h) and len(h) in (3, 6, 9, 12):
        n = len(h) // 3
        r = tuple(int(h[i * n:(i + 1) * n], 16) * 255 // (16 ** n - 1) for i in range(3)) + (255,)
    elif css:
        v = str(_ui.rgb(css) or "")
        m = re.match(r"#([0-9a-f]{6})$", v)
        if m:
            r = tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
        else:
            m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)", v)
            if m:
                r = (int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3))), int(float(m.group(4) or 1) * 255))
    if len(_cache_rgb) < 4096:
        _cache_rgb[c] = r
    return r


def _png(l, h, px):
    """Pixels RGBA → PNG (zlib, sans dépendance)."""
    import zlib

    pas = l * 4
    brut = b"".join(b"\x00" + bytes(px[y * pas:(y + 1) * pas]) for y in range(h))

    def bloc(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", l, h, 8, 6, 0, 0, 0)) + bloc(b"IDAT", zlib.compress(brut, 1)) + bloc(b"IEND", b"")


def _depng(o):
    """PNG 8 bits non entrelacé (gris, RGB, palette, RGBA) → (l, h, pixels RGBA) ; None sinon."""
    import zlib

    if o[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat, palette, trns = 8, b"", b"", b""
    l = h = prof = typ = entrelace = 0
    while pos + 8 <= len(o):
        n = struct.unpack(">I", o[pos:pos + 4])[0]
        t, d = o[pos + 4:pos + 8], o[pos + 8:pos + 8 + n]
        pos += 12 + n
        if t == b"IHDR":
            l, h, prof, typ, _, _, entrelace = struct.unpack(">IIBBBBB", d)
        elif t == b"PLTE":
            palette = d
        elif t == b"tRNS":
            trns = d
        elif t == b"IDAT":
            idat += d
        elif t == b"IEND":
            break
    if prof != 8 or entrelace or typ not in (0, 2, 3, 4, 6):
        return None
    k = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[typ]
    brut = zlib.decompress(idat)
    pas = l * k
    lignes, prec, i = [], bytearray(pas), 0
    for _ in range(h):
        f, ligne = brut[i], bytearray(brut[i + 1:i + 1 + pas])
        i += 1 + pas
        if f == 1:
            for x in range(k, pas):
                ligne[x] = (ligne[x] + ligne[x - k]) & 255
        elif f == 2:
            ligne = bytearray((a + b) & 255 for a, b in zip(ligne, prec))
        elif f == 3:
            for x in range(pas):
                ligne[x] = (ligne[x] + ((ligne[x - k] if x >= k else 0) + prec[x]) // 2) & 255
        elif f == 4:
            for x in range(pas):
                a = ligne[x - k] if x >= k else 0
                b, c = prec[x], (prec[x - k] if x >= k else 0)
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                ligne[x] = (ligne[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        lignes.append(ligne)
        prec = ligne
    px = bytearray(l * h * 4)
    for y, ligne in enumerate(lignes):
        for x in range(l):
            o4 = (y * l + x) * 4
            if typ == 6:
                px[o4:o4 + 4] = ligne[x * 4:x * 4 + 4]
            elif typ == 2:
                px[o4:o4 + 3] = ligne[x * 3:x * 3 + 3]
                px[o4 + 3] = 255
            elif typ == 0:
                px[o4:o4 + 3] = bytes((ligne[x],)) * 3
                px[o4 + 3] = 255
            elif typ == 4:
                px[o4:o4 + 3] = bytes((ligne[x * 2],)) * 3
                px[o4 + 3] = ligne[x * 2 + 1]
            else:
                j = ligne[x]
                px[o4:o4 + 3] = palette[j * 3:j * 3 + 3]
                px[o4 + 3] = trns[j] if j < len(trns) else 255
    return l, h, px


class PhotoImage(Image):
    def __init__(self, name=None, cnf={}, master=None, file=None, data=None, width=None, height=None, format=None, **kw):
        super().__init__("photo", name, cnf, master)
        opts = {**cnf, **kw, "file": file, "data": data, "width": width, "height": height}
        self._charger(opts)

    def _charger(self, o):
        if o.get("file"):
            with open(o["file"], "rb") as f:
                self._octets(f.read())
        elif o.get("data") is not None:
            d = o["data"]
            if isinstance(d, (bytes, bytearray)) and not bytes(d[:4]).isascii():
                self._octets(bytes(d))
            else:
                try:
                    self._octets(base64.b64decode(d))
                except Exception:
                    raise TclError("couldn't recognize image data")
        l, h = o.get("width"), o.get("height")
        if l or h:
            self._taille_fixee = True
            self._px = None
        if l:
            self._l = int(l)
        if h:
            self._h = int(h)
        if self._src is None and self._l and self._h:
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{self._l}" height="{self._h}"></svg>'
            self._src = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()

    def _octets(self, o):
        mime = "image/png" if o[:8] == b"\x89PNG\r\n\x1a\n" else "image/gif" if o[:4] == b"GIF8" else "image/jpeg" if o[:2] == b"\xff\xd8" else "image/png"
        self._l, self._h = _taille_image(o)
        self._brut = o
        self._src = f"data:{mime};base64," + base64.b64encode(o).decode()

    def configure(self, **kw):
        self._charger(kw)
        self._avertir()

    config = configure

    def cget(self, option):
        return {"width": self._l, "height": self._h, "file": "", "data": ""}.get(option, "")

    def __getitem__(self, k):
        return self.cget(k)

    def _copie(self, ex, ey):
        p = PhotoImage.__new__(PhotoImage)
        Image.__init__(p)
        p._src, p._l, p._h, p._ex, p._ey = self._src, self._l, self._h, ex, ey
        return p

    def copy(self):
        return self._copie(self._ex, self._ey)

    def zoom(self, x, y=""):
        y = x if y == "" else y
        return self._copie(self._ex * x, self._ey * y)

    def subsample(self, x, y=""):
        y = x if y == "" else y
        return self._copie(self._ex / x, self._ey / y)

    # — pixels : tampon RGBA, réencodé en PNG après les modifications (une fois par rappel) —
    def _tampon(self):
        if getattr(self, "_px", None) is None:
            dec = _depng(self._brut) if getattr(self, "_brut", None) else None
            if dec and (dec[0], dec[1]) == (self._l, self._h):
                self._px = dec[2]
            else:
                self._px = bytearray(max(0, self._l) * max(0, self._h) * 4)
        return self._px

    def _agrandir(self, l, h):
        """Image sans taille fixée : elle s'agrandit pour recevoir les données de put(), comme dans Tk."""
        px = self._tampon()
        if l <= self._l and h <= self._h:
            return
        nl, nh = max(l, self._l), max(h, self._h)
        neuf = bytearray(nl * nh * 4)
        for y in range(self._h):
            neuf[y * nl * 4:(y * nl + self._l) * 4] = px[y * self._l * 4:(y + 1) * self._l * 4]
        self._px, self._l, self._h = neuf, nl, nh

    def _modifiee(self):
        if not getattr(self, "_encodage", False):
            self._encodage = True
            js.setTimeout(create_once_callable(self._encoder), 0)

    def _encoder(self):
        self._encodage = False
        o = _png(self._l, self._h, self._tampon())
        self._brut = o
        self._src = "data:image/png;base64," + base64.b64encode(o).decode()
        self._avertir()

    def blank(self):
        self._px = bytearray(self._l * self._h * 4)
        self._modifiee()

    def put(self, data, to=None):
        if isinstance(data, (list, tuple)):
            lignes = [list(r) if isinstance(r, (list, tuple)) else str(r).split() for r in data]
        else:
            t = str(data).strip()
            # Liste Tcl de lignes : « {#f00 #0f0} {...} » ; sans accolades, chaque couleur est une ligne.
            lignes = [g.split() for g in re.findall(r"\{([^}]*)\}", t)] if "{" in t else [[x] for x in t.split()]
        if not lignes or not lignes[0]:
            return
        pixels = [[_rgb(c) for c in ligne] for ligne in lignes]
        for ligne, brut in zip(pixels, lignes):
            for p, c in zip(ligne, brut):
                if p is None:
                    raise TclError(f'can\'t parse color "{c}"')
        dl, dh = max(len(r) for r in pixels), len(pixels)
        to = list(to) if to else [0, 0]
        if to and to[0] == "-to":
            to = to[1:]
        x1, y1 = int(to[0]), int(to[1])
        x2, y2 = (int(to[2]), int(to[3])) if len(to) >= 4 else (x1 + dl, y1 + dh)
        if not getattr(self, "_taille_fixee", False):
            self._agrandir(x2, y2)
        px = self._tampon()
        l = self._l
        for y in range(max(0, y1), min(y2, self._h)):
            ligne = pixels[(y - y1) % dh]
            for x in range(max(0, x1), min(x2, l)):
                c = ligne[(x - x1) % len(ligne)]
                o = (y * l + x) * 4
                px[o:o + 4] = bytes(c)
        self._modifiee()

    def get(self, x, y):
        x, y = int(x), int(y)
        if not (0 <= x < self._l and 0 <= y < self._h):
            raise TclError(f"{self.name} get: coordinates out of range")
        o = (y * self._l + x) * 4
        return tuple(self._tampon()[o:o + 3])

    def write(self, filename, format=None, from_coords=None):
        donnees = _png(self._l, self._h, self._px) if getattr(self, "_px", None) is not None else getattr(self, "_brut", b"")
        with open(filename, "wb") as f:
            f.write(donnees)

    def transparency_get(self, x, y):
        x, y = int(x), int(y)
        if not (0 <= x < self._l and 0 <= y < self._h):
            raise TclError(f"{self.name} transparency get: coordinates out of range")
        return self._tampon()[(y * self._l + x) * 4 + 3] == 0

    def transparency_set(self, x, y, boolean):
        x, y = int(x), int(y)
        if 0 <= x < self._l and 0 <= y < self._h:
            self._tampon()[(y * self._l + x) * 4 + 3] = 0 if boolean else 255
            self._modifiee()


class BitmapImage(Image):
    def __init__(self, name=None, cnf={}, master=None, **kw):
        super().__init__("bitmap", name, cnf, master)


def image_names():
    return tuple(_images)


def image_types():
    return ("photo", "bitmap")


def _desc_image(v):
    if v is None or v == "":
        return None
    if isinstance(v, Image):
        return v._desc()
    i = _images.get(str(v))
    return i._desc() if i else None


def _chaine_tcl(v):
    """Élément de liste Tk : un tuple devient une liste Tcl (« a b », « {a b} c »), comme dans Tk."""
    if isinstance(v, (list, tuple)):
        return " ".join("{" + str(x) + "}" if (" " in str(x) or not str(x)) else str(x) for x in v)
    return str(v)


# ─────────────────────────── Base des widgets ───────────────────────────

class _TkStub:
    """root.tk : quelques appels Tcl courants, sans effet."""

    def call(self, *args):
        return ""

    def eval(self, script):
        return ""

    def splitlist(self, v):
        return tuple(v) if isinstance(v, (list, tuple)) else tuple(str(v).split())

    split = splitlist

    def getboolean(self, v):
        return getboolean(v)

    def getint(self, v):
        return int(v)

    def getdouble(self, v):
        return float(v)

    def globalsetvar(self, *a):
        pass

    def globalgetvar(self, *a):
        return ""

    def createcommand(self, *a):
        pass

    def deletecommand(self, *a):
        pass

    def wantobjects(self):
        return 1

    def mainloop(self, n=0):
        pass


_STUB = _TkStub()


class Misc:
    _detruit = False
    _id = 0
    _type_js = "frame"

    # — liaisons —
    def bind(self, sequence=None, func=None, add=None):
        if sequence is None:
            return tuple(self._seqs)
        motif = _analyser(sequence)
        if func is None:
            return "" if not self._liaisons.get(motif) else "binding"
        lst = self._liaisons.setdefault(motif, [])
        if not add:
            lst.clear()
        lst.append(func)
        self._seqs[sequence] = motif
        _maj_ecoute(self)
        return f"{id(func)}{sequence}"

    def unbind(self, sequence, funcid=None):
        self._liaisons.pop(_analyser(sequence), None)
        self._seqs.pop(sequence, None)
        _maj_ecoute(self)

    def bind_all(self, sequence=None, func=None, add=None):
        if sequence is None:
            return tuple(_tout)
        motif = _analyser(sequence)
        lst = _tout.setdefault(motif, [])
        if not add:
            lst.clear()
        if func is not None:
            lst.append(func)
        _maj_ecoute_partout()
        return f"{id(func)}{sequence}"

    def unbind_all(self, sequence):
        _tout.pop(_analyser(sequence), None)
        _maj_ecoute_partout()

    def bind_class(self, className, sequence=None, func=None, add=None):
        liaisons = _classes.setdefault(className, {})
        if sequence is None:
            return tuple(liaisons)
        motif = _analyser(sequence)
        lst = liaisons.setdefault(motif, [])
        if not add:
            lst.clear()
        if func is not None:
            lst.append(func)
        _maj_ecoute_partout()
        return ""

    def unbind_class(self, className, sequence):
        _classes.get(className, {}).pop(_analyser(sequence), None)

    def bindtags(self, tagList=None):
        return (str(self), self.winfo_class(), str(self.winfo_toplevel()), "all")

    def event_generate(self, sequence, **kw):
        motif = _analyser(sequence)
        ev = {"type": motif[1], "detail": motif[2], "mods": set(motif[0]), "double": "Double" in motif[0]}
        e = Event(widget=self, type=EventType.VirtualEvent if motif[1] == "Virtual" else getattr(EventType, motif[1], None), **{k: v for k, v in kw.items() if k in ("x", "y", "keysym", "char", "delta", "num", "width", "height", "state", "data")})

        def envoyer():
            if self._detruit:
                return
            # Liaisons du programme d'abord, puis le comportement de la classe (<<Copy>>, <<Paste>>…), sauf « break ».
            if _dispatcher(self, ev, e) != "break" and motif[1] == "Virtual" and hasattr(self, "_action_virtuelle"):
                self._action_virtuelle(motif[2])

        if str(kw.get("when", "now")) in ("tail", "head", "mark"):
            _ui.differer(create_proxy(envoyer), 0)
        else:
            envoyer()

    def event_add(self, virtual, *sequences):
        pass

    def event_delete(self, virtual, *sequences):
        pass

    def event_info(self, virtual=None):
        return ()

    # — minuteries —
    def after(self, ms, func=None, *args):
        if func is None:
            time.sleep(max(0, float(ms)) / 1000)
            return None
        nom = f"after#{next(_noms_minuterie)}"

        def tirer():
            m = _minuteries.pop(nom, None)
            if m is not None and not getattr(m[1], "_detruit", False):
                _appeler(func, *args)

        # Lancée par la page en appel « promettant » : la fonction peut appeler update() / time.sleep().
        rappel = create_proxy(tirer)
        _minuteries[nom] = (_ui.differer(rappel, max(0, int(float(ms)))), self, rappel)
        return nom

    def after_idle(self, func, *args):
        return self.after(0, func, *args)

    def after_cancel(self, id):
        m = _minuteries.pop(id, None)
        if m is not None:
            js.clearTimeout(m[0])
            try:
                m[2].destroy()
            except Exception:
                pass

    def update(self):
        if _peut_attendre():
            _ceder(0)
        else:
            _surveiller_boucle()

    def update_idletasks(self):
        pass

    def mainloop(self, n=0):
        """Comme Tk, attend la fermeture des fenêtres (ou quit()) quand le navigateur le permet (JSPI) ;
        sinon rend la main tout de suite : la fenêtre reste ouverte et réactive."""
        _boucle_principale()

    def quit(self):
        boucles = [a for a in _attentes if a.get("boucle")]
        if boucles:
            boucles[-1]["quitte"] = True  # seule la boucle la plus récente s'arrête (mainloop imbriqués)
            _reveiller()
        else:
            _tout_detruire()

    def wait_window(self, window=None):
        w = window if window is not None else self
        if _peut_attendre():
            _attendre(lambda: not w._detruit)

    def wait_variable(self, name="PY_VAR"):
        var = name if isinstance(name, Variable) else _variables.get(str(name))
        if var is None or not _peut_attendre():
            return
        avant = var._ecritures
        _attendre(lambda: var._ecritures == avant)

    waitvar = wait_variable

    def wait_visibility(self, window=None):
        pass

    def grab_set(self):
        pass

    grab_set_global = grab_set

    def grab_release(self):
        pass

    def grab_current(self):
        return None

    def grab_status(self):
        return None

    def bell(self, displayof=0):
        pass

    def tk_setPalette(self, *args, **kw):
        pass

    def tk_strictMotif(self, boolean=None):
        return 0

    def option_add(self, pattern, value, priority=None):
        pass

    def option_get(self, name, className):
        return ""

    def option_clear(self):
        pass

    def option_readfile(self, fileName, priority=None):
        pass

    def register(self, func, subst=None, needcleanup=1):
        nom = f"{id(func)}{getattr(func, '__name__', 'cmd')}"
        _commandes[nom] = func
        return nom

    _register = register

    def deletecommand(self, name):
        _commandes.pop(name, None)

    def getvar(self, name="PY_VAR"):
        v = _variables.get(str(name))
        return v.get() if v else ""

    def setvar(self, name="PY_VAR", value="1"):
        v = _variables.get(str(name))
        if v:
            v.set(value)

    def getboolean(self, s):
        return getboolean(s)

    def clipboard_clear(self, **kw):
        _presse_papiers[0] = ""

    def clipboard_append(self, string, **kw):
        _presse_papiers[0] += str(string)
        try:
            js.navigator.clipboard.writeText(_presse_papiers[0])
        except Exception:
            pass

    def clipboard_get(self, **kw):
        return _presse_papiers[0]

    def selection_get(self, **kw):
        return _presse_papiers[0]

    # — focus —
    def focus_set(self):
        f = self.winfo_toplevel()
        _focus[f._id] = self
        _ui.ecrire(self._id, "focus", None)

    focus = focus_set
    focus_force = focus_set

    def focus_get(self):
        i = _ui.lire(self._id, "focus")
        w = _widgets.get(int(i or 0))
        if w is not None and w._type_js == "fenetre":
            return _focus.get(w._id, w)
        return w

    focus_displayof = focus_get
    focus_lastfor = focus_get

    def tk_focusNext(self):
        return self

    def tk_focusPrev(self):
        return self

    # — informations —
    def _taille(self):
        t = _py(_ui.lire(self._id, "taille")) or [1, 1, 0, 0]
        return [int(x) for x in t]

    def winfo_width(self):
        return max(1, self._taille()[0])

    def winfo_height(self):
        return max(1, self._taille()[1])

    winfo_reqwidth = winfo_width
    winfo_reqheight = winfo_height

    def winfo_rootx(self):
        return self._taille()[2]

    def winfo_rooty(self):
        return self._taille()[3]

    def winfo_x(self):
        m = getattr(self, "master", None)
        return self._taille()[2] - (m._taille()[2] if isinstance(m, Misc) else 0)

    def winfo_y(self):
        m = getattr(self, "master", None)
        return self._taille()[3] - (m._taille()[3] if isinstance(m, Misc) else 0)

    def winfo_screenwidth(self):
        return int(_py(_ui.ecran())[0])

    def winfo_screenheight(self):
        return int(_py(_ui.ecran())[1])

    def winfo_vrootwidth(self):
        return self.winfo_screenwidth()

    def winfo_vrootheight(self):
        return self.winfo_screenheight()

    def winfo_screenmmwidth(self):
        return int(self.winfo_screenwidth() / 3.78)

    def winfo_screenmmheight(self):
        return int(self.winfo_screenheight() / 3.78)

    def winfo_fpixels(self, number):
        return _pixels(number)

    def winfo_pixels(self, number):
        return int(_pixels(number))

    def winfo_pointerx(self):
        return _pointeur[0]

    def winfo_pointery(self):
        return _pointeur[1]

    def winfo_pointerxy(self):
        return tuple(_pointeur)

    def winfo_children(self):
        return [w for w in self.children.values() if not w._detruit]

    def winfo_exists(self):
        return 0 if self._detruit else 1

    def winfo_ismapped(self):
        return 0 if self._detruit else 1

    winfo_viewable = winfo_ismapped

    def winfo_class(self):
        return getattr(self, "_classe_tk", type(self).__name__)

    def winfo_name(self):
        return getattr(self, "_name", "tk")

    def winfo_parent(self):
        m = getattr(self, "master", None)
        return str(m) if m is not None else ""

    def winfo_id(self):
        return self._id

    def winfo_toplevel(self):
        w = self
        while not isinstance(w, Wm) and getattr(w, "master", None) is not None:
            w = w.master
        return w

    def winfo_rgb(self, color):
        r = _rgb(color)
        if r is None:
            raise TclError(f'unknown color name "{color}"')
        return tuple(x * 257 for x in r[:3])

    def winfo_depth(self):
        return 24

    def winfo_manager(self):
        return getattr(self, "_gestion", "") or ""

    def nametowidget(self, name):
        name = str(name)
        for w in _widgets.values():
            if str(w) == name:
                return w
        raise KeyError(name)

    _nametowidget = nametowidget

    def keys(self):
        return list(self._o.keys())

    def __str__(self):
        return self._chemin

    def __repr__(self):
        return f"<{type(self).__module__}.{type(self).__name__} object {self._chemin}>"

    # — grilles (sur les conteneurs) —
    def grid_columnconfigure(self, index, cnf={}, **kw):
        o = {**cnf, **kw}
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            if i == "all":
                continue
            self._grille_colonnes.setdefault(int(i), {}).update(o)
            _ui.grilleConfig(self._id, "column", int(i), _js({k: o[k] for k in ("weight", "minsize") if k in o}))

    def grid_rowconfigure(self, index, cnf={}, **kw):
        o = {**cnf, **kw}
        for i in (index if isinstance(index, (list, tuple)) else [index]):
            if i == "all":
                continue
            self._grille_lignes.setdefault(int(i), {}).update(o)
            _ui.grilleConfig(self._id, "row", int(i), _js({k: o[k] for k in ("weight", "minsize") if k in o}))

    columnconfigure = grid_columnconfigure
    rowconfigure = grid_rowconfigure

    def grid_propagate(self, flag=None):
        if flag is None:
            return self._propage
        self._propage = bool(flag)
        _ui.configurer(self._id, _js({"propage": bool(flag)}))

    pack_propagate = grid_propagate
    propagate = grid_propagate

    def grid_size(self):
        cols = rows = 0
        for w in self.winfo_children():
            g = getattr(w, "_geo", None)
            if g and w._gestion == "grid":
                cols = max(cols, int(g.get("column", 0)) + int(g.get("columnspan", 1)))
                rows = max(rows, int(g.get("row", 0)) + int(g.get("rowspan", 1)))
        return (cols, rows)

    size = grid_size

    def grid_slaves(self, row=None, column=None):
        out = []
        for w in self.winfo_children():
            if getattr(w, "_gestion", None) == "grid":
                g = w._geo
                if (row is None or int(g.get("row", 0)) == row) and (column is None or int(g.get("column", 0)) == column):
                    out.append(w)
        return out[::-1]

    def pack_slaves(self):
        return [w for w in self.winfo_children() if getattr(w, "_gestion", None) == "pack"]

    slaves = pack_slaves

    def place_slaves(self):
        return [w for w in self.winfo_children() if getattr(w, "_gestion", None) == "place"]

    def grid_bbox(self, column=None, row=None, col2=None, row2=None):
        t = self._taille()
        return (0, 0, t[0], t[1])

    bbox = grid_bbox

    def grid_location(self, x, y):
        return (0, 0)

    def grid_anchor(self, anchor=None):
        pass

    def lift(self, aboveThis=None):
        _ui.ecrire(self._id, "premierPlan", None)

    tkraise = lift

    def lower(self, belowThis=None):
        pass

    def image_names(self):
        return image_names()

    def image_types(self):
        return image_types()

    def _recevoir(self, type_, d):
        return _evenement_dom(self, type_, d)

    def _variable_changee(self, var):
        pass

    def _image_changee(self):
        pass


_presse_papiers = [""]


def _evenement_dom(cible, type_, d):
    if type_ in ("mousedown", "mouseup", "mousemove", "dblclick", "wheel", "mouseover", "mouseout"):
        _pointeur[0], _pointeur[1] = int(d.get("xRacine", 0)), int(d.get("yRacine", 0))
    mods = set()
    if d.get("shift"):
        mods.add("Shift")
    if d.get("ctrl"):
        mods.add("Control")
    if d.get("alt"):
        mods.add("Alt")
    boutons = int(d.get("boutons", 0) or 0)
    if boutons & 1:
        mods.add("B1")
    if boutons & 2:
        mods.add("B3")
    if boutons & 4:
        mods.add("B2")
    etat = (1 if "Shift" in mods else 0) | (4 if "Control" in mods else 0) | (8 if "Alt" in mods else 0) | (256 if "B1" in mods else 0)
    commun = {"x": int(d.get("x", 0)), "y": int(d.get("y", 0)), "x_root": int(d.get("xRacine", 0)), "y_root": int(d.get("yRacine", 0)), "state": etat}
    if type_ in ("keydown", "keyup"):
        if cible._type_js == "fenetre":
            cible = _focus.get(cible._id, cible)
            if getattr(cible, "_detruit", False):
                cible = cible.winfo_toplevel()
        touche = str(d.get("touche", ""))
        car = str(d.get("car", ""))
        tk_type = "KeyPress" if type_ == "keydown" else "KeyRelease"
        ev = {"type": tk_type, "detail": touche, "char": car, "mods": mods}
        e = Event(type=getattr(EventType, tk_type), keysym=touche, char=car, keycode=int(d.get("code", 0) or 0), keysym_num=ord(car) if len(car) == 1 else 0, **commun)
        return _dispatcher(cible, ev, e)
    if type_ in ("mousedown", "mouseup", "dblclick"):
        num = int(d.get("bouton", 1))
        num = {1: 1, 2: 2, 3: 3}.get(num, num)
        tk_type = "ButtonRelease" if type_ == "mouseup" else "ButtonPress"
        ev = {"type": tk_type, "detail": str(num), "mods": mods - {"B1", "B2", "B3"}, "double": type_ == "dblclick"}
        e = Event(type=getattr(EventType, tk_type), num=num, **commun)
        if hasattr(cible, "_evenement_item"):
            cible._evenement_item(d, ev, e)
        return _dispatcher(cible, ev, e)
    if type_ == "mousemove":
        ev = {"type": "Motion", "detail": None, "mods": mods}
        e = Event(type=EventType.Motion, **commun)
        if hasattr(cible, "_evenement_item"):
            cible._evenement_item(d, ev, e)
        return _dispatcher(cible, ev, e)
    if type_ == "wheel":
        delta = int(d.get("delta", 0))
        e = Event(type=EventType.MouseWheel, delta=delta, **commun)
        r = _dispatcher(cible, {"type": "MouseWheel", "detail": None, "mods": mods}, e)
        num = 4 if delta > 0 else 5
        e2 = Event(type=EventType.ButtonPress, num=num, **commun)
        r2 = _dispatcher(cible, {"type": "ButtonPress", "detail": str(num), "mods": mods}, e2, seulement_detail=True)
        return "prevent" if (r or r2) else None
    if type_ in ("mouseover", "mouseout"):
        autre = _widgets.get(int(d.get("autre", 0) or 0))
        chaine = _ascendants(cible)
        exclus = set(map(id, _ascendants(autre))) if autre is not None else set()
        tk_type = "Enter" if type_ == "mouseover" else "Leave"
        for w in chaine:
            if id(w) in exclus:
                continue
            e = Event(type=getattr(EventType, tk_type), widget=w, **commun)
            fns = _choisir(w._liaisons, {"type": tk_type, "detail": None, "mods": mods})
            for fn in list(fns):
                _appeler(fn, e)
        if hasattr(cible, "_survol_item"):
            cible._survol_item(d, type_, commun)
        return None
    if type_ in ("focusin", "focusout"):
        tk_type = "FocusIn" if type_ == "focusin" else "FocusOut"
        return _dispatcher(cible, {"type": tk_type, "detail": None, "mods": set()}, Event(type=getattr(EventType, tk_type)))
    if type_ == "configure":
        e = Event(type=EventType.Configure, width=int(d.get("largeur", 0)), height=int(d.get("hauteur", 0)), x=0, y=0)
        return _dispatcher(cible, {"type": "Configure", "detail": None, "mods": set()}, e, sans_toplevel=True)
    return None


def _ascendants(w):
    out = []
    while w is not None and isinstance(w, Misc):
        out.append(w)
        w = getattr(w, "master", None)
    return out


def _dispatcher(cible, ev, e, sans_toplevel=False, seulement_detail=False):
    """Parcourt les « bindtags » comme Tk : widget, classe, fenêtre, all. « break » arrête la propagation."""
    e.widget = cible
    niveaux = [cible._liaisons, _classes.get(cible.winfo_class())]
    top = cible.winfo_toplevel()
    if top is not cible and not sans_toplevel:
        niveaux.append(top._liaisons)
    niveaux.append(_tout)
    traite = False
    for liaisons in niveaux:
        if not liaisons:
            continue
        fns = _choisir(liaisons, ev)
        if seulement_detail and fns and not any(m[2] is not None and fns is liaisons.get(m) for m in liaisons):
            continue
        for fn in list(fns):
            traite = True
            if _appeler(fn, e) == "break":
                return "break"
    # « traite » : une liaison a répondu (la page n'exécute alors pas son propre raccourci, ex. Ctrl+S).
    return "traite" if traite else None


def _virtuel(w, nom, differe=True):
    """Événement virtuel (<<ListboxSelect>>, <<TreeviewSelect>>, <<Modified>>…) : comme la file d'événements de
    Tk, il part après le rappel en cours (le programme a fini de modifier le widget)."""

    def tirer():
        if not getattr(w, "_detruit", False):
            _dispatcher(w, {"type": "Virtual", "detail": nom, "mods": set()}, Event(type=EventType.VirtualEvent, widget=w))

    if differe:
        _ui.differer(create_proxy(tirer), 0)  # appel promettant : le gestionnaire peut attendre (update, sleep)
    else:
        tirer()


def _types_dom(liaisons):
    out = set()
    for motif, fns in (liaisons or {}).items():
        if not fns:
            continue
        mods, t, detail = motif
        out.update(_DOM.get(t, []))
        if "Double" in mods:
            out.add("dblclick")
        if t == "ButtonPress" and detail in ("4", "5"):
            out.add("wheel")
        if t in ("KeyPress", "KeyRelease") and "keydown" not in out:
            pass
    return out


def _maj_ecoute(w):
    if w._detruit:
        return
    if any(m[1] == "Configure" for m, f in w._liaisons.items() if f):
        _ui.observerTaille(w._id, True)
    top = w.winfo_toplevel()
    if isinstance(top, Wm):
        _maj_ecoute_fenetre(top)


def _maj_ecoute_fenetre(top):
    types = set(_types_dom(_tout))
    for w in list(_widgets.values()):
        if w._detruit or w.winfo_toplevel() is not top:
            continue
        types |= _types_dom(w._liaisons)
        types |= _types_dom(_classes.get(w.winfo_class()))
        for liaisons in getattr(w, "_liaisons_items", {}).values():
            # Liaisons d'éléments (canvas), de tags (Text) ou de lignes (Treeview)
            types |= _types_dom(liaisons)
            if any(m[1] in ("Enter", "Leave") for m in liaisons):
                types |= {"mouseover", "mouseout"} | ({"mousemove"} if isinstance(w, Text) else set())
    _ui.ecouter(top._id, _js(sorted(types)))


def _maj_ecoute_partout():
    for w in list(_widgets.values()):
        if isinstance(w, Wm) and not w._detruit:
            _maj_ecoute_fenetre(w)


def _tout_detruire():
    for w in list(_widgets.values()):
        if isinstance(w, Wm) and not w._detruit:
            try:
                w.destroy()
            except Exception:
                pass
    for nom in list(_minuteries):
        m = _minuteries.pop(nom, None)
        if m:
            js.clearTimeout(m[0])
            try:
                m[2].destroy()
            except Exception:
                pass
    _reveiller()


def _arreter_tout():
    """Appelé par la console (« Fermer les fenêtres ») : ferme tout et coupe les minuteries."""
    _tout_detruire()


# ─────────────────────────── Géométrie ───────────────────────────

_ALIAS_GEO = {"in_": "in", "in": "in"}


class Pack:
    def pack_configure(self, cnf={}, **kw):
        o = {**cnf, **kw}
        o.pop("in_", None)
        o.pop("in", None)
        if "before" in o:
            o["avant"] = o.pop("before")._id
        if "after" in o:
            o["apres"] = o.pop("after")._id
        nouveau = getattr(self, "_gestion", None) != "pack"
        geo = {**(self._geo if not nouveau else {}), **o}
        for k in ("expand",):
            if k in geo:
                geo[k] = 1 if getboolean(geo[k]) else 0
        self._gestion, self._geo = "pack", geo
        _ui.geometrie(self._id, "pack", _js({**geo, "nouveau": nouveau}))

    pack = pack_configure

    def pack_forget(self):
        self._gestion = None
        _ui.geometrie(self._id, None, _js({}))

    forget = pack_forget

    def pack_info(self):
        return {**{"side": "top", "fill": "none", "expand": 0, "anchor": "center", "padx": 0, "pady": 0, "ipadx": 0, "ipady": 0}, **(self._geo if self._gestion == "pack" else {}), "in": self.master}

    info = pack_info


class Grid:
    def grid_configure(self, cnf={}, **kw):
        o = {**cnf, **kw}
        o.pop("in_", None)
        o.pop("in", None)
        geo = {**(self._geo if getattr(self, "_gestion", None) in ("grid", "grid-retire") else {}), **o}
        if "row" not in geo:
            geo["row"] = max([int(w._geo.get("row", 0)) + 1 for w in self.master.winfo_children() if w is not self and getattr(w, "_gestion", None) == "grid"] or [0])
        if "column" not in geo:
            geo["column"] = 0
        self._gestion, self._geo = "grid", geo
        _ui.geometrie(self._id, "grid", _js(geo))

    grid = grid_configure

    def grid_forget(self):
        self._gestion = None
        self._geo = {}
        _ui.geometrie(self._id, None, _js({}))

    def grid_remove(self):
        self._gestion = "grid-retire"
        _ui.geometrie(self._id, None, _js({}))

    def grid_info(self):
        return {**{"row": 0, "column": 0, "rowspan": 1, "columnspan": 1, "sticky": "", "padx": 0, "pady": 0}, **(self._geo if self._gestion == "grid" else {}), "in": self.master}

    location = Misc.grid_location


class Place:
    def place_configure(self, cnf={}, **kw):
        o = {**cnf, **kw}
        o.pop("in_", None)
        o.pop("in", None)
        geo = {**(self._geo if getattr(self, "_gestion", None) == "place" else {}), **o}
        self._gestion, self._geo = "place", geo
        _ui.geometrie(self._id, "place", _js(geo))

    place = place_configure

    def place_forget(self):
        self._gestion = None
        _ui.geometrie(self._id, None, _js({}))

    def place_info(self):
        return dict(self._geo) if self._gestion == "place" else {}


# ─────────────────────────── Fenêtres ───────────────────────────

class Wm:
    _titre = "tk"

    def wm_title(self, string=None):
        if string is None:
            return self._titre
        self._titre = str(string)
        _ui.configurer(self._id, _js({"titre": self._titre}))

    title = wm_title

    def wm_geometry(self, newGeometry=None):
        if newGeometry is None:
            l, h, x, y = self._taille()
            return f"{l}x{h}+{x}+{y}"
        m = re.fullmatch(r"\s*(?:(\d+)x(\d+))?\s*(?:([+-]-?\d+)([+-]-?\d+))?\s*", str(newGeometry))
        if not m:
            raise TclError(f'bad geometry specifier "{newGeometry}"')
        g = {}
        if m.group(1):
            g["largeur"], g["hauteur"] = int(m.group(1)), int(m.group(2))
        if m.group(3):
            g["x"], g["y"] = int(m.group(3)), int(m.group(4))
        _ui.configurer(self._id, _js({"geometrie": g}))
        return ""

    geometry = wm_geometry

    def wm_resizable(self, width=None, height=None):
        if isinstance(width, (tuple, list)):
            width, height = (list(width) + [None])[:2]
        if width is None and height is None:
            r = getattr(self, "_redim_lh", (self._redim, self._redim))
            return (int(r[0]), int(r[1]))
        l = getboolean(width) if width is not None else True
        h = getboolean(height) if height is not None else l
        self._redim_lh = (l, h)
        self._redim = l or h
        _ui.configurer(self._id, _js({"redimensionnable": self._redim}))

    resizable = wm_resizable

    def wm_minsize(self, width=None, height=None):
        if width is None:
            return (1, 1)
        _ui.configurer(self._id, _js({"minimum": [int(width), int(height or width)]}))

    minsize = wm_minsize

    def wm_maxsize(self, width=None, height=None):
        return (self.winfo_screenwidth(), self.winfo_screenheight())

    maxsize = wm_maxsize

    def wm_protocol(self, name=None, func=None):
        if func is None:
            return self._protocoles.get(name, "")
        self._protocoles[name] = func
        return ""

    protocol = wm_protocol

    def wm_attributes(self, *args, **kw):
        it = list(args)
        for i in range(0, len(it) - 1, 2):
            k, v = str(it[i]).lstrip("-"), it[i + 1]
            if k == "alpha":
                self._cadre_style("opacity", v)
            elif k in ("fullscreen", "zoomed") and getboolean(v):
                self.wm_state("zoomed")
        return ""

    attributes = wm_attributes

    def _cadre_style(self, k, v):
        pass

    def wm_state(self, newstate=None):
        if newstate is None:
            return "normal" if self._visible else "withdrawn"
        if newstate == "zoomed":
            l, h = (int(x) for x in _py(_ui.ecran()))
            _ui.configurer(self._id, _js({"geometrie": {"largeur": l - 40, "hauteur": h - 90, "x": 16, "y": 16}}))
        elif newstate in ("withdrawn", "iconic"):
            self.wm_withdraw()
        else:
            self.wm_deiconify()
        return ""

    state = wm_state

    def wm_withdraw(self):
        self._visible = False
        _ui.configurer(self._id, _js({"visible": False}))

    withdraw = wm_withdraw
    wm_iconify = wm_withdraw
    iconify = wm_withdraw

    def wm_deiconify(self):
        self._visible = True
        _ui.configurer(self._id, _js({"visible": True}))

    deiconify = wm_deiconify

    def wm_iconbitmap(self, *a, **k):
        return ""

    iconbitmap = wm_iconbitmap

    def wm_iconphoto(self, *a, **k):
        return ""

    iconphoto = wm_iconphoto

    def wm_iconname(self, *a):
        return ""

    iconname = wm_iconname

    def wm_overrideredirect(self, flag=None):
        return False

    overrideredirect = wm_overrideredirect

    def wm_transient(self, master=None):
        return ""

    transient = wm_transient

    def wm_frame(self):
        return str(self._id)

    frame = wm_frame

    def wm_aspect(self, *a):
        return ""

    aspect = wm_aspect

    def wm_positionfrom(self, who=None):
        return "user"

    positionfrom = wm_positionfrom

    def wm_sizefrom(self, who=None):
        return "user"

    sizefrom = wm_sizefrom

    def wm_group(self, pathName=None):
        return ""

    group = wm_group

    def wm_command(self, value=None):
        return ""

    def wm_focusmodel(self, model=None):
        return "passive"

    focusmodel = wm_focusmodel

    def _fermeture(self, force=False):
        f = self._protocoles.get("WM_DELETE_WINDOW")
        if f and not force:
            _appeler(f)
        else:
            self.destroy()

    def _menu(self):
        m = self._o.get("menu")
        _ui.configurer(self._id, _js({"menu": m._desc() if isinstance(m, Menu) else None}))


_DEFAUTS_CGET = {
    "*": {"state": "normal", "relief": "flat", "background": "#f0f0f0", "foreground": "black", "borderwidth": 0,
          "highlightthickness": 0, "highlightbackground": "#f0f0f0", "highlightcolor": "black", "cursor": "", "text": "",
          "width": 0, "height": 0, "font": "TkDefaultFont", "anchor": "center", "justify": "center", "padx": 1, "pady": 1,
          "takefocus": "", "activebackground": "#ececec", "activeforeground": "black", "disabledforeground": "#a3a3a3",
          "image": "", "compound": "none", "underline": -1, "wraplength": 0, "textvariable": "", "command": "",
          "style": "", "class": ""},
    "Tk": {"menu": "", "padx": 0, "pady": 0},
    "Toplevel": {"menu": "", "padx": 0, "pady": 0},
    "Frame": {"padx": 0, "pady": 0},
    "Labelframe": {"relief": "groove", "borderwidth": 2, "labelanchor": "nw", "padx": 0, "pady": 0},
    "Label": {"borderwidth": 0},
    "Button": {"relief": "raised", "borderwidth": 2, "padx": 3, "default": "disabled", "overrelief": "", "repeatdelay": 0, "repeatinterval": 0},
    "Checkbutton": {"onvalue": 1, "offvalue": 0, "indicatoron": 1, "selectcolor": "white", "variable": "", "justify": "center"},
    "Radiobutton": {"value": "", "indicatoron": 1, "selectcolor": "white", "variable": "selectedButton"},
    "Entry": {"background": "white", "relief": "sunken", "borderwidth": 1, "show": "", "width": 20, "justify": "left",
              "insertbackground": "black", "selectbackground": "#0078d7", "selectforeground": "white", "exportselection": 1,
              "readonlybackground": "#f0f0f0", "validate": "none", "validatecommand": "", "invalidcommand": ""},
    "Spinbox": {"background": "white", "relief": "sunken", "borderwidth": 1, "width": 20, "justify": "left", "from": 0.0,
                "to": 0.0, "increment": 1.0, "wrap": 0, "format": "", "values": "", "buttonbackground": "#f0f0f0"},
    "Text": {"background": "white", "relief": "sunken", "borderwidth": 1, "width": 80, "height": 24, "wrap": "char",
             "undo": 0, "maxundo": 0, "autoseparators": 1, "insertbackground": "black", "selectbackground": "#0078d7",
             "selectforeground": "white", "spacing1": 0, "spacing2": 0, "spacing3": 0, "tabs": "", "insertwidth": 2,
             "blockcursor": 0, "inactiveselectbackground": "#c3c3c3", "padx": 1, "pady": 1, "justify": "left"},
    "Listbox": {"background": "white", "relief": "sunken", "borderwidth": 1, "width": 20, "height": 10,
                "selectmode": "browse", "selectbackground": "#0078d7", "selectforeground": "white", "activestyle": "dotbox",
                "listvariable": "", "exportselection": 1, "justify": "left"},
    "Canvas": {"width": 378, "height": 265, "scrollregion": "", "confine": 1, "xscrollincrement": 0, "yscrollincrement": 0,
               "closeenough": 1.0, "selectbackground": "#0078d7"},
    "Scale": {"from": 0.0, "to": 100.0, "orient": "vertical", "resolution": 1.0, "length": 100, "showvalue": 1,
              "sliderlength": 30, "tickinterval": 0.0, "label": "", "width": 15, "bigincrement": 0.0, "digits": 0,
              "variable": "", "troughcolor": "#e1e1e1"},
    "Scrollbar": {"orient": "vertical", "width": 17, "jump": 0},
    "Message": {"width": 0, "aspect": 150, "justify": "left", "anchor": "center"},
    "Menu": {"tearoff": 1, "postcommand": "", "tearoffcommand": "", "title": "", "type": "normal"},
    "Menubutton": {"direction": "below", "indicatoron": 0, "menu": "", "relief": "flat"},
    "Panedwindow": {"orient": "horizontal", "sashwidth": 3, "showhandle": 0},
}


def _defaut_option(w, k):
    """Valeur par défaut d'une option non configurée, comme la renvoie Tk (state → « normal »…)."""
    classe = str(getattr(w, "_classe_tk", "") or "")
    for c in (classe, classe[1:] if classe.startswith("T") else None, "*"):
        d = _DEFAUTS_CGET.get(c) if c else None
        if d and k in d:
            return d[k]
    return ""


class _Base(Misc):
    """Fonctions communes aux fenêtres et aux widgets (options, destruction)."""

    _defauts = {}
    _alias = {"bg": "background", "fg": "foreground", "bd": "borderwidth", "from_": "from"}

    def _init_commun(self):
        self._id = next(_compteur)
        _widgets[self._id] = self
        self.children = {}
        self._liaisons = {}
        self._seqs = {}
        self._grille_colonnes = {}
        self._grille_lignes = {}
        self._propage = True
        self._gestion = None
        self._geo = {}
        self._o = dict(self._defauts)
        self._var_texte = None

    def _normaliser(self, cnf, kw):
        o = {}
        for k, v in {**(cnf or {}), **kw}.items():
            k = str(k).rstrip("_") if k.endswith("_") and k not in ("from_",) else k
            o[self._alias.get(k, k)] = v
        return o

    def configure(self, cnf=None, **kw):
        if cnf is None and not kw:
            return {k: (k, k, k.capitalize(), "", v) for k, v in self._o.items()}
        if isinstance(cnf, str) and not kw:
            k = self._alias.get(cnf, cnf)
            return (k, k, k.capitalize(), "", self._o.get(k, ""))
        o = self._normaliser(cnf if isinstance(cnf, dict) else {}, kw)
        self._appliquer(o)

    config = configure

    def cget(self, key):
        k = self._alias.get(str(key).lstrip("-"), str(key).lstrip("-"))
        if k == "text" and self._var_texte is not None:
            return self._var_texte.get()
        if k in self._o:
            return self._o[k]
        return _defaut_option(self, k)

    def __getitem__(self, key):
        return self.cget(key)

    def __setitem__(self, key, value):
        self.configure({key: value})

    def _appliquer(self, o):
        self._o.update(o)
        j = self._traduire(o)
        if j:
            _ui.configurer(self._id, _js(j))

    def _traduire(self, o):
        j = {}
        for k, v in o.items():
            if k == "text":
                j["texte"] = "" if v is None else str(v)
            elif k == "textvariable":
                self._lier_texte(v)
                if v is not None:
                    j["texte" if self._type_js not in ("entry", "spinbox", "combobox", "select") else "valeur"] = str(v.get())
            elif k == "background":
                j["fond"] = _couleur(v)
            elif k == "foreground":
                j["couleur"] = _couleur(v)
            elif k == "font":
                j["police"] = _police(v)
                if hasattr(v, "_utilisateurs") and self not in v._utilisateurs:
                    v._utilisateurs.append(self)
            elif k == "borderwidth":
                j["bordure"] = _pixels(v)
            elif k == "relief":
                j["relief"] = str(v)
                j["bordure"] = _pixels(self._o.get("borderwidth", 2 if str(v) not in ("flat",) else 0), 2)
            elif k == "cursor":
                j["curseur"] = str(v)
            elif k == "state":
                j["etat"] = str(v)
            elif k in ("padx", "pady"):
                j[k] = _pixels(v)
            elif k == "padding":
                p = v if isinstance(v, (list, tuple)) else str(v).split() if isinstance(v, str) else [v]
                p = [_pixels(x) for x in p] or [0]
                j["padx"], j["pady"] = p[0], (p[1] if len(p) > 1 else p[0])
            elif k == "anchor":
                j["ancre"] = str(v)
            elif k == "justify":
                j["justif"] = {"left": "left", "right": "right", "center": "center"}.get(str(v), "left")
            elif k == "wraplength":
                j["retour"] = _pixels(v)
            elif k == "image":
                j["image"] = _desc_image(v)
                if isinstance(v, Image) and self not in v._utilisateurs:
                    v._utilisateurs.append(self)
            elif k == "compound":
                j["compose"] = str(v)
            elif k == "activebackground":
                pass
        if "width" in o or "height" in o or "image" in o:
            j["dimensions"] = self._dimensions()
        return j

    def _dimensions(self):
        l, h = self._o.get("width"), self._o.get("height")
        a_image = bool(self._o.get("image"))
        unite = getattr(self, "_unite", "px")
        u = "px" if a_image else unite
        return {"largeur": _pixels(l) if l not in (None, "") else None, "hauteur": _pixels(h) if h not in (None, "") else None,
                "uniteL": "car" if u == "car" else "px", "uniteH": "lignes" if u == "car" else "px"}

    def _lier_texte(self, var):
        if self._var_texte is not None:
            self._var_texte._delier(self)
        self._var_texte = var
        if var is not None:
            var._lier(self)

    def _variable_changee(self, var):
        if var is self._var_texte:
            cle = "valeur" if self._type_js in ("entry", "spinbox", "combobox", "select") else "texte"
            _ui.configurer(self._id, _js({cle: str(var._valeur)}))

    def _image_changee(self):
        _ui.configurer(self._id, _js({"image": _desc_image(self._o.get("image")), "dimensions": self._dimensions()}))

    def destroy(self):
        if self._detruit:
            return
        for c in list(self.children.values()):
            c.destroy()
        self._detruit = True
        e = Event(type=EventType.Destroy, widget=self)
        fns = _choisir(self._liaisons, {"type": "Destroy", "detail": None, "mods": set()})
        for fn in list(fns):
            _appeler(fn, e)
        for nom, m in list(_minuteries.items()):
            if m[1] is self:
                self.after_cancel(nom)
        if self._var_texte is not None:
            self._var_texte._delier(self)
        _ui.detruire(self._id)
        _widgets.pop(self._id, None)
        m = getattr(self, "master", None)
        if m is not None and getattr(m, "children", None) is not None:
            m.children.pop(getattr(self, "_name", ""), None)
        if _attentes:
            _reveiller()  # mainloop() / wait_window() revérifient leur condition


class Tk(Wm, _Base):
    _classe_tk = "Tk"
    _type_js = "fenetre"

    def __init__(self, screenName=None, baseName=None, className="Tk", useTk=1, sync=0, use=None):
        global _default_root
        self._init_commun()
        self.master = None
        self._name = ""
        self._chemin = "."
        self.tk = _STUB
        self._protocoles = {}
        self._redim = True
        self._visible = True
        self._titre = className.lower() if className and className != "Tk" else "tk"
        self._o.update({"background": "#f0f0f0"})
        _ui.creerFenetre(self._id, _js({"titre": self._titre}))
        if _default_root is None or _default_root._detruit:
            _default_root = self

    def _appliquer(self, o):
        self._o.update(o)
        j = {}
        if "background" in o:
            j["fond"] = _couleur(o["background"])
        for k in ("padx", "pady"):
            if k in o:
                j[k] = _pixels(o[k])
        if "cursor" in o:
            j["curseur"] = str(o["cursor"])
        if "menu" in o:
            self._menu()
        w, h = o.get("width"), o.get("height")
        if w or h:
            j["geometrie"] = {"largeur": int(_pixels(w or self.winfo_width())), "hauteur": int(_pixels(h or self.winfo_height()))}
        if j:
            _ui.configurer(self._id, _js(j))

    def destroy(self):
        global _default_root
        if self._detruit:
            return
        for w in list(_widgets.values()):
            if isinstance(w, Toplevel) and not w._detruit and w._racine() is self:
                w.destroy()
        _Base.destroy(self)
        if _default_root is self:
            _default_root = None

    def report_callback_exception(self, exc, val, tb):
        print("Exception in Tkinter callback", file=sys.stderr)
        traceback.print_exception(exc, val, tb, file=sys.stderr)

    def readprofile(self, baseName, className):
        pass

    def loadtk(self):
        pass

    def _recevoir(self, type_, d):
        if type_ == "fermer":
            self._fermeture(bool(d.get("force")))
            return None
        return Misc._recevoir(self, type_, d)

    def _racine(self):
        return self


def Tcl(screenName=None, baseName=None, className="Tk", useTk=0):
    return _STUB


def NoDefaultRoot():
    global _default_root
    _default_root = None


def _racine_defaut():
    global _default_root
    if _default_root is None or _default_root._detruit:
        Tk()
    return _default_root


_get_default_root = lambda what=None: _racine_defaut()


def mainloop(n=0):
    _boucle_principale()


class BaseWidget(_Base):
    _unite = "car"

    def __init__(self, master=None, cnf={}, **kw):
        if master is None:
            master = _racine_defaut()
        self._init_commun()
        self.master = master
        self.tk = _STUB
        o = self._normaliser(cnf, kw)
        nom = o.pop("name", None)
        n = sum(1 for c in master.children.values() if type(c) is type(self)) + 1
        self._name = str(nom) if nom else f"!{type(self).__name__.lower()}{'' if n == 1 else n}"
        base = "" if master._chemin == "." else master._chemin
        self._chemin = f"{base}.{self._name}"
        master.children[self._name] = self
        o.pop("class_", None)
        o.pop("class", None)
        self._o.update(o)
        self._preparer(o)
        _ui.creer(self._id, self._type_js, master._id, _js(self._traduire({**self._defauts, **o})))

    def _preparer(self, o):
        pass

    def _racine(self):
        w = self.master
        while isinstance(w, BaseWidget) or isinstance(w, Toplevel):
            w = w.master
        return w


class Widget(BaseWidget, Pack, Place, Grid):
    pass


class Toplevel(Wm, BaseWidget):
    _classe_tk = "Toplevel"
    _type_js = "fenetre"

    def __init__(self, master=None, cnf={}, **kw):
        if master is None:
            master = _racine_defaut()
        self._init_commun()
        self.master = master
        self.tk = _STUB
        self._protocoles = {}
        self._redim = True
        self._visible = True
        o = self._normaliser(cnf, kw)
        n = sum(1 for c in master.children.values() if isinstance(c, Toplevel)) + 1
        self._name = str(o.pop("name", "") or f"!toplevel{'' if n == 1 else n}")
        base = "" if master._chemin == "." else master._chemin
        self._chemin = f"{base}.{self._name}"
        master.children[self._name] = self
        self._titre = getattr(master.winfo_toplevel(), "_titre", "tk")
        _ui.creerFenetre(self._id, _js({"titre": self._titre}))
        self._appliquer({"background": "#f0f0f0", **o})

    _appliquer = Tk._appliquer
    _recevoir = Tk._recevoir

    def destroy(self):
        _Base.destroy(self)


# ─────────────────────────── Widgets simples ───────────────────────────

class Frame(Widget):
    _type_js = "frame"
    _unite = "px"
    _classe_tk = "Frame"


class LabelFrame(Widget):
    _type_js = "labelframe"
    _unite = "px"
    _classe_tk = "Labelframe"

    def _traduire(self, o):
        j = super()._traduire(o)
        if "labelanchor" in o:
            pass
        return j


class Label(Widget):
    _type_js = "label"
    _classe_tk = "Label"


class Message(Widget):
    _type_js = "message"
    _classe_tk = "Message"

    def _traduire(self, o):
        j = super()._traduire(o)
        if "width" in o:
            j["retour"] = _pixels(o["width"]) or 300
            j.pop("dimensions", None)
        return j


class Button(Widget):
    _type_js = "button"
    _classe_tk = "Button"

    def invoke(self):
        if str(self._o.get("state", "normal")) == "disabled":
            return ""
        cmd = self._o.get("command")
        return _appeler(cmd) if cmd else ""

    def flash(self):
        pass

    def _recevoir(self, type_, d):
        if type_ == "commande":
            self.invoke()
            return None
        return super()._recevoir(type_, d)


class Scrollbar(Widget):
    _type_js = "scrollbar"
    _classe_tk = "Scrollbar"

    def set(self, first=None, last=None):
        pass

    def get(self):
        return (0.0, 1.0)

    def activate(self, index=None):
        pass

    def delta(self, deltax, deltay):
        return 0.0

    def fraction(self, x, y):
        return 0.0

    def identify(self, x, y):
        return ""


class _ChampTexte:
    """Entry / Spinbox : contenu lu dans la page, validation « key » comme Tk (frappe ET insert / delete)."""

    def get(self):
        if self._detruit:
            raise TclError("invalid command name")
        return str(_ui.lire(self._id, "valeur") or "")

    def _modifiable(self):
        return str(self._o.get("state", "normal")) not in ("disabled", "readonly")

    def _ecrire(self, texte):
        self._valeur = texte
        _ui.configurer(self._id, _js({"valeur": texte}))
        if self._var_texte is not None:
            self._var_texte.set(texte)

    def _sel_page(self):
        s = _py(_ui.lire(self._id, "selectionTexte"))
        return (int(min(s)), int(max(s))) if s else None

    def _index(self, index):
        v = self.get()
        if index in (END, "end"):
            return len(v)
        if index in (INSERT, "insert"):
            c = _ui.lire(self._id, "curseur")
            return len(v) if c is None else int(c)
        if index in ("sel.first", "sel.last", "anchor"):
            s = self._sel_page()
            if index == "anchor":
                return s[0] if s else 0
            if not s or s[0] == s[1]:
                raise TclError(f"selection isn't in widget {self}")
            return s[0] if index == "sel.first" else s[1]
        try:
            return max(0, min(len(v), int(index)))
        except (TypeError, ValueError):
            if isinstance(index, str) and index.startswith("@"):
                return len(v)
            raise TclError(f'bad entry index "{index}"')

    def insert(self, index, string):
        if not self._modifiable():
            return  # Tk ignore insert / delete sur un champ désactivé ou en lecture seule
        v = self.get()
        i = self._index(index)
        t = str(string)
        if t:
            self._modifier(v[:i] + t + v[i:], "1", i, t)

    def delete(self, first, last=None):
        if not self._modifiable():
            return
        v = self.get()
        a = self._index(first)
        b = a + 1 if last is None else self._index(last)
        if b > a:
            self._modifier(v[:a] + v[b:], "0", a, v[a:b])

    def _modifier(self, nouveau, action, index, chaine):
        """Modification par le programme : validée comme une frappe, curseur décalé comme dans Tk."""
        if not self._valider(nouveau, action, index, chaine):
            return
        c = _ui.lire(self._id, "curseur")
        self._ecrire(nouveau)
        if c is not None:
            c = int(c)
            if action == "1" and c >= index:
                c += len(chaine)
            elif action == "0" and c > index:
                c = max(index, c - len(chaine))
            _ui.ecrire(self._id, "curseur", c)

    def index(self, index):
        return self._index(index)

    def icursor(self, index):
        _ui.ecrire(self._id, "curseur", self._index(index))

    def select_range(self, start, end):
        _ui.ecrire(self._id, "selectionTexte", _js([self._index(start), self._index(end)]))

    selection_range = select_range

    def select_clear(self):
        _ui.ecrire(self._id, "curseur", self._index(INSERT))

    selection_clear = select_clear

    def select_present(self):
        s = self._sel_page()
        return bool(s and s[0] != s[1])

    selection_present = select_present

    def select_from(self, index):
        self._ancre_sel = self._index(index)

    selection_from = select_from

    def select_to(self, index):
        self.select_range(getattr(self, "_ancre_sel", 0), index)

    selection_to = select_to

    def select_adjust(self, index):
        s = self._sel_page() or (self._index(INSERT),) * 2
        i = self._index(index)
        self.select_range(min(s[0], i), max(s[1], i))

    selection_adjust = select_adjust

    def xview(self, *args):
        return (0.0, 1.0)

    xview_moveto = xview
    xview_scroll = xview

    def scan_mark(self, x):
        pass

    def scan_dragto(self, x):
        pass

    def _action_virtuelle(self, nom):
        a = {"<<Copy>>": "copier", "<<Cut>>": "couper", "<<Paste>>": "coller", "<<SelectAll>>": "toutSelectionner", "<<Clear>>": "effacer"}.get(nom)
        if not a:
            return
        if a in ("copier", "couper") and self.select_present():
            s = self._sel_page()
            _presse_papiers[0] = self.get()[s[0]:s[1]]
        _ui.ecrire(self._id, "action", _js([a, _presse_papiers[0]]))

    def _valider(self, nouveau, action="1", index=0, chaine="", raison="key"):
        mode = str(self._o.get("validate", "none"))
        vcmd = self._o.get("validatecommand")
        if mode not in ("key", "all") or not vcmd:
            return True
        ancien = getattr(self, "_valeur", "")
        if isinstance(vcmd, (tuple, list)):
            fn, args = vcmd[0], list(vcmd[1:])
        else:
            fn, args = vcmd, []
        fn = _commandes.get(fn, fn) if isinstance(fn, str) else fn
        if not callable(fn):
            return True
        subst = {"%P": nouveau, "%s": ancien, "%S": chaine, "%d": str(action), "%i": str(index), "%V": raison, "%v": mode, "%W": str(self)}
        try:
            ok = fn(*[subst.get(a, a) if isinstance(a, str) else a for a in args])
        except Exception:
            _rapporter()
            return True
        valide = ok is not False and ok != 0 and str(ok).lower() not in ("false", "0")
        if not valide:
            inv = self._o.get("invalidcommand")
            if inv:
                f = inv[0] if isinstance(inv, (tuple, list)) else inv
                f = _commandes.get(f, f) if isinstance(f, str) else f
                if callable(f):
                    _appeler(f, *[subst.get(a, a) for a in (inv[1:] if isinstance(inv, (tuple, list)) else [])])
        return valide

    def _saisie(self, valeur):
        """Frappe dans la page : différence avec l'ancien contenu → validation (%d, %i, %S) comme Tk."""
        ancien = getattr(self, "_valeur", "")
        p = 0
        while p < min(len(ancien), len(valeur)) and ancien[p] == valeur[p]:
            p += 1
        f = 0
        while f < min(len(ancien), len(valeur)) - p and ancien[len(ancien) - 1 - f] == valeur[len(valeur) - 1 - f]:
            f += 1
        retire, ajoute = ancien[p:len(ancien) - f], valeur[p:len(valeur) - f]
        ok = True
        if retire and ajoute:  # sélection remplacée : suppression puis insertion, comme Tk
            ok = self._valider(ancien[:p] + ancien[len(ancien) - f:], "0", p, retire) and self._valider(valeur, "1", p, ajoute)
        elif retire or ajoute:
            ok = self._valider(valeur, "1" if ajoute else "0", p, ajoute or retire)
        if not ok:
            _ui.configurer(self._id, _js({"valeur": ancien}))
            _ui.ecrire(self._id, "curseur", p + len(retire))
            return
        self._valeur = valeur
        if self._var_texte is not None:
            self._var_texte._valeur = valeur
            self._var_texte._declencher("write")
            for w in list(self._var_texte._liens):
                if w is not self:
                    w._variable_changee(self._var_texte)


class Entry(_ChampTexte, Widget):
    _type_js = "entry"
    _classe_tk = "Entry"
    _defauts = {"width": 20}

    def _preparer(self, o):
        self._valeur = str(o["textvariable"].get()) if o.get("textvariable") is not None else ""

    def _traduire(self, o):
        j = super()._traduire(o)
        if "show" in o:
            j["masque"] = bool(o["show"])
        if "readonlybackground" in o:
            pass
        return j

    def _recevoir(self, type_, d):
        if type_ == "valeur":
            self._saisie(str(d.get("valeur", "")))
            return None
        return super()._recevoir(type_, d)


class Spinbox(_ChampTexte, Widget):
    _type_js = "spinbox"
    _classe_tk = "Spinbox"
    _defauts = {"width": 20}

    def _preparer(self, o):
        var = o.get("textvariable")
        if var is not None and str(var._valeur) == "":
            # Comme Tk : un Spinbox vide affiche sa première valeur (et la variable la reçoit).
            var._valeur = self._valeurs()[0] if self._valeurs() else self._format(float(o.get("from", 0) or 0))
        if var is not None:
            self._valeur = str(var._valeur)
        elif self._valeurs():
            self._valeur = self._valeurs()[0]
        else:
            self._valeur = self._format(float(o.get("from", 0) or 0))

    def _valeurs(self):
        v = self._o.get("values") or ()
        return [str(x) for x in (v if isinstance(v, (list, tuple)) else str(v).split())]

    def _format(self, f):
        fmt = self._o.get("format")
        if fmt:
            try:
                return str(fmt) % f
            except (TypeError, ValueError):
                pass
        inc = float(self._o.get("increment", 1) or 1)
        de = float(self._o.get("from", 0) or 0)
        if inc == int(inc) and de == int(de):
            return str(int(round(f)))
        decimales = len(repr(abs(inc)).split(".")[1].rstrip("0")) if "." in repr(inc) else 0
        return f"{f:.{max(1, decimales)}f}"

    def _traduire(self, o):
        j = super()._traduire(o)
        if not self._o.get("textvariable") and getattr(self, "_valeur", None) is not None:
            if "values" in o and self._valeurs() and self._valeur not in self._valeurs():
                self._valeur = self._valeurs()[0]
            j["valeur"] = self._valeur
        return j

    def _pas(self, sens):
        """Flèche ▲ / ▼ : valeur suivante (values, increment, from / to, wrap), puis la commande, comme Tk."""
        if str(self._o.get("state", "normal")) == "disabled":
            return
        actuel = self.get()
        try:
            boucle = getboolean(self._o.get("wrap", 0))
        except TclError:
            boucle = False
        valeurs = self._valeurs()
        if valeurs:
            i = valeurs.index(actuel) if actuel in valeurs else (-1 if sens > 0 else len(valeurs))
            j = i + sens
            if j >= len(valeurs):
                j = 0 if boucle else len(valeurs) - 1
            if j < 0:
                j = len(valeurs) - 1 if boucle else 0
            nouveau = valeurs[j]
        else:
            de, a = float(self._o.get("from", 0) or 0), float(self._o.get("to", 0) or 0)
            inc = abs(float(self._o.get("increment", 1) or 1))
            try:
                v = float(actuel) + sens * inc
            except ValueError:
                v = de
            if v > a:
                v = de if boucle else a
            if v < de:
                v = a if boucle else de
            nouveau = self._format(v)
        if nouveau != actuel:
            self._ecrire(nouveau)
        cmd = self._o.get("command")
        if cmd:
            _appeler(cmd)

    def _recevoir(self, type_, d):
        if type_ == "valeur":
            self._saisie(str(d.get("valeur", "")))
            return None
        if type_ == "pas":
            self._pas(1 if int(d.get("sens", 1)) > 0 else -1)
            return None
        return super()._recevoir(type_, d)

    def set(self, value):
        self._ecrire(str(value))

    def invoke(self, element):
        if element in ("buttonup", "buttondown"):
            self._pas(1 if element == "buttonup" else -1)

    def identify(self, x, y):
        return ""

    def selection(self, *a):
        pass


class Checkbutton(Widget):
    _type_js = "checkbutton"
    _classe_tk = "Checkbutton"

    def _preparer(self, o):
        if o.get("variable") is None:
            self._o["variable"] = IntVar(value=self._o.get("offvalue", 0))
        self._var = self._o["variable"]
        self._var._lier(self)

    def _coche(self):
        try:
            return _meme_valeur(self._var, self._o.get("onvalue", 1))
        except Exception:
            return False

    def _traduire(self, o):
        j = super()._traduire(o)
        if "variable" in o:
            if getattr(self, "_var", None) is not None and self._var is not o["variable"] and o["variable"] is not None:
                self._var._delier(self)
                self._var = o["variable"]
                self._var._lier(self)
            j["coche"] = self._coche() if hasattr(self, "_var") else False
        if "indicatoron" in o:
            j["indicateur"] = bool(o["indicatoron"])
        if "variable" not in o and hasattr(self, "_var"):
            j["coche"] = self._coche()
        return j

    def _variable_changee(self, var):
        if var is getattr(self, "_var", None):
            _ui.configurer(self._id, _js({"coche": self._coche()}))
        else:
            super()._variable_changee(var)

    def _valeur_on(self):
        on = self._o.get("onvalue", 1)
        return True if isinstance(self._var, BooleanVar) and on == 1 else on

    def _valeur_off(self):
        off = self._o.get("offvalue", 0)
        return False if isinstance(self._var, BooleanVar) and off == 0 else off

    def select(self):
        self._var.set(self._valeur_on())

    def deselect(self):
        self._var.set(self._valeur_off())

    def toggle(self):
        self.deselect() if self._coche() else self.select()

    def invoke(self):
        self.toggle()
        cmd = self._o.get("command")
        return _appeler(cmd) if cmd else None

    def flash(self):
        pass

    def _recevoir(self, type_, d):
        if type_ == "commande":
            if d.get("coche"):
                self.select()
            else:
                self.deselect()
            cmd = self._o.get("command")
            if cmd:
                _appeler(cmd)
            return None
        return super()._recevoir(type_, d)


class Radiobutton(Widget):
    _type_js = "radiobutton"
    _classe_tk = "Radiobutton"
    _var_defaut = None

    def _preparer(self, o):
        var = o.get("variable")
        if var is None:
            if Radiobutton._var_defaut is None:
                Radiobutton._var_defaut = StringVar(value="")
            var = self._o["variable"] = Radiobutton._var_defaut
        self._var = var
        var._lier(self)

    def _coche(self):
        return _meme_valeur(self._var, self._o.get("value", ""))

    def _traduire(self, o):
        j = super()._traduire(o)
        if "variable" in o and o["variable"] is not None and getattr(self, "_var", None) not in (None, o["variable"]):
            self._var._delier(self)
            self._var = o["variable"]
            self._var._lier(self)
        if hasattr(self, "_var"):
            j["groupe"] = str(self._var)
            j["coche"] = self._coche()
        if "indicatoron" in o:
            j["indicateur"] = bool(o["indicatoron"])
        return j

    def _variable_changee(self, var):
        if var is getattr(self, "_var", None):
            _ui.configurer(self._id, _js({"coche": self._coche()}))
        else:
            super()._variable_changee(var)

    def select(self):
        self._var.set(self._o.get("value", ""))

    def deselect(self):
        if self._coche():
            self._var.set("")

    def invoke(self):
        self.select()
        cmd = self._o.get("command")
        return _appeler(cmd) if cmd else None

    def flash(self):
        pass

    def _recevoir(self, type_, d):
        if type_ == "commande":
            if d.get("coche"):
                self.invoke()
            return None
        return super()._recevoir(type_, d)


class Scale(Widget):
    _type_js = "scale"
    _classe_tk = "Scale"
    _unite = "px"
    _defauts = {"from": 0, "to": 100, "orient": "vertical", "resolution": 1, "showvalue": 1, "length": 100}

    def _preparer(self, o):
        var = o.get("variable")
        self._val = float(var.get()) if var is not None else float(self._o.get("from", 0))
        if var is not None:
            var._lier(self)

    def _nombre(self, v):
        r = float(self._o.get("resolution", 1) or 0)
        f = float(v)
        if r > 0:
            f = round(f / r) * r
            if r == int(r):
                return int(round(f))
            return round(f, max(0, len(str(r).split(".")[-1])))
        return f

    def _traduire(self, o):
        j = super()._traduire(o)
        j.pop("dimensions", None)
        if "from" in o:
            j["de"] = float(o["from"])
        if "to" in o:
            j["a"] = float(o["to"])
        if "resolution" in o:
            j["pas"] = float(o["resolution"]) or "any"
        if "label" in o:
            j["etiquette"] = str(o["label"])
        if "showvalue" in o:
            j["montrerValeur"] = bool(o["showvalue"])
        if "orient" in o:
            j["orient"] = str(o["orient"])
        if "length" in o:
            j["longueur"] = _pixels(o["length"])
        if "variable" in o and o["variable"] is not None:
            o["variable"]._lier(self)
            try:
                self._val = float(o["variable"].get())
            except Exception:
                pass
        if hasattr(self, "_val"):
            j["valeur"] = self._nombre(self._val)
        return j

    def get(self):
        return self._nombre(self._val)

    def set(self, value):
        avant = self.get()
        de, a = float(self._o.get("from", 0) or 0), float(self._o.get("to", 100) or 0)
        self._val = max(min(de, a), min(max(de, a), float(value)))
        _ui.configurer(self._id, _js({"valeur": self._nombre(self._val)}))
        var = self._o.get("variable")
        if var is not None and var._valeur != self.get():
            var.set(self.get())
        cmd = self._o.get("command")
        if cmd and self.get() != avant:
            js.setTimeout(create_once_callable(lambda: None if self._detruit else _appeler(cmd, str(self.get()))), 0)

    def coords(self, value=None):
        return (0, 0)

    def identify(self, x, y):
        return ""

    def _variable_changee(self, var):
        if var is self._o.get("variable"):
            try:
                self._val = float(var._valeur)
            except (TypeError, ValueError):
                return
            _ui.configurer(self._id, _js({"valeur": self._nombre(self._val)}))

    def _recevoir(self, type_, d):
        if type_ == "valeur":
            self._val = float(d.get("valeur", 0))
            var = self._o.get("variable")
            if var is not None:
                var.set(self.get())
            cmd = self._o.get("command")
            if cmd:
                _appeler(cmd, str(self.get()))
            return None
        return super()._recevoir(type_, d)


# ─────────────────────────── Text ───────────────────────────

class Text(Widget):
    _type_js = "text"
    _classe_tk = "Text"
    _defauts = {"width": 80, "height": 24}

    # Modèle : texte + « \n » final (comme Tk), affiché tel quel dans la page. Le curseur et la sélection
    # sont ceux de la page (clics, flèches, souris) ; tags et marques sont tenus ici.
    def _preparer(self, o):
        self._contenu = "\n"
        self._tags = {}
        self._styles = {}
        self._opts_tags = {}
        self._ordre_tags = []
        self._marques = {"insert": 0, "current": 0}
        self._gravites = {}
        self._sel = None
        self._modifie = False
        self._annuler = []
        self._retablir = []
        self._separateur = False
        self._derniere_saisie = 0.0
        self._liaisons_items = {}
        self._survoles = set()
        self._rendu_attente = False
        self._sel_envoyee = None

    def _traduire(self, o):
        j = super()._traduire(o)
        if "wrap" in o:
            j["retourLigne"] = str(o["wrap"])
        if "state" in o:
            j["etat"] = str(o["state"])
        if "yscrollcommand" in o:
            j["suiviDefilement"] = bool(o["yscrollcommand"])
        return j

    # — synchronisation avec la page —
    def _synchro(self):
        """Curseur / sélection : ceux de la page s'ils ont changé depuis notre dernier envoi (clic, flèches,
        souris) ; sinon le modèle fait foi (marque « insert » hors de la sélection, rendu en attente)."""
        if self._detruit or self._rendu_attente:
            return
        s = _py(_ui.lire(self._id, "selTexte"))
        if s:
            s = [int(s[0]), int(s[1])]
            if s == self._sel_envoyee:
                return
            self._sel_envoyee = s
            n = len(self._contenu) - 1
            a, b = max(0, min(n, s[0])), max(0, min(n, s[1]))
            self._marques["insert"] = b
            self._sel = (min(a, b), max(a, b)) if a != b else None

    def _vue_selection(self):
        """[ancre, curseur] à montrer : la sélection, son curseur du côté de la marque « insert »."""
        p = self._marques.get("insert", 0)
        if not self._sel:
            return [p, p]
        a, b = self._sel
        return [b, a] if p == a else [a, b]

    def _envoyer_selection(self):
        if not self._rendu_attente:
            self._sel_envoyee = self._vue_selection()
            _ui.ecrire(self._id, "selTexte", _js(self._sel_envoyee))

    def _rendre(self):
        """Redessine au prochain micro-instant : une boucle de insert() ne redessine qu'une fois."""
        if not self._rendu_attente:
            self._rendu_attente = True
            js.queueMicrotask(create_once_callable(self._vider_rendu))

    def _vider_rendu(self):
        if not self._rendu_attente or self._detruit:
            return
        self._rendu_attente = False
        t = self._contenu
        coupures = {0, len(t)}
        for tag, plages in self._tags.items():
            if tag in self._styles:
                for a, b in plages:
                    coupures.update((max(0, min(len(t), a)), max(0, min(len(t), b))))
        points = sorted(coupures)
        ordre = {tag: i for i, tag in enumerate(self._ordre_tags)}
        segments = []
        for a, b in zip(points, points[1:]):
            if b <= a:
                continue
            style = {}
            for tag in sorted(self._tags, key=lambda x: ordre.get(x, -1)):
                st = self._styles.get(tag)
                if st and any(x <= a and b <= y for x, y in self._tags[tag]):
                    style.update(st)
            segments.append({"texte": t[a:b], "style": style or None})
        self._sel_envoyee = c = self._vue_selection()
        _ui.configurer(self._id, _js({"contenu": segments, "curseur": c}))

    def _bloque(self):
        return str(self._o.get("state", "normal")) == "disabled"

    # — index « ligne.colonne », marques, sélection —
    def _offset(self, index):
        t = self._contenu
        s = str(index).strip()
        m = re.match(r"^(\d+\.\d+|\d+\.end|end|insert|current|anchor|sel\.first|sel\.last|@-?\d+,-?\d+|[\w.]+\.(?:first|last)|[A-Za-z_][\w]*)(.*)$", s)
        if not m:
            raise TclError(f'bad text index "{index}"')
        base, reste = m.group(1), m.group(2)
        if base == "end":
            pos = len(t)
        elif base in ("sel.first", "sel.last"):
            if not self._sel:
                raise TclError('text doesn\'t contain any characters tagged with "sel"')
            pos = self._sel[0] if base == "sel.first" else self._sel[1]
        elif base.startswith("@"):
            x, y = base[1:].split(",")
            p = _ui.lire(self._id, "decalageA", _js([int(x), int(y)]))
            pos = len(t) - 1 if p is None else int(p)
        elif re.fullmatch(r"\d+\.(\d+|end)", base):
            l, c = base.split(".")
            lignes = t.split("\n")
            l = int(l)
            if l < 1:
                pos = 0
            elif l > len(lignes) - 1:
                pos = len(t)
            else:
                debut = sum(len(x) + 1 for x in lignes[:l - 1])
                longueur = len(lignes[l - 1])
                col = longueur if c == "end" else min(int(c), longueur)
                pos = debut + col
        elif base.endswith(".first") or base.endswith(".last"):
            tag = base.rsplit(".", 1)[0]
            plages = sorted(self._tags.get(tag, []))
            if not plages:
                raise TclError(f'text doesn\'t contain any characters tagged with "{tag}"')
            pos = plages[0][0] if base.endswith(".first") else plages[-1][1]
        elif base in self._marques and self._marques[base] is not None:
            pos = self._marques[base]
        else:
            raise TclError(f'bad text index "{index}"')
        for mod in re.findall(r"\s*([+-]\s*\d+\s*(?:c|chars?|l|lines?|indices|display\s+chars|display\s+lines)?|linestart|lineend|wordstart|wordend)", reste):
            mod = mod.replace(" ", "")
            if mod == "linestart":
                pos = t.rfind("\n", 0, pos) + 1
            elif mod == "lineend":
                i = t.find("\n", pos)
                pos = len(t) - 1 if i < 0 else i
            elif mod == "wordstart":
                while pos > 0 and (t[pos - 1].isalnum() or t[pos - 1] == "_"):
                    pos -= 1
            elif mod == "wordend":
                while pos < len(t) and (t[pos].isalnum() or t[pos] == "_"):
                    pos += 1
            else:
                mm = re.match(r"([+-])(\d+)(.*)", mod)
                n = int(mm.group(2)) * (1 if mm.group(1) == "+" else -1)
                if mm.group(3).startswith("l") or mm.group(3).startswith("displayl"):
                    avant = t[:min(pos, len(t) - 1)].split("\n")
                    l, c = len(avant), len(avant[-1])
                    l = max(1, min(len(t.split("\n")) - 1, l + n))
                    debut = sum(len(x) + 1 for x in t.split("\n")[:l - 1])
                    pos = debut + min(c, len(t.split("\n")[l - 1]))
                else:
                    pos += n
        return max(0, min(len(t), pos))

    def _pos_index(self, p):
        avant = self._contenu[:p].split("\n")
        return f"{len(avant)}.{len(avant[-1])}"

    def index(self, index):
        self._synchro()
        p = self._offset(index)
        if p >= len(self._contenu):
            p = len(self._contenu)  # « end » : ligne après la dernière
        return self._pos_index(p)

    def get(self, index1, index2=None):
        self._synchro()
        a = min(self._offset(index1), len(self._contenu) - 1)
        b = a + 1 if index2 is None else self._offset(index2)
        return self._contenu[a:b] if b > a else ""

    def _decaler(self, p, n, fin=None):
        """Tags et marques après une insertion (n > 0 en p) ou une suppression de [p, fin)."""
        for plages in self._tags.values():
            for r in plages:
                if n >= 0:
                    if r[0] >= p:
                        r[0] += n
                    if r[1] > p:
                        r[1] += n
                else:
                    for k in (0, 1):
                        if r[k] >= fin:
                            r[k] += n
                        elif r[k] > p:
                            r[k] = p
            plages[:] = [r for r in plages if r[1] > r[0]]
        for k, v in list(self._marques.items()):
            if v is None:
                continue
            if n >= 0:
                if v > p or (v == p and self._gravites.get(k, "right") == "right"):
                    self._marques[k] = v + n
            elif v >= fin:
                self._marques[k] = v + n
            elif v > p:
                self._marques[k] = p
        if self._sel:
            a, b = self._sel
            if n >= 0:
                self._sel = (a + n if a >= p else a, b + n if b > p else b)
            else:
                a = a + n if a >= fin else (p if a > p else a)
                b = b + n if b >= fin else (p if b > p else b)
                self._sel = (a, b) if b > a else None

    def _ajouter_plage(self, tag, a, b):
        if b <= a:
            return
        if tag not in self._ordre_tags:
            self._ordre_tags.append(tag)
        plages = sorted(self._tags.get(tag, []) + [[a, b]])
        fusion = []
        for x, y in plages:
            if fusion and x <= fusion[-1][1]:
                fusion[-1][1] = max(fusion[-1][1], y)
            else:
                fusion.append([x, y])
        self._tags[tag] = fusion

    def _memoriser(self, avant, saisie=False):
        """Pile d'annulation (undo=True) : une frappe continue (< 1 s) forme un seul pas, comme Tk."""
        try:
            actif = getboolean(self._o.get("undo", False))
        except TclError:
            actif = False
        if not actif:
            return
        maintenant = time.monotonic()
        regrouper = saisie and self._annuler and self._annuler[-1][2] and maintenant - self._derniere_saisie < 1.0 and not self._separateur
        if not regrouper:
            self._annuler.append([avant, self._marques.get("insert", 0), saisie, {k: [list(r) for r in v] for k, v in self._tags.items()}])
            n = int(self._o.get("maxundo", 0) or 0)
            if n > 0:
                del self._annuler[:-n]
        self._derniere_saisie = maintenant
        self._separateur = False
        self._retablir.clear()

    def _marquer_modifie(self):
        if not self._modifie:
            self._modifie = True
            _virtuel(self, "<<Modified>>")

    def insert(self, index, chars, *args):
        if self._bloque():
            return  # Tk ignore insert / delete quand state="disabled"
        self._synchro()
        p = min(self._offset(index), len(self._contenu) - 1)
        avant = self._contenu
        morceaux = [chars, *args]
        for i in range(0, len(morceaux), 2):
            t = str(morceaux[i])
            tags = morceaux[i + 1] if i + 1 < len(morceaux) else ()
            tags = tuple(tags.split()) if isinstance(tags, str) else tuple(tags or ())
            if not t:
                continue
            self._contenu = self._contenu[:p] + t + self._contenu[p:]
            self._decaler(p, len(t))
            for tag in tags:
                if tag:
                    self._ajouter_plage(str(tag), p, p + len(t))
            p += len(t)
        if self._contenu != avant:
            self._memoriser(avant)
            self._marquer_modifie()
            self._rendre()

    def delete(self, index1, index2=None):
        if self._bloque():
            return
        self._synchro()
        a = self._offset(index1)
        b = a + 1 if index2 is None else self._offset(index2)
        b = min(b, len(self._contenu) - 1)
        if b <= a:
            return
        avant = self._contenu
        self._contenu = self._contenu[:a] + self._contenu[b:]
        self._decaler(a, -(b - a), fin=b)
        self._memoriser(avant)
        self._marquer_modifie()
        self._rendre()

    def replace(self, index1, index2, chars, *args):
        self._synchro()
        p = self._offset(index1)
        self.delete(index1, index2)
        self.insert(self._pos_index(p), chars, *args)

    def see(self, index):
        self._synchro()
        p = self._offset(index)
        self._vider_rendu()
        _ui.ecrire(self._id, "voir", p)

    def mark_set(self, markName, index):
        self._synchro()
        p = min(self._offset(index), len(self._contenu) - 1)
        self._marques[str(markName)] = p
        if markName in (INSERT, "insert") and (not self._sel or p in self._sel):
            self._envoyer_selection()  # hors de la sélection, la page la garde affichée (le modèle retient le curseur)

    def mark_unset(self, *markNames):
        for m in markNames:
            if m not in ("insert", "current"):
                self._marques.pop(m, None)

    def mark_names(self):
        return tuple(self._marques)

    def mark_gravity(self, markName, direction=None):
        if direction is None:
            return self._gravites.get(markName, "right")
        self._gravites[markName] = str(direction)

    def mark_next(self, index):
        p = self._offset(index)
        suivantes = sorted((v, k) for k, v in self._marques.items() if v is not None and v >= p)
        return suivantes[0][1] if suivantes else ""

    def mark_previous(self, index):
        p = self._offset(index)
        prec = sorted((v, k) for k, v in self._marques.items() if v is not None and v < p)
        return prec[-1][1] if prec else ""

    # — tags —
    def tag_add(self, tagName, index1, *args):
        self._synchro()
        indices = [index1, *args]
        for i in range(0, len(indices), 2):
            a = self._offset(indices[i])
            b = self._offset(indices[i + 1]) if i + 1 < len(indices) else a + 1
            if tagName == SEL:
                n = len(self._contenu) - 1
                self._sel = (min(a, n), min(b, n)) if min(b, n) > min(a, n) else None
            else:
                self._ajouter_plage(str(tagName), a, b)
        if tagName == SEL:
            self._envoyer_selection()
        else:
            self._rendre()

    def tag_remove(self, tagName, index1, index2=None):
        self._synchro()
        a = self._offset(index1)
        b = a + 1 if index2 is None else self._offset(index2)
        if tagName == SEL:
            if self._sel and self._sel[0] < b and self._sel[1] > a:
                self._sel = None
                self._envoyer_selection()
            return
        restes = []
        for x, y in self._tags.get(tagName, []):
            if y <= a or x >= b:
                restes.append([x, y])
            else:
                if x < a:
                    restes.append([x, a])
                if y > b:
                    restes.append([b, y])
        self._tags[tagName] = restes
        self._rendre()

    def tag_delete(self, *tagNames):
        for t in tagNames:
            self._tags.pop(t, None)
            self._styles.pop(t, None)
            self._opts_tags.pop(t, None)
            self._liaisons_items.pop(t, None)
            if t in self._ordre_tags:
                self._ordre_tags.remove(t)
        self._rendre()

    def tag_configure(self, tagName, cnf=None, **kw):
        o = {**(cnf or {}), **kw}
        tagName = str(tagName)
        brut = self._opts_tags.setdefault(tagName, {})
        if not o:
            return {k: (k, "", "", "", v) for k, v in brut.items()}
        if tagName not in self._ordre_tags:
            self._ordre_tags.append(tagName)
        st = self._styles.setdefault(tagName, {})
        for k, v in o.items():
            k = {"bg": "background", "fg": "foreground"}.get(k, k)
            brut[k] = v
            if k == "foreground":
                st["couleur"] = _couleur(v)
            elif k == "background":
                st["fond"] = _couleur(v)
            elif k == "font":
                st["police"] = _police(v)
            elif k == "underline":
                st["souligne"] = bool(v) and str(v) not in ("0", "false")
            elif k == "overstrike":
                st["barre"] = bool(v) and str(v) not in ("0", "false")
            elif k == "justify":
                st["justif"] = str(v)
            elif k == "elide":
                st["cache"] = bool(v) and str(v) not in ("0", "false")
        self._rendre()

    tag_config = tag_configure

    def tag_cget(self, tagName, option):
        return self._opts_tags.get(str(tagName), {}).get({"bg": "background", "fg": "foreground"}.get(option, option), "")

    def tag_names(self, index=None):
        if index is None:
            return tuple(["sel"] + [t for t in self._ordre_tags if t != "sel"] + [t for t in self._tags if t not in self._ordre_tags])
        self._synchro()
        p = self._offset(index)
        noms = [t for t in self._ordre_tags if any(a <= p < b for a, b in self._tags.get(t, []))]
        if self._sel and self._sel[0] <= p < self._sel[1]:
            noms.insert(0, "sel")
        return tuple(noms)

    def tag_ranges(self, tagName):
        if tagName == SEL:
            self._synchro()
            return (self._pos_index(self._sel[0]), self._pos_index(self._sel[1])) if self._sel else ()
        out = []
        for a, b in sorted(self._tags.get(str(tagName), [])):
            out += [self._pos_index(a), self._pos_index(b)]
        return tuple(out)

    def tag_nextrange(self, tagName, index1, index2=None):
        a = self._offset(index1)
        b = self._offset(index2) if index2 else len(self._contenu)
        for x, y in sorted(self._tags.get(str(tagName), [])):
            if y > a and x < b:
                return (self._pos_index(max(x, a)), self._pos_index(y))
        return ()

    def tag_prevrange(self, tagName, index1, index2=None):
        a = self._offset(index1)
        b = self._offset(index2) if index2 else 0
        for x, y in sorted(self._tags.get(str(tagName), []), reverse=True):
            if x < a and y > b:
                return (self._pos_index(x), self._pos_index(min(y, a)))
        return ()

    def tag_raise(self, tagName, aboveThis=None):
        tagName = str(tagName)
        if tagName in self._ordre_tags:
            self._ordre_tags.remove(tagName)
        if aboveThis is not None and str(aboveThis) in self._ordre_tags:
            self._ordre_tags.insert(self._ordre_tags.index(str(aboveThis)) + 1, tagName)
        else:
            self._ordre_tags.append(tagName)
        self._rendre()

    def tag_lower(self, tagName, belowThis=None):
        tagName = str(tagName)
        if tagName in self._ordre_tags:
            self._ordre_tags.remove(tagName)
        if belowThis is not None and str(belowThis) in self._ordre_tags:
            self._ordre_tags.insert(self._ordre_tags.index(str(belowThis)), tagName)
        else:
            self._ordre_tags.insert(0, tagName)
        self._rendre()

    def tag_bind(self, tagName, sequence, func, add=None):
        liaisons = self._liaisons_items.setdefault(str(tagName), {})
        motif = _analyser(sequence)
        lst = liaisons.setdefault(motif, [])
        if not add:
            lst.clear()
        if func is not None:
            lst.append(func)
        _maj_ecoute(self)
        return f"{id(func)}"

    def tag_unbind(self, tagName, sequence, funcid=None):
        self._liaisons_items.get(str(tagName), {}).pop(_analyser(sequence), None)

    def _tags_en(self, p):
        return [t for t in self._ordre_tags if any(a <= p < b for a, b in self._tags.get(t, []))]

    def _evenement_item(self, d, ev, e):
        """Liaisons de tags (liens cliquables…) : caractère sous la souris, entrée / sortie des plages."""
        p = d.get("decalage")
        tags = []
        if p is not None:
            p = int(p)
            self._marques["current"] = p
            tags = self._tags_en(p)
        if ev["type"] == "Motion":
            for t in [x for x in self._survoles if x not in tags]:
                self._appeler_tag(t, "Leave", e)
            for t in [x for x in tags if x not in self._survoles]:
                self._appeler_tag(t, "Enter", e)
            self._survoles = set(tags)
        for t in tags:
            liaisons = self._liaisons_items.get(t)
            if liaisons:
                for fn in list(_choisir(liaisons, ev)):
                    e.widget = self
                    _appeler(fn, e)

    def _appeler_tag(self, tag, tk_type, e):
        liaisons = self._liaisons_items.get(tag)
        if liaisons:
            for fn in list(_choisir(liaisons, {"type": tk_type, "detail": None, "mods": set()})):
                _appeler(fn, Event(type=getattr(EventType, tk_type), widget=self, x=e.x, y=e.y, x_root=e.x_root, y_root=e.y_root))

    def _survol_item(self, d, type_, commun):
        if type_ == "mouseout" and int(d.get("autre", 0) or 0) != self._id:
            e = Event(**commun)
            for t in list(self._survoles):
                self._appeler_tag(t, "Leave", e)
            self._survoles = set()

    # — recherche, comparaison —
    def search(self, pattern, index, stopindex=None, forwards=None, backwards=None, exact=None, regexp=None, nocase=None, count=None, elide=None):
        self._synchro()
        debut = self._offset(index)
        texte = self._contenu
        flags = re.I if nocase else 0
        motif = re.compile(str(pattern) if regexp else re.escape(str(pattern)), flags)
        if backwards:
            limite = self._offset(stopindex) if stopindex else None
            zones = [(limite if limite is not None else 0, debut)] + ([] if stopindex else [(debut, len(texte))])
            trouve = None
            for a, b in zones:
                for m in motif.finditer(texte, a, b):
                    if m.end() <= b:
                        trouve = m
                if trouve:
                    break
        else:
            fin = self._offset(stopindex) if stopindex else len(texte)
            trouve = motif.search(texte, debut, fin)
            if not trouve and not stopindex:
                trouve = motif.search(texte, 0, debut)  # Tk reprend au début du texte
        if not trouve:
            return ""
        if count is not None and hasattr(count, "set"):
            count.set(len(trouve.group(0)))
        return self._pos_index(trouve.start())

    def compare(self, index1, op, index2):
        self._synchro()
        a, b = self._offset(index1), self._offset(index2)
        if op not in ("<", "<=", "==", ">=", ">", "!="):
            raise TclError(f'bad comparison operator "{op}"')
        return {"<": a < b, "<=": a <= b, "==": a == b, ">=": a >= b, ">": a > b, "!=": a != b}[op]

    def count(self, index1, index2, *args):
        self._synchro()
        a, b = sorted((self._offset(index1), self._offset(index2)))
        res = []
        for opt in (args or ("indices",)):
            opt = str(opt).lstrip("-")
            if opt in ("lines", "displaylines"):
                res.append(self._contenu[a:b].count("\n"))
            else:
                res.append(b - a)
        return tuple(res)

    # — annulation —
    def edit_modified(self, arg=None):
        if arg is None:
            return self._modifie
        v = bool(arg) and str(arg) not in ("0", "false", "False")
        if v != self._modifie:
            self._modifie = v
            _virtuel(self, "<<Modified>>")

    def _restaurer(self, etat, pile):
        contenu, curseur, _, tags = etat
        pile.append([self._contenu, self._marques.get("insert", 0), False, {k: [list(r) for r in v] for k, v in self._tags.items()}])
        self._contenu = contenu
        self._tags = tags
        self._marques["insert"] = min(curseur, len(contenu) - 1)
        self._sel = None
        self._marquer_modifie()
        self._rendre()

    def edit_undo(self):
        if not self._annuler:
            raise TclError("nothing to undo")
        self._restaurer(self._annuler.pop(), self._retablir)

    def edit_redo(self):
        if not self._retablir:
            raise TclError("nothing to redo")
        self._restaurer(self._retablir.pop(), self._annuler)

    def edit_reset(self):
        self._annuler.clear()
        self._retablir.clear()

    def edit_separator(self):
        self._separateur = True

    def edit(self, *args):
        if not args:
            return None
        return {"modified": lambda: self.edit_modified(*args[1:]), "undo": self.edit_undo, "redo": self.edit_redo, "reset": self.edit_reset, "separator": self.edit_separator}.get(args[0], lambda: None)()

    def _action_virtuelle(self, nom):
        if nom in ("<<Undo>>", "<<Redo>>"):
            try:
                self.edit_undo() if nom == "<<Undo>>" else self.edit_redo()
            except TclError:
                pass
            return
        a = {"<<Copy>>": "copier", "<<Cut>>": "couper", "<<Paste>>": "coller", "<<SelectAll>>": "toutSelectionner", "<<Clear>>": "effacer"}.get(nom)
        if not a:
            return
        self._synchro()
        if a in ("copier", "couper") and self._sel:
            _presse_papiers[0] = self._contenu[self._sel[0]:self._sel[1]]
        if a in ("couper", "coller", "effacer") and self._bloque():
            return
        self._vider_rendu()
        _ui.ecrire(self._id, "action", _js([a, _presse_papiers[0]]))

    # — intégrations (non gérées) —
    def window_create(self, index, cnf={}, **kw):
        pass

    def image_create(self, index, cnf={}, **kw):
        return f"image{next(_compteur)}"

    # — défilement —
    def xview(self, *args):
        return (0.0, 1.0)

    def yview(self, *args):
        self._vider_rendu()
        if not args:
            return tuple(float(x) for x in (_py(_ui.lire(self._id, "vue")) or [0.0, 1.0]))
        if args[0] == "moveto":
            self.yview_moveto(args[1])
        elif args[0] == "scroll":
            self.yview_scroll(args[1], args[2] if len(args) > 2 else "units")

    def yview_moveto(self, fraction):
        self._vider_rendu()
        _ui.ecrire(self._id, "defiler", float(fraction))

    def yview_scroll(self, number, what):
        debut, fin = self.yview()
        lignes = max(1, self._contenu.count("\n"))
        pas = (fin - debut) if str(what).startswith("p") else 1 / lignes
        _ui.ecrire(self._id, "defiler", max(0.0, debut + int(number) * pas))

    xview_moveto = xview
    xview_scroll = xview

    def dlineinfo(self, index):
        b = self.bbox(index)
        return None if b is None else (b[0], b[1], b[2], b[3], int(b[3] * 0.8))

    def bbox(self, index):
        self._synchro()
        p = self._offset(index)
        self._vider_rendu()
        b = _py(_ui.lire(self._id, "boiteCar", p))
        return tuple(int(x) for x in b) if b else None

    def _recevoir(self, type_, d):
        if type_ == "valeur":
            nouveau = str(d.get("valeur", ""))
            if not nouveau.endswith("\n"):
                nouveau += "\n"
                self._rendre()  # « \n » final effacé dans la page : on le remet
            if nouveau != self._contenu:
                ancien = self._contenu
                # Frappe : on retrouve la zone modifiée pour décaler tags et marques comme Tk.
                p = 0
                while p < min(len(ancien), len(nouveau)) and ancien[p] == nouveau[p]:
                    p += 1
                f = 0
                while f < min(len(ancien), len(nouveau)) - p and ancien[len(ancien) - 1 - f] == nouveau[len(nouveau) - 1 - f]:
                    f += 1
                self._memoriser(ancien, saisie=True)
                if len(ancien) - f > p:
                    self._decaler(p, -(len(ancien) - f - p), fin=len(ancien) - f)
                if len(nouveau) - f > p:
                    self._decaler(p, len(nouveau) - f - p)
                self._contenu = nouveau
                self._marquer_modifie()
            s = d.get("selection")
            if s:
                self._sel_envoyee = [int(s[0]), int(s[1])]
                n = len(self._contenu) - 1
                a, b = max(0, min(n, int(s[0]))), max(0, min(n, int(s[1])))
                self._marques["insert"] = b
                self._sel = (min(a, b), max(a, b)) if a != b else None
            return None
        if type_ in ("annuler", "retablir"):
            try:
                self.edit_undo() if type_ == "annuler" else self.edit_redo()
            except TclError:
                pass
            return None
        if type_ == "defilement":
            cmd = self._o.get("yscrollcommand")
            if cmd:
                _appeler(cmd, str(d.get("debut", 0)), str(d.get("fin", 1)))
            return None
        return super()._recevoir(type_, d)


# ─────────────────────────── Listbox ───────────────────────────

class Listbox(Widget):
    _type_js = "listbox"
    _classe_tk = "Listbox"
    _defauts = {"width": 20, "height": 10}

    def _preparer(self, o):
        self._elements = []
        self._couleurs = {}
        self._actif = 0
        self._ancre = 0
        var = o.get("listvariable")
        if var is not None:
            var._lier(self)
            self._elements = self._depuis_var(var)

    def _depuis_var(self, var):
        v = var._valeur
        if isinstance(v, (list, tuple)):
            return [_chaine_tcl(x) for x in v]
        s = str(v)
        if s.startswith("(") and s.endswith(")"):
            try:
                import ast

                return [_chaine_tcl(x) for x in ast.literal_eval(s)]
            except Exception:
                pass
        return s.split() if s else []

    def _traduire(self, o):
        j = super()._traduire(o)
        if "height" in o:
            j["hauteurLignes"] = int(o["height"] or 10)
            if "dimensions" in j:
                j["dimensions"]["hauteur"] = None
        if "selectmode" in o:
            j["multiple"] = str(o["selectmode"]) in ("multiple", "extended")
        if "listvariable" in o and o["listvariable"] is not None:
            o["listvariable"]._lier(self)
            self._elements = self._depuis_var(o["listvariable"])
            j["elements"] = self._desc()
        if "yscrollcommand" in o:
            j["suiviDefilement"] = bool(o["yscrollcommand"])
        return j

    def _desc(self):
        out = []
        for i, e in enumerate(self._elements):
            d = {"texte": e}
            c = self._couleurs.get(i, {})
            if c.get("background"):
                d["fond"] = _couleur(c["background"])
            if c.get("foreground"):
                d["couleur"] = _couleur(c["foreground"])
            out.append(d)
        return out

    def _envoyer(self, selection=None):
        j = {"elements": self._desc()}
        if selection is not None:
            j["selection"] = sorted(set(selection))
        _ui.configurer(self._id, _js(j))

    def _variable_changee(self, var):
        if var is self._o.get("listvariable"):
            self._elements = self._depuis_var(var)
            self._envoyer()
        else:
            super()._variable_changee(var)

    def _i(self, index, fin=False):
        """Index Tk : « end » = dernier élément ; pour insert / index, la position après le dernier."""
        n = len(self._elements)
        if index in (END, "end"):
            return n if fin else max(0, n - 1)
        if index in (ACTIVE, "active"):
            return self._actif
        if index in (ANCHOR, "anchor"):
            return self._ancre
        if isinstance(index, str) and index.startswith("@"):
            try:
                return self.nearest(int(float(index[1:].split(",")[1])))
            except (IndexError, ValueError):
                return 0
        try:
            return int(index)
        except (TypeError, ValueError):
            raise TclError(f'bad listbox index "{index}": must be active, anchor, end, @x,y, or a number')

    def insert(self, index, *elements):
        if not elements:
            return
        i = max(0, min(self._i(index, fin=True), len(self._elements)))
        k = len(elements)
        self._elements[i:i] = [_chaine_tcl(e) for e in elements]
        self._couleurs = {(j + k if j >= i else j): c for j, c in self._couleurs.items()}
        sel = [j + k if j >= i else j for j in self.curselection()]
        self._sync_var()
        self._envoyer(sel)

    def delete(self, first, last=None):
        n = len(self._elements)
        a = max(0, self._i(first))
        b = a if last is None else min(n - 1, self._i(last))
        if n == 0 or b < a:
            return
        k = b - a + 1
        del self._elements[a:b + 1]
        # Couleurs (itemconfig) et sélection suivent les éléments restants.
        self._couleurs = {(j - k if j > b else j): c for j, c in self._couleurs.items() if not a <= j <= b}
        sel = [j - k if j > b else j for j in self.curselection() if not a <= j <= b]
        if self._actif > b:
            self._actif -= k
        elif self._actif >= a:
            self._actif = min(a, max(0, len(self._elements) - 1))
        self._sync_var()
        self._envoyer(sel)

    def _sync_var(self):
        var = self._o.get("listvariable")
        if var is not None:
            var._valeur = tuple(self._elements)

    def get(self, first, last=None):
        if last is None:
            i = self._i(first)
            return self._elements[i] if 0 <= i < len(self._elements) else ""
        a, b = max(0, self._i(first)), self._i(last)
        return tuple(self._elements[a:b + 1])

    def size(self):
        return len(self._elements)

    def curselection(self):
        return tuple(int(i) for i in (_py(_ui.lire(self._id, "selection")) or []))

    def selection_set(self, first, last=None):
        a = self._i(first)
        b = a if last is None else self._i(last)
        a, b = min(a, b), max(a, b)
        sel = set(self.curselection()) if str(self._o.get("selectmode", "browse")) in ("multiple", "extended") else set()
        sel.update(i for i in range(a, b + 1) if 0 <= i < len(self._elements))
        _ui.configurer(self._id, _js({"selection": sorted(sel)}))

    select_set = selection_set

    def selection_clear(self, first, last=None):
        a = self._i(first)
        b = a if last is None else self._i(last)
        a, b = min(a, b), max(a, b)
        sel = [i for i in self.curselection() if not a <= i <= b]
        _ui.configurer(self._id, _js({"selection": sel}))

    select_clear = selection_clear

    def selection_includes(self, index):
        return self._i(index) in self.curselection()

    select_includes = selection_includes

    def selection_anchor(self, index):
        self._ancre = self._i(index)

    select_anchor = selection_anchor

    def activate(self, index):
        self._actif = max(0, min(len(self._elements) - 1, self._i(index))) if self._elements else 0

    def see(self, index):
        _ui.configurer(self._id, _js({"voir": self._i(index)}))

    def index(self, index):
        return self._i(index, fin=True)

    def nearest(self, y):
        i = _ui.lire(self._id, "proche", int(y))
        return -1 if i is None else int(i)

    def itemconfigure(self, index, cnf=None, **kw):
        o = {**(cnf or {}), **kw}
        i = self._i(index)
        if not o:
            c = self._couleurs.get(i, {})
            return {k: (k, "", "", "", c.get(k, "")) for k in ("background", "foreground", "selectbackground", "selectforeground")}
        c = self._couleurs.setdefault(i, {})
        for k, v in o.items():
            c[{"bg": "background", "fg": "foreground"}.get(k, k)] = v
        self._envoyer()

    itemconfig = itemconfigure

    def itemcget(self, index, option):
        return self._couleurs.get(self._i(index), {}).get({"bg": "background", "fg": "foreground"}.get(option, option), "")

    def bbox(self, index):
        b = _py(_ui.lire(self._id, "boiteElement", self._i(index)))
        return tuple(int(x) for x in b) if b else None

    def xview(self, *args):
        return (0.0, 1.0)

    def yview(self, *args):
        if not args:
            return tuple(float(x) for x in (_py(_ui.lire(self._id, "vue")) or [0.0, 1.0]))
        if args[0] == "moveto":
            _ui.ecrire(self._id, "defiler", float(args[1]))
        elif args[0] == "scroll":
            self.yview_scroll(args[1], args[2] if len(args) > 2 else "units")

    def yview_moveto(self, fraction):
        _ui.ecrire(self._id, "defiler", float(fraction))

    def yview_scroll(self, number, what):
        debut, fin = self.yview()
        n = max(1, len(self._elements))
        pas = (fin - debut) if str(what).startswith("p") else 1 / n
        _ui.ecrire(self._id, "defiler", max(0.0, debut + int(number) * pas))

    xview_moveto = xview
    xview_scroll = xview

    def scan_mark(self, x, y):
        pass

    def scan_dragto(self, x, y):
        pass

    def _recevoir(self, type_, d):
        if type_ == "selection":
            ind = d.get("indices") or []
            if ind:
                self._actif = int(ind[-1])
                self._ancre = int(ind[0])
            _virtuel(self, "<<ListboxSelect>>")
            return None
        if type_ == "defilement":
            cmd = self._o.get("yscrollcommand")
            if cmd:
                _appeler(cmd, str(d.get("debut", 0)), str(d.get("fin", 1)))
            return None
        return super()._recevoir(type_, d)


# ─────────────────────────── OptionMenu, Menubutton ───────────────────────────

class OptionMenu(Widget):
    _type_js = "select"
    _classe_tk = "Menubutton"

    def __init__(self, master, variable, value=None, *values, **kwargs):
        self._var = variable
        self._commande = kwargs.pop("command", None)
        self._liste = [str(x) for x in ([value] if value is not None else []) + list(values)]
        super().__init__(master, {}, **kwargs)
        variable._lier(self)
        _ui.configurer(self._id, _js({"valeurs": self._liste, "valeur": str(variable._valeur)}))
        self["menu"] = _MenuOptions(self)

    def _variable_changee(self, var):
        if var is self._var:
            _ui.configurer(self._id, _js({"valeur": str(var._valeur)}))

    def _recevoir(self, type_, d):
        if type_ == "commande":
            v = str(d.get("valeur", ""))
            self._var.set(v)
            if self._commande:
                _appeler(self._commande, v)
            return None
        return super()._recevoir(type_, d)

    def _ajouter(self, label, command=None):
        self._liste.append(str(label))
        _ui.configurer(self._id, _js({"valeurs": self._liste}))

    def _vider(self):
        self._liste = []
        _ui.configurer(self._id, _js({"valeurs": []}))


class _MenuOptions:
    """optionmenu['menu'] : delete(0, 'end') et add_command(label=…, command=…)."""

    def __init__(self, om):
        self._om = om

    def delete(self, first, last=None):
        self._om._vider()

    def add_command(self, label=None, command=None, **kw):
        self._om._ajouter(label, command)

    def index(self, i):
        return len(self._om._liste) - 1

    def entryconfigure(self, *a, **k):
        pass

    entryconfig = entryconfigure


class Menubutton(Button):
    _classe_tk = "Menubutton"

    def invoke(self):
        m = self._o.get("menu")
        if isinstance(m, Menu):
            t = self._taille()
            m.post(t[2], t[3] + t[1])
        return ""


# ─────────────────────────── Menus ───────────────────────────

class Menu(Widget):
    _type_js = "frame"
    _classe_tk = "Menu"

    def __init__(self, master=None, cnf={}, **kw):
        if master is None:
            master = _racine_defaut()
        self._init_commun()
        self.master = master
        self.tk = _STUB
        self._name = f"!menu{self._id}"
        self._chemin = f"{'' if master._chemin == '.' else master._chemin}.{self._name}"
        master.children[self._name] = self
        self._items = []
        self._o.update(self._normaliser(cnf, kw))

    def _maj(self):
        racine = self
        while isinstance(racine.master, Menu):
            racine = racine.master
        for w in list(_widgets.values()):
            if isinstance(w, Wm) and not w._detruit and w._o.get("menu") is racine:
                w._menu()

    def _desc(self):
        out = []
        for i, it in enumerate(self._items):
            d = {"type": it["type"], "label": str(it.get("label", "")), "index": i + self._dec(), "menu": self._id, "etat": str(it.get("state", "normal")), "accelerateur": str(it.get("accelerator", ""))}
            if it["type"] == "cascade" and isinstance(it.get("menu"), Menu):
                d["items"] = it["menu"]._desc()
                d["menu"] = it["menu"]._id
            if it["type"] == "check":
                var = it.get("variable")
                d["coche"] = var is not None and _meme_valeur(var, it.get("onvalue", 1))
            if it["type"] == "radio":
                var = it.get("variable")
                d["coche"] = var is not None and _meme_valeur(var, it.get("value", it.get("label")))
            out.append(d)
        return out

    def _dec(self):
        """Tk réserve l'index 0 à l'entrée détachable (tearoff=1 par défaut) : les entrées commencent à 1."""
        try:
            return 1 if getboolean(self._o.get("tearoff", 1)) else 0
        except TclError:
            return 1

    def add(self, itemType, cnf={}, **kw):
        t = {"command": "command", "cascade": "cascade", "separator": "separator", "checkbutton": "check", "radiobutton": "radio"}.get(itemType, itemType)
        self._items.append({"type": t, **cnf, **kw})
        self._maj()

    def add_command(self, cnf={}, **kw):
        self.add("command", cnf, **kw)

    def add_cascade(self, cnf={}, **kw):
        self.add("cascade", cnf, **kw)

    def add_separator(self, cnf={}, **kw):
        self.add("separator", cnf, **kw)

    def add_checkbutton(self, cnf={}, **kw):
        o = {**cnf, **kw}
        if o.get("variable") is None:
            o["variable"] = IntVar()
        self.add("checkbutton", o)

    def add_radiobutton(self, cnf={}, **kw):
        self.add("radiobutton", cnf, **kw)

    def insert(self, index, itemType, cnf={}, **kw):
        t = {"checkbutton": "check", "radiobutton": "radio"}.get(itemType, itemType)
        self._items.insert(max(0, min(len(self._items), self._idx(index, insertion=True))), {"type": t, **cnf, **kw})
        self._maj()

    def insert_command(self, index, cnf={}, **kw):
        self.insert(index, "command", cnf, **kw)

    def insert_cascade(self, index, cnf={}, **kw):
        self.insert(index, "cascade", cnf, **kw)

    def insert_separator(self, index, cnf={}, **kw):
        self.insert(index, "separator", cnf, **kw)

    def _idx(self, index, insertion=False):
        """Index interne (sans l'entrée détachable) ; -1 = l'entrée détachable ou « none »."""
        n = len(self._items)
        if index in (END, "end", "last"):
            return n if insertion else n - 1
        if index in ("none", "active", None, ""):
            return -1
        if isinstance(index, int) or (isinstance(index, str) and index.isdigit()):
            return int(index) - self._dec()
        if isinstance(index, str) and index.startswith("@"):
            return -1
        for i, it in enumerate(self._items):
            if str(it.get("label")) == str(index):
                return i
        import fnmatch

        for i, it in enumerate(self._items):
            if fnmatch.fnmatchcase(str(it.get("label", "")), str(index)):
                return i
        raise TclError(f'bad menu entry index "{index}"')

    def delete(self, index1, index2=None):
        a = self._idx(index1)
        b = a if index2 is None else self._idx(index2)
        a = max(0, a)
        if b >= a:
            del self._items[a:b + 1]
            self._maj()

    def entryconfigure(self, index, cnf=None, **kw):
        i = self._idx(index)
        o = {**(cnf or {}), **kw}
        if not 0 <= i < len(self._items):
            return {} if not o else None
        if not o:
            return {k: (k, "", "", "", v) for k, v in self._items[i].items() if k != "type"}
        self._items[i].update(o)
        self._maj()

    entryconfig = entryconfigure

    def entrycget(self, index, option):
        i = self._idx(index)
        return self._items[i].get(option, "") if 0 <= i < len(self._items) else ""

    def index(self, index):
        if index in (END, "end", "last"):
            n = len(self._items) + self._dec()
            return None if n == 0 else n - 1
        i = self._idx(index)
        return None if i < -1 or (i == -1 and not self._dec()) else i + self._dec()

    def type(self, index):
        i = self._idx(index)
        if i == -1 and self._dec():
            return "tearoff"
        return {"check": "checkbutton", "radio": "radiobutton"}.get(self._items[i]["type"], self._items[i]["type"])

    def invoke(self, index):
        i = self._idx(index)
        if not 0 <= i < len(self._items):
            return None
        it = self._items[i]
        if str(it.get("state", "normal")) == "disabled":
            return None
        if it["type"] == "check" and it.get("variable") is not None:
            var = it["variable"]
            on, off = it.get("onvalue", 1), it.get("offvalue", 0)
            var.set(off if _meme_valeur(var, on) else on)
            self._maj()
        elif it["type"] == "radio" and it.get("variable") is not None:
            it["variable"].set(it.get("value", it.get("label")))
            self._maj()
        cmd = it.get("command")
        return _appeler(cmd) if cmd else None

    def _postcommand(self):
        pc = self._o.get("postcommand")
        if pc:
            _appeler(pc)

    def post(self, x, y):
        self._postcommand()
        _ui.menuContextuel(self._id, _js(self._desc()), int(x), int(y))

    def tk_popup(self, x, y, entry=""):
        self.post(x, y)

    def unpost(self):
        pass

    def activate(self, index):
        pass

    def yposition(self, index):
        return 0

    def xposition(self, index):
        return 0

    def _recevoir(self, type_, d):
        if type_ == "menu":
            self.invoke(int(d.get("index", 0)))
            return None
        if type_ == "ouvrir":
            self._postcommand()  # peut modifier le menu : la page relit sa description ensuite
            return None
        return super()._recevoir(type_, d)

    def pack(self, *a, **k):
        pass

    grid = place = pack


# ─────────────────────────── PanedWindow ───────────────────────────

class PanedWindow(Widget):
    _type_js = "frame"
    _unite = "px"
    _classe_tk = "Panedwindow"

    def add(self, child, **kw):
        vertical = str(self._o.get("orient", "horizontal")) == "vertical"
        child.pack(side=TOP if vertical else LEFT, fill=BOTH, expand=bool(kw.get("weight", 1)) or True)

    def forget(self, child):
        child.pack_forget()

    remove = forget

    def panes(self):
        return [w for w in self.winfo_children() if w._gestion == "pack"]

    def paneconfigure(self, tagOrId, cnf=None, **kw):
        pass

    paneconfig = paneconfigure

    def sash_coord(self, index):
        return (0, 0)

    def sash_place(self, index, x, y):
        pass

    def sashpos(self, index, newpos=None):
        return 0


# ─────────────────────────── Canvas ───────────────────────────

class Canvas(Widget):
    _type_js = "canvas"
    _classe_tk = "Canvas"
    _unite = "px"
    _defauts = {"width": 378, "height": 265}

    def _preparer(self, o):
        self._items = {}
        self._ordre = []
        self._prochain = 1
        self._liaisons_items = {}
        self._courant = None

    def _traduire(self, o):
        j = super()._traduire(o)
        if "background" in o:
            j["fond"] = _couleur(o["background"])
        if "width" in o or "height" in o:
            l = _pixels(self._o.get("width", 378))
            h = _pixels(self._o.get("height", 265))
            j["dimensions"] = {"largeur": l, "hauteur": h, "uniteL": "px", "uniteH": "px"}
        if "scrollregion" in o:
            j["zone"] = self._zone()
        if "xscrollcommand" in o or "yscrollcommand" in o:
            j["suiviDefilement"] = bool(self._o.get("xscrollcommand") or self._o.get("yscrollcommand"))
        return j

    def _zone(self):
        z = self._o.get("scrollregion")
        if not z:
            return None
        v = [float(_pixels(x)) for x in (z if isinstance(z, (list, tuple)) else str(z).split())]
        return v if len(v) == 4 else None

    # — modèle des éléments —
    def _creer(self, kind, args, kw):
        if kind in ("text", "image", "window", "bitmap"):
            coords = _aplatir(args[:2] if len(args) >= 2 or not args or not isinstance(args[0], (list, tuple)) else args[0])
        else:
            coords = _aplatir(args)
        o = {self._alias.get(k, k): v for k, v in kw.items()}
        tags = o.pop("tags", o.pop("tag", ()))
        if isinstance(tags, str):
            tags = tuple(tags.split())
        i = self._prochain
        self._prochain += 1
        self._items[i] = {"kind": kind, "coords": coords, "opts": o, "tags": list(tags)}
        self._ordre.append(i)
        self._envoyer([["creer", i, "image" if kind == "bitmap" else kind, coords, self._opts_js(kind, o)]])
        return i

    def _opts_js(self, kind, o):
        j = {}
        for k, v in o.items():
            if k in ("fill", "outline", "activefill", "activeoutline"):
                j[k] = _couleur(v) if v != "" else ""
            elif k == "smooth":
                j["smooth"] = str(v).lower() not in ("0", "false", "no", "off", "")
            elif k == "angle":
                j["angle"] = float(v or 0)
            elif k == "font":
                j["font"] = _police(v)
            elif k == "width":
                j["width"] = _pixels(v)
            elif k == "image":
                j["image"] = _desc_image(v)
                im = v if isinstance(v, Image) else _images.get(str(v))
                if im is not None and self not in im._utilisateurs:
                    im._utilisateurs.append(self)  # image modifiée (put, configure) : éléments redessinés
            elif k == "window":
                j["widget"] = v._id
            elif k == "dash":
                j["dash"] = list(v) if isinstance(v, (list, tuple)) else [4, 4]
            elif k in ("text",):
                j["text"] = str(v)
            elif k in ("anchor", "arrow", "capstyle", "joinstyle", "style", "state", "justify"):
                j[k] = str(v)
            elif k in ("start", "extent", "height"):
                j[k] = float(v)
        if kind == "arc" and "style" not in j:
            j["style"] = "pieslice"
        return j

    def _envoyer(self, ops):
        _ui.dessin(self._id, _js(ops))

    def _resoudre(self, tagOrId):
        if tagOrId is None:
            return []
        if isinstance(tagOrId, int) or (isinstance(tagOrId, str) and tagOrId.isdigit()):
            i = int(tagOrId)
            return [i] if i in self._items else []
        t = str(tagOrId)
        if t == "all":
            return list(self._ordre)
        if t == "current":
            return [self._courant] if self._courant in self._items else []
        return [i for i in self._ordre if t in self._items[i]["tags"]]

    def _maj_item(self, i):
        it = self._items[i]
        self._envoyer([["maj", i, "image" if it["kind"] == "bitmap" else it["kind"], it["coords"], self._opts_js(it["kind"], it["opts"])]])

    def create_line(self, *args, **kw):
        return self._creer("line", args, kw)

    def create_rectangle(self, *args, **kw):
        return self._creer("rectangle", args, kw)

    def create_oval(self, *args, **kw):
        return self._creer("oval", args, kw)

    def create_polygon(self, *args, **kw):
        return self._creer("polygon", args, kw)

    def create_arc(self, *args, **kw):
        return self._creer("arc", args, kw)

    def create_text(self, *args, **kw):
        return self._creer("text", args, kw)

    def create_image(self, *args, **kw):
        return self._creer("image", args, kw)

    def create_bitmap(self, *args, **kw):
        return self._creer("bitmap", args, kw)

    def create_window(self, *args, **kw):
        return self._creer("window", args, kw)

    def coords(self, tagOrId, *args):
        ids = self._resoudre(tagOrId)
        if not ids:
            return []
        if not args:
            return list(self._items[ids[0]]["coords"])
        c = _aplatir(args)
        self._items[ids[0]]["coords"] = c
        self._maj_item(ids[0])

    def move(self, tagOrId, xAmount, yAmount):
        for i in self._resoudre(tagOrId):
            c = self._items[i]["coords"]
            self._items[i]["coords"] = [v + (float(xAmount) if k % 2 == 0 else float(yAmount)) for k, v in enumerate(c)]
            self._maj_item(i)

    def moveto(self, tagOrId, x="", y=""):
        for i in self._resoudre(tagOrId):
            b = self.bbox(i)
            if b:
                self.move(i, (float(x) - b[0]) if x != "" else 0, (float(y) - b[1]) if y != "" else 0)

    def scale(self, tagOrId, xOrigin, yOrigin, xScale, yScale):
        for i in self._resoudre(tagOrId):
            c = self._items[i]["coords"]
            self._items[i]["coords"] = [(float(xOrigin) + (v - float(xOrigin)) * float(xScale)) if k % 2 == 0 else (float(yOrigin) + (v - float(yOrigin)) * float(yScale)) for k, v in enumerate(c)]
            self._maj_item(i)

    def delete(self, *args):
        ops = []
        for a in args:
            for i in self._resoudre(a):
                self._items.pop(i, None)
                if i in self._ordre:
                    self._ordre.remove(i)
                ops.append(["suppr", i])
        if ops:
            self._envoyer(ops)

    def itemconfigure(self, tagOrId, cnf=None, **kw):
        ids = self._resoudre(tagOrId)
        if cnf is None and not kw:
            return {k: (k, "", "", "", v) for k, v in (self._items[ids[0]]["opts"].items() if ids else [])}
        o = {self._alias.get(k, k): v for k, v in {**(cnf or {}), **kw}.items()}
        for i in ids:
            if "tags" in o:
                t = o.pop("tags")
                self._items[i]["tags"] = list(t.split() if isinstance(t, str) else t)
            self._items[i]["opts"].update(o)
            self._maj_item(i)

    itemconfig = itemconfigure

    def itemcget(self, tagOrId, option):
        ids = self._resoudre(tagOrId)
        if not ids:
            return ""
        v = self._items[ids[0]]["opts"].get(self._alias.get(option, option), "")
        return str(v) if option in ("fill", "outline", "text") else v

    def type(self, tagOrId):
        ids = self._resoudre(tagOrId)
        return self._items[ids[0]]["kind"] if ids else None

    def gettags(self, tagOrId):
        ids = self._resoudre(tagOrId)
        return tuple(self._items[ids[0]]["tags"]) if ids else ()

    def addtag_withtag(self, newtag, tagOrId):
        for i in self._resoudre(tagOrId):
            if newtag not in self._items[i]["tags"]:
                self._items[i]["tags"].append(newtag)

    def addtag_all(self, newtag):
        self.addtag_withtag(newtag, "all")

    def addtag_closest(self, newtag, x, y, halo=None, start=None):
        for i in self.find_closest(x, y):
            self.addtag_withtag(newtag, i)

    def addtag_overlapping(self, newtag, x1, y1, x2, y2):
        for i in self.find_overlapping(x1, y1, x2, y2):
            self.addtag_withtag(newtag, i)

    def addtag_enclosed(self, newtag, x1, y1, x2, y2):
        for i in self.find_enclosed(x1, y1, x2, y2):
            self.addtag_withtag(newtag, i)

    def addtag_above(self, newtag, tagOrId):
        pass

    def addtag_below(self, newtag, tagOrId):
        pass

    def dtag(self, tagOrId, tagToDelete=None):
        tag = tagToDelete if tagToDelete is not None else tagOrId
        for i in self._resoudre(tagOrId):
            if tag in self._items[i]["tags"]:
                self._items[i]["tags"].remove(tag)

    def find_all(self):
        return tuple(self._ordre)

    def find_withtag(self, tagOrId):
        return tuple(self._resoudre(tagOrId))

    def _boite(self, i):
        it = self._items[i]
        c = it["coords"]
        if not c:
            return None
        a = str(it["opts"].get("anchor", "center")).lower()
        a = "" if a in ("center", "c") else a  # « center » contient un « e » et un « n » : à part
        if it["kind"] == "text":
            b = _py(_ui.lire(self._id, "boite", i))  # mesuré par le navigateur
            if b:
                return tuple(float(x) for x in b)
            police = it["opts"].get("font")
            taille = _taille_police(police) * 4 / 3
            lignes = str(it["opts"].get("text", "")).split("\n")
            l = max((len(x) for x in lignes), default=0) * taille * 0.6
            h = len(lignes) * taille * 1.2
        elif it["kind"] == "window":
            w = it["opts"].get("window")
            t = w._taille() if isinstance(w, Misc) else [0, 0]
            l, h = float(it["opts"].get("width", t[0]) or t[0]), float(it["opts"].get("height", t[1]) or t[1])
        elif it["kind"] in ("image", "bitmap"):
            d = _desc_image(it["opts"].get("image")) or {"largeur": 0, "hauteur": 0}
            l, h = d["largeur"], d["hauteur"]
        else:
            l = h = None
        if l is not None:
            x = c[0] - (0 if "w" in a else l if "e" in a else l / 2)
            y = c[1] - (0 if "n" in a else h if "s" in a else h / 2)
            return (x, y, x + l, y + h)
        xs, ys = c[0::2], c[1::2]
        w = float(it["opts"].get("width", 1) or 1) / 2
        return (min(xs) - w, min(ys) - w, max(xs) + w, max(ys) + w)

    def bbox(self, *args):
        boites = [self._boite(i) for a in args for i in self._resoudre(a)]
        boites = [b for b in boites if b]
        if not boites:
            return None
        return (int(min(b[0] for b in boites)), int(min(b[1] for b in boites)), int(round(max(b[2] for b in boites))), int(round(max(b[3] for b in boites))))

    def find_overlapping(self, x1, y1, x2, y2):
        out = []
        for i in self._ordre:
            b = self._boite(i)
            if b and b[0] <= float(x2) and b[2] >= float(x1) and b[1] <= float(y2) and b[3] >= float(y1):
                out.append(i)
        return tuple(out)

    def find_enclosed(self, x1, y1, x2, y2):
        out = []
        for i in self._ordre:
            b = self._boite(i)
            if b and b[0] >= float(x1) and b[2] <= float(x2) and b[1] >= float(y1) and b[3] <= float(y2):
                out.append(i)
        return tuple(out)

    def find_closest(self, x, y, halo=None, start=None):
        meilleur, dist = None, None
        for i in reversed(self._ordre):
            b = self._boite(i)
            if not b:
                continue
            dx = max(b[0] - float(x), 0, float(x) - b[2])
            dy = max(b[1] - float(y), 0, float(y) - b[3])
            d = dx * dx + dy * dy
            if dist is None or d < dist:
                meilleur, dist = i, d
        return (meilleur,) if meilleur is not None else ()

    def find_above(self, tagOrId):
        ids = self._resoudre(tagOrId)
        if not ids:
            return ()
        k = self._ordre.index(ids[-1])
        return (self._ordre[k + 1],) if k + 1 < len(self._ordre) else ()

    def find_below(self, tagOrId):
        ids = self._resoudre(tagOrId)
        if not ids:
            return ()
        k = self._ordre.index(ids[0])
        return (self._ordre[k - 1],) if k > 0 else ()

    def tag_raise(self, tagOrId, aboveThis=None):
        ops = []
        ref = self._resoudre(aboveThis)[-1] if aboveThis is not None and self._resoudre(aboveThis) else None
        for i in self._resoudre(tagOrId):
            if i == ref:
                continue
            self._ordre.remove(i)
            if ref is not None and ref in self._ordre:
                self._ordre.insert(self._ordre.index(ref) + 1, i)
                ops.append(["apres", i, ref])
                ref = i
            else:
                self._ordre.append(i)
                ops.append(["haut", i])
        self._envoyer(ops)

    lift = tkraise = tag_raise  # comme tkinter : sur un canvas, lift / lower agissent sur les éléments

    def tag_lower(self, tagOrId, belowThis=None):
        ops = []
        ref = self._resoudre(belowThis)[0] if belowThis is not None and self._resoudre(belowThis) else None
        for i in reversed(self._resoudre(tagOrId)):
            self._ordre.remove(i)
            if ref is not None and ref in self._ordre:
                self._ordre.insert(self._ordre.index(ref), i)
                ops.append(["avant", i, ref])
            else:
                self._ordre.insert(0, i)
                ops.append(["bas", i])
        self._envoyer(ops)

    lower = tag_lower

    def _image_changee(self):
        for i, it in self._items.items():
            if isinstance(it["opts"].get("image"), Image) or it["opts"].get("image") in _images:
                self._maj_item(i)

    def tag_bind(self, tagOrId, sequence=None, func=None, add=None):
        cle = str(tagOrId)
        liaisons = self._liaisons_items.setdefault(cle, {})
        if sequence is None:
            return tuple(liaisons)
        motif = _analyser(sequence)
        lst = liaisons.setdefault(motif, [])
        if not add:
            lst.clear()
        if func is not None:
            lst.append(func)
        _maj_ecoute(self)
        return f"{id(func)}"

    def tag_unbind(self, tagOrId, sequence, funcid=None):
        self._liaisons_items.get(str(tagOrId), {}).pop(_analyser(sequence), None)

    def _evenement_item(self, d, ev, e):
        i = d.get("item")
        self._courant = int(i) if i is not None else None  # « current » : rien sous la souris → aucun élément
        if i is None or int(i) not in self._items:
            return None
        i = int(i)
        cles = [str(i)] + list(self._items[i]["tags"]) + ["all"]
        for cle in cles:
            liaisons = self._liaisons_items.get(cle)
            if liaisons:
                for fn in list(_choisir(liaisons, ev)):
                    e.widget = self
                    _appeler(fn, e)
        return None

    def _survol_item(self, d, type_, commun):
        i = d.get("item")
        if i is None or int(i) not in self._items:
            return
        i = int(i)
        self._courant = i if type_ == "mouseover" else self._courant
        tk_type = "Enter" if type_ == "mouseover" else "Leave"
        for cle in [str(i)] + list(self._items[i]["tags"]):
            liaisons = self._liaisons_items.get(cle)
            if liaisons:
                for fn in list(_choisir(liaisons, {"type": tk_type, "detail": None, "mods": set()})):
                    _appeler(fn, Event(type=getattr(EventType, tk_type), widget=self, **commun))

    # — défilement (scrollregion) : la page fait défiler le canvas, ces méthodes le pilotent —
    def _vers_canvas(self, v, axe, grille):
        d = _py(_ui.lire(self._id, "decalage")) or [0, 0]
        z = self._zone() or [0, 0, 0, 0]
        r = float(v) + float(d[axe]) + z[axe]
        if grille:
            r = round(r / float(grille)) * float(grille)
        return r

    def canvasx(self, screenx, gridspacing=None):
        return self._vers_canvas(screenx, 0, gridspacing)

    def canvasy(self, screeny, gridspacing=None):
        return self._vers_canvas(screeny, 1, gridspacing)

    def _vue(self, axe, args):
        if not args:
            return tuple(float(x) for x in (_py(_ui.lire(self._id, "vueX" if axe == 0 else "vue")) or [0.0, 1.0]))
        if args[0] == "moveto":
            _ui.ecrire(self._id, "defilerX" if axe == 0 else "defiler", float(args[1]))
        elif args[0] == "scroll":
            self._defiler(axe, args[1], args[2] if len(args) > 2 else "units")
        return None

    def _defiler(self, axe, nombre, quoi):
        debut, fin = self._vue(axe, ())
        z = self._zone()
        etendue = (z[2] - z[0]) if z and axe == 0 else (z[3] - z[1]) if z else 0
        inc = float(_pixels(self._o.get("xscrollincrement" if axe == 0 else "yscrollincrement", 0)) or 0)
        if str(quoi).startswith("p"):
            pas = 0.9 * (fin - debut)
        else:
            pas = inc / etendue if inc and etendue else 0.1 * (fin - debut)  # Tk : 1/10 de la fenêtre
        _ui.ecrire(self._id, "defilerX" if axe == 0 else "defiler", min(1.0, max(0.0, debut + int(nombre) * pas)))

    def xview(self, *args):
        return self._vue(0, args)

    def yview(self, *args):
        return self._vue(1, args)

    def xview_moveto(self, fraction):
        self._vue(0, ("moveto", fraction))

    def yview_moveto(self, fraction):
        self._vue(1, ("moveto", fraction))

    def xview_scroll(self, number, what):
        self._defiler(0, number, what)

    def yview_scroll(self, number, what):
        self._defiler(1, number, what)

    def scan_mark(self, x, y):
        pass

    def scan_dragto(self, x, y, gain=10):
        pass

    def postscript(self, cnf={}, **kw):
        return ""

    def focus(self, *args):
        return ""

    def icursor(self, *args):
        pass

    def dchars(self, *args):
        pass

    def insert(self, *args):
        pass

    def index(self, *args):
        return 0

    def select_clear(self):
        pass

    def tag_configure(self, *a, **k):
        pass

    def delete_all(self):
        self.delete("all")

    def _recevoir(self, type_, d):
        if type_ == "defilement":
            for cle, a, b in (("yscrollcommand", "debut", "fin"), ("xscrollcommand", "debutX", "finX")):
                cmd = self._o.get(cle)
                if cmd:
                    _appeler(cmd, str(d.get(a, 0)), str(d.get(b, 1)))
            return None
        return super()._recevoir(type_, d)


# Fonctions et classes de compatibilité
class CallWrapper:
    def __init__(self, func, subst, widget):
        self.func = func

    def __call__(self, *args):
        return self.func(*args)


def _setit(var, value, callback=None):
    def f(*args):
        var.set(value)
        if callback:
            callback(value, *args)

    return f


class Studbutton(Button):
    pass


class Tributton(Button):
    pass


from tkinter import font as _font_mod  # noqa: E402

Font = _font_mod.Font
_polices_nommees = _font_mod._nommees

import types as _types  # noqa: E402

__all__ = [n for n, o in globals().items() if not n.startswith("_") and not isinstance(o, _types.ModuleType) and n not in ("wantobjects", "create_once_callable", "create_proxy", "to_js")]
`;
