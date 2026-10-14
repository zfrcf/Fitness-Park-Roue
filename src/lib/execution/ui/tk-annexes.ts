/**
 * Sous-modules de `tkinter` pour la console du navigateur : constants, font, ttk, messagebox,
 * simpledialog, filedialog, colorchooser, scrolledtext, commondialog, dialog.
 */

export const TK_CONSTANTS = String.raw`
NO = FALSE = OFF = 0
YES = TRUE = ON = 1
N = "n"; S = "s"; W = "w"; E = "e"
NW = "nw"; SW = "sw"; NE = "ne"; SE = "se"
NS = "ns"; EW = "ew"; NSEW = "nsew"
CENTER = "center"
NONE = "none"; X = "x"; Y = "y"; BOTH = "both"
LEFT = "left"; TOP = "top"; RIGHT = "right"; BOTTOM = "bottom"
RAISED = "raised"; SUNKEN = "sunken"; FLAT = "flat"; RIDGE = "ridge"; GROOVE = "groove"; SOLID = "solid"
HORIZONTAL = "horizontal"; VERTICAL = "vertical"
NUMERIC = "numeric"
CHAR = "char"; WORD = "word"
BASELINE = "baseline"
INSIDE = "inside"; OUTSIDE = "outside"
SEL = "sel"; SEL_FIRST = "sel.first"; SEL_LAST = "sel.last"
END = "end"; INSERT = "insert"; CURRENT = "current"; ANCHOR = "anchor"; ALL = "all"
NORMAL = "normal"; DISABLED = "disabled"; ACTIVE = "active"; HIDDEN = "hidden"
CASCADE = "cascade"; CHECKBUTTON = "checkbutton"; COMMAND = "command"; RADIOBUTTON = "radiobutton"; SEPARATOR = "separator"
SINGLE = "single"; BROWSE = "browse"; MULTIPLE = "multiple"; EXTENDED = "extended"
DOTBOX = "dotbox"; UNDERLINE = "underline"
PIESLICE = "pieslice"; CHORD = "chord"; ARC = "arc"; FIRST = "first"; LAST = "last"
BUTT = "butt"; PROJECTING = "projecting"; ROUND = "round"; BEVEL = "bevel"; MITER = "miter"
MOVETO = "moveto"; SCROLL = "scroll"; UNITS = "units"; PAGES = "pages"
`;

export const TK_FONT = String.raw`
"""tkinter.font"""
import itertools

import atelier_ui as _ui

NORMAL = "normal"
ROMAN = "roman"
BOLD = "bold"
ITALIC = "italic"

_nommees = {}
_n = itertools.count(1)


def nametofont(name, root=None):
    if name not in _nommees:
        Font(name=name, family="TkFixedFont" if "fixed" in name.lower() else "TkDefaultFont", size=10)
    return _nommees[name]


class Font:
    def __init__(self, root=None, font=None, name=None, exists=False, **options):
        import tkinter

        if font is not None:
            fam, taille, styles = tkinter._decomposer_police(font)
            options.setdefault("family", fam)
            options.setdefault("size", taille)
            options.setdefault("weight", "bold" if "bold" in styles else "normal")
            options.setdefault("slant", "italic" if "italic" in styles else "roman")
            options.setdefault("underline", 1 if "underline" in styles else 0)
            options.setdefault("overstrike", 1 if "overstrike" in styles else 0)
        self.name = name or f"font{next(_n)}"
        self._famille = str(options.get("family", "TkDefaultFont"))
        self._taille = int(options.get("size", 10))
        self._poids = str(options.get("weight", "normal"))
        self._pente = str(options.get("slant", "roman"))
        self._souligne = int(bool(options.get("underline", 0)))
        self._barre = int(bool(options.get("overstrike", 0)))
        self._utilisateurs = []
        _nommees[self.name] = self

    def _styles(self):
        out = []
        if self._poids == "bold":
            out.append("bold")
        if self._pente == "italic":
            out.append("italic")
        return out

    def _css(self):
        import tkinter

        return tkinter._css_police(self._famille, self._taille, self._styles())

    def __str__(self):
        return self.name

    def __eq__(self, other):
        return isinstance(other, Font) and self.actual() == other.actual()

    def __hash__(self):
        return id(self)

    def actual(self, option=None, displayof=None):
        d = {"family": self._famille, "size": self._taille, "weight": self._poids, "slant": self._pente, "underline": self._souligne, "overstrike": self._barre}
        return d[option] if option else d

    def cget(self, option):
        return self.actual(option)

    __getitem__ = cget

    def configure(self, **options):
        if not options:
            return self.actual()
        for k, v in options.items():
            if k == "family":
                self._famille = str(v)
            elif k == "size":
                self._taille = int(v)
            elif k == "weight":
                self._poids = str(v)
            elif k == "slant":
                self._pente = str(v)
            elif k == "underline":
                self._souligne = int(bool(v))
            elif k == "overstrike":
                self._barre = int(bool(v))
        import tkinter

        for w in list(self._utilisateurs):
            if not w._detruit:
                _ui.configurer(w._id, tkinter._js({"police": self._css()}))

    config = configure

    def __setitem__(self, k, v):
        self.configure(**{k: v})

    def copy(self):
        return Font(**self.actual())

    def measure(self, text, displayof=None):
        px = abs(self._taille) * 4 / 3 if self._taille > 0 else abs(self._taille)
        return int(len(str(text)) * px * (0.62 if self._poids == "bold" else 0.56))

    def metrics(self, *options, **kw):
        px = abs(self._taille) * 4 / 3 if self._taille > 0 else abs(self._taille)
        d = {"ascent": int(px * 0.92), "descent": int(px * 0.24), "linespace": int(px * 1.3), "fixed": int(self._famille.lower() in ("courier", "courier new", "consolas", "tkfixedfont"))}
        if len(options) == 1:
            return d[options[0].lstrip("-")]
        return d


def families(root=None, displayof=None):
    return ("Arial", "Calibri", "Cambria", "Comic Sans MS", "Consolas", "Courier", "Courier New", "Georgia", "Helvetica", "Impact", "Segoe UI", "Tahoma", "Times", "Times New Roman", "Trebuchet MS", "Verdana")


def names(root=None):
    return tuple(_nommees)
`;

export const TK_TTK = String.raw`
"""tkinter.ttk : widgets « thémés », dessinés par le même moteur que tkinter."""
import tkinter
from tkinter import TclError, _appeler, _choisir, _js, _pixels, _py, _tout, _ui, _virtuel

__all__ = ["Button", "Checkbutton", "Combobox", "Entry", "Frame", "Label", "Labelframe", "LabelFrame", "Menubutton", "Notebook", "Panedwindow", "PanedWindow", "Progressbar", "Radiobutton", "Scale", "Scrollbar", "Separator", "Sizegrip", "Spinbox", "Style", "Treeview", "LabeledScale", "OptionMenu", "tclobjs_to_py", "setup_master"]

_styles = {}
_themes = ["vista", "clam", "alt", "default", "classic", "winnative", "xpnative"]
_theme = ["vista"]


def tclobjs_to_py(adict):
    return adict


def setup_master(master=None):
    return master or tkinter._racine_defaut()


def _vrai(v):
    try:
        return tkinter.getboolean(v)
    except TclError:
        return bool(v)


def _liste_tcl(v):
    """Valeurs d'un élément : un tuple / une liste, ou une chaîne lue comme une liste Tcl (« a {b c} d »)."""
    if isinstance(v, (list, tuple)):
        return [tkinter._chaine_tcl(x) for x in v]
    if v in (None, ""):
        return []
    import re

    return [g[0] if g[0] else g[1] for g in re.findall(r"\{([^}]*)\}|(\S+)", str(v))]


def _convertir(v):
    """Comme ttk : une valeur lue en dictionnaire devient un entier si elle en a l'air (« 007 » → 7)."""
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return v


class Style:
    def __init__(self, master=None):
        self.master = master

    def configure(self, style, query_opt=None, **kw):
        if query_opt is not None:
            return _styles.get(style, {}).get(query_opt, "")
        if not kw:
            return dict(_styles.get(style, {}))
        _styles.setdefault(style, {}).update(kw)
        for w in list(tkinter._widgets.values()):
            if isinstance(w, _Theme) and not w._detruit and style in w._chaine_style():
                w._appliquer_style()
        return None

    def map(self, style, query_opt=None, **kw):
        return {} if query_opt is None else []

    def lookup(self, style, option, state=None, default=None):
        return _styles.get(style, {}).get(option, default if default is not None else "")

    def layout(self, style, layoutspec=None):
        return []

    def element_create(self, elementname, etype, *args, **kw):
        pass

    def element_names(self):
        return ()

    def element_options(self, elementname):
        return ()

    def theme_create(self, themename, parent=None, settings=None):
        _themes.append(themename)

    def theme_settings(self, themename, settings):
        pass

    def theme_names(self):
        return tuple(_themes)

    def theme_use(self, themename=None):
        if themename is None:
            return _theme[0]
        _theme[0] = themename


# Options de style ttk → options de widget
_OPTIONS_STYLE = {"font": "font", "foreground": "foreground", "background": "background", "padding": "padding", "relief": "relief", "borderwidth": "borderwidth", "anchor": "anchor", "justify": "justify", "wraplength": "wraplength", "width": "width", "fieldbackground": "background"}


class _Theme:
    _style_defaut = "."
    _champ = False

    def __init__(self, master=None, cnf={}, **kw):
        o = {**cnf, **kw}
        self._explicites = {self._alias.get(k, k) for k in o}
        self._etats = set()
        defauts = self._options_style(o.get("style"))
        super().__init__(master, {**defauts, **cnf}, **kw)

    def _chaine_style(self):
        nom = str(self._o.get("style") or "") if hasattr(self, "_o") else ""
        chaine = [".", self._style_defaut]
        if nom:
            parties = nom.split(".")
            for i in range(len(parties) - 1, -1, -1):
                chaine.append(".".join(parties[i:]))
        return chaine

    def _options_style(self, style=None):
        nom = str(style or "")
        chaine = [".", self._style_defaut]
        if nom:
            parties = nom.split(".")
            for i in range(len(parties) - 1, -1, -1):
                chaine.append(".".join(parties[i:]))
        out = {}
        for s in chaine:
            for k, v in _styles.get(s, {}).items():
                cle = _OPTIONS_STYLE.get(k)
                if cle == "background" and k == "background" and self._champ:
                    continue
                if cle == "background" and k == "fieldbackground" and not self._champ:
                    continue
                if cle:
                    out[cle] = v
        return out

    def _appliquer_style(self):
        o = {k: v for k, v in self._options_style(self._o.get("style")).items() if k not in self._explicites}
        if o:
            tkinter._Base._appliquer(self, o)

    def configure(self, cnf=None, **kw):
        if isinstance(cnf, dict) or kw:
            self._explicites |= {self._alias.get(k, k) for k in {**(cnf if isinstance(cnf, dict) else {}), **kw}}
        r = super().configure(cnf, **kw)
        if "style" in kw:
            self._appliquer_style()
        return r

    config = configure

    def _etats_effectifs(self):
        """États ttk ; « selected » d'une case / d'un bouton radio suit sa variable."""
        e = set(self._etats)
        if hasattr(self, "_coche") and hasattr(self, "_var"):
            e.discard("selected")
            if self._coche():
                e.add("selected")
        return e

    def state(self, statespec=None):
        if statespec is None:
            return tuple(self._etats_effectifs())
        avant = tuple(self._etats_effectifs())
        for s in ([statespec] if isinstance(statespec, str) else statespec):
            for x in str(s).split():
                nom = x.lstrip("!")
                if nom == "selected" and hasattr(self, "_coche") and hasattr(self, "_var"):
                    (self.deselect if x.startswith("!") else self.select)()
                elif x.startswith("!"):
                    self._etats.discard(nom)
                else:
                    self._etats.add(nom)
        etat = "disabled" if "disabled" in self._etats else "readonly" if "readonly" in self._etats else "normal"
        tkinter._Base._appliquer(self, {"state": etat})
        return avant

    def instate(self, statespec, callback=None, *args, **kw):
        ok = True
        etats = self._etats_effectifs()
        for s in ([statespec] if isinstance(statespec, str) else statespec):
            for x in str(s).split():
                ok = ok and ((x[1:] not in etats) if x.startswith("!") else (x in etats))
        if ok and callback:
            return callback(*args, **kw)
        return ok

    def identify(self, x, y):
        return ""


class Button(_Theme, tkinter.Button):
    _style_defaut = "TButton"
    _classe_tk = "TButton"


class Label(_Theme, tkinter.Label):
    _style_defaut = "TLabel"
    _classe_tk = "TLabel"


class Entry(_Theme, tkinter.Entry):
    _style_defaut = "TEntry"
    _classe_tk = "TEntry"
    _champ = True


class Frame(_Theme, tkinter.Frame):
    _style_defaut = "TFrame"
    _classe_tk = "TFrame"


class LabelFrame(_Theme, tkinter.LabelFrame):
    _style_defaut = "TLabelframe"
    _classe_tk = "TLabelframe"


Labelframe = LabelFrame


class Checkbutton(_Theme, tkinter.Checkbutton):
    _style_defaut = "TCheckbutton"
    _classe_tk = "TCheckbutton"


class Radiobutton(_Theme, tkinter.Radiobutton):
    _style_defaut = "TRadiobutton"
    _classe_tk = "TRadiobutton"


class Scale(_Theme, tkinter.Scale):
    _style_defaut = "Horizontal.TScale"
    _classe_tk = "TScale"
    _defauts = {"from": 0, "to": 1.0, "orient": "horizontal", "resolution": 0, "showvalue": 0, "length": 100}

    def _preparer(self, o):
        if "value" in o:
            self._val = float(o["value"])
        super()._preparer(o)
        if "value" in o and o.get("variable") is None:
            self._val = float(o["value"])

    def get(self, x=None, y=None):
        return float(self._val)

    def _nombre(self, v):
        return float(v)

    def _traduire(self, o):
        if "value" in o:
            self._val = float(o["value"])
        return super()._traduire(o)


class Spinbox(_Theme, tkinter.Spinbox):
    _style_defaut = "TSpinbox"
    _classe_tk = "TSpinbox"
    _champ = True


class Scrollbar(_Theme, tkinter.Scrollbar):
    _style_defaut = "TScrollbar"
    _classe_tk = "TScrollbar"


class Menubutton(_Theme, tkinter.Menubutton):
    _style_defaut = "TMenubutton"
    _classe_tk = "TMenubutton"


class Separator(_Theme, tkinter.Widget):
    _type_js = "separator"
    _style_defaut = "TSeparator"
    _classe_tk = "TSeparator"
    _defauts = {"orient": "horizontal"}

    def _traduire(self, o):
        j = super()._traduire(o)
        if "orient" in o:
            j["orient"] = str(o["orient"])
        return j


class Sizegrip(_Theme, tkinter.Widget):
    _type_js = "scrollbar"
    _style_defaut = "TSizegrip"
    _classe_tk = "TSizegrip"


class Panedwindow(_Theme, tkinter.PanedWindow):
    _style_defaut = "TPanedwindow"
    _classe_tk = "TPanedwindow"

    def insert(self, pos, child, **kw):
        self.add(child, **kw)

    def pane(self, pane, option=None, **kw):
        return {}


PanedWindow = Panedwindow


class Progressbar(_Theme, tkinter.Widget):
    _type_js = "progressbar"
    _style_defaut = "Horizontal.TProgressbar"
    _classe_tk = "TProgressbar"
    _unite = "px"
    _defauts = {"orient": "horizontal", "length": 100, "mode": "determinate", "maximum": 100, "value": 0}

    def _preparer(self, o):
        self._minuterie = None
        var = o.get("variable")
        if var is not None:
            var._lier(self)
            try:
                self._o["value"] = float(var.get())
            except Exception:
                pass

    def _traduire(self, o):
        j = super()._traduire(o)
        j.pop("dimensions", None)
        if "maximum" in o:
            j["maximum"] = float(o["maximum"])
        if "value" in o:
            j["valeur"] = float(o["value"] or 0)
        if "length" in o:
            j["longueur"] = _pixels(o["length"])
        if "orient" in o:
            j["orient"] = str(o["orient"])
        if "variable" in o and o["variable"] is not None:
            o["variable"]._lier(self)
            j["valeur"] = float(o["variable"].get() or 0)
        return j

    def _variable_changee(self, var):
        if var is self._o.get("variable"):
            try:
                self._o["value"] = float(var._valeur or 0)
            except (TypeError, ValueError):
                return
            _ui.configurer(self._id, _js({"valeur": self._o["value"]}))

    def step(self, amount=1.0):
        m = float(self._o.get("maximum", 100)) or 100
        v = (float(self._o.get("value", 0) or 0) + float(amount)) % m
        self.configure(value=v)
        var = self._o.get("variable")
        if var is not None:
            var._valeur = v

    def start(self, interval=None):
        self.stop()
        if str(self._o.get("mode")) == "indeterminate":
            _ui.configurer(self._id, _js({"indetermine": True}))
            self._minuterie = "indetermine"
            return

        def tic():
            self.step(1)
            self._minuterie = self.after(int(interval or 50), tic)

        self._minuterie = self.after(int(interval or 50), tic)

    def stop(self):
        if self._minuterie == "indetermine":
            _ui.configurer(self._id, _js({"indetermine": False, "valeur": float(self._o.get("value", 0) or 0)}))
        elif self._minuterie:
            self.after_cancel(self._minuterie)
        self._minuterie = None


class Combobox(_Theme, tkinter.Entry):
    _type_js = "combobox"
    _style_defaut = "TCombobox"
    _classe_tk = "TCombobox"
    _champ = True
    _defauts = {"width": 20}

    def _liste(self):
        v = self._o.get("values") or ()
        return [str(x) for x in (v if isinstance(v, (list, tuple)) else str(v).split())]

    def _traduire(self, o):
        j = super()._traduire(o)
        if "values" in o:
            j["valeurs"] = self._liste()
        return j

    def current(self, newindex=None):
        if newindex is None:
            v = self.get()
            l = self._liste()
            return l.index(v) if v in l else -1
        l = self._liste()
        i = int(newindex)
        if not 0 <= i < len(l):
            raise TclError(f"index {newindex} out of range")
        self.set(l[i])

    def set(self, value):
        self._ecrire(str(value))

    def _recevoir(self, type_, d):
        if type_ == "valeur":
            self._saisie(str(d.get("valeur", "")))
            return None
        if type_ == "commande":
            v = str(d.get("valeur", ""))
            self._saisie(v)
            if v in self._liste():
                _virtuel(self, "<<ComboboxSelected>>")
            return None
        if type_ == "ouvrir":
            pc = self._o.get("postcommand")
            if pc:
                _appeler(pc)  # peut changer « values » avant l'affichage de la liste
            return None
        return super()._recevoir(type_, d)


class Notebook(_Theme, tkinter.Widget):
    _type_js = "notebook"
    _style_defaut = "TNotebook"
    _classe_tk = "TNotebook"
    _unite = "px"

    def _preparer(self, o):
        self._onglets = []
        self._actif = None

    def _envoyer(self):
        liste = [{"id": t["w"]._id, "texte": str(t.get("text", "")), "etat": str(t.get("state", "normal"))} for t in self._onglets if t.get("state") != "hidden"]
        _ui.configurer(self._id, _js({"onglets": {"liste": liste, "actif": self._actif._id if self._actif is not None else -1}}))

    def _w(self, tab_id):
        if isinstance(tab_id, tkinter.Misc):
            return tab_id
        if tab_id in ("current",):
            return self._actif
        if isinstance(tab_id, int) or str(tab_id).isdigit():
            return self._onglets[int(tab_id)]["w"]
        return self.nametowidget(tab_id)

    def add(self, child, **kw):
        for t in self._onglets:
            if t["w"] is child:
                if t.get("state") == "hidden" and "state" not in kw:
                    t["state"] = "normal"  # comme Tk : add() réaffiche un onglet masqué
                t.update(kw)
                self._envoyer()
                return
        self._onglets.append({"w": child, **kw})
        if self._actif is None:
            self._actif = child
        self._envoyer()

    def insert(self, pos, child, **kw):
        self._onglets = [t for t in self._onglets if t["w"] is not child]
        i = len(self._onglets) if pos in ("end",) else self.index(pos)
        self._onglets.insert(i, {"w": child, **kw})
        if self._actif is None:
            self._actif = child
        self._envoyer()

    def select(self, tab_id=None):
        if tab_id is None:
            return str(self._actif) if self._actif is not None else ""
        w = self._w(tab_id)
        for t in self._onglets:
            if t["w"] is w and t.get("state") == "hidden":
                t["state"] = "normal"
        if w is not self._actif:
            self._actif = w
            self._envoyer()
            _virtuel(self, "<<NotebookTabChanged>>")

    def index(self, tab_id):
        if tab_id == "end":
            return len(self._onglets)
        w = self._w(tab_id)
        for i, t in enumerate(self._onglets):
            if t["w"] is w:
                return i
        raise TclError(f"{tab_id} is not managed by {self}")

    def tab(self, tab_id, option=None, **kw):
        t = self._onglets[self.index(tab_id)]
        if option is not None:
            return t.get(option, "")
        if not kw:
            return {k: v for k, v in t.items() if k != "w"}
        t.update(kw)
        self._envoyer()

    def tabs(self):
        return tuple(str(t["w"]) for t in self._onglets)

    def forget(self, tab_id):
        w = self._w(tab_id)
        self._onglets = [t for t in self._onglets if t["w"] is not w]
        if self._actif is w:
            self._actif = self._onglets[0]["w"] if self._onglets else None
        self._envoyer()

    def hide(self, tab_id):
        w = self._w(tab_id)
        self.tab(tab_id, state="hidden")
        if self._actif is w:
            visibles = [t["w"] for t in self._onglets if t.get("state") != "hidden"]
            self._actif = visibles[0] if visibles else None
            self._envoyer()
            if self._actif is not None:
                _virtuel(self, "<<NotebookTabChanged>>")

    def enable_traversal(self):
        pass

    def _recevoir(self, type_, d):
        if type_ == "onglet":
            w = tkinter._widgets.get(int(d.get("id", 0)))
            if w is not None:
                self.select(w)
            return None
        return super()._recevoir(type_, d)


def _tags(v):
    if v in (None, ""):
        return []
    return [str(x) for x in (v if isinstance(v, (list, tuple)) else str(v).split())]


class Treeview(_Theme, tkinter.Widget):
    _type_js = "treeview"
    _style_defaut = "Treeview"
    _classe_tk = "Treeview"
    _unite = "px"
    _defauts = {"height": 10, "show": "tree headings", "columns": (), "selectmode": "extended"}

    def _preparer(self, o):
        self._items = {"": {"text": "", "values": [], "open": True, "tags": [], "children": [], "parent": None, "image": ""}}
        self._n = 0
        self._entetes = {}
        self._cols = {}
        self._sel = []
        self._focus = ""
        self._ancre = ""
        self._styles_tags = {}
        self._opts_tags = {}
        self._liaisons_items = {}
        self._planifie = False
        self._affiche = []
        self._a_voir = None

    def _traduire(self, o):
        j = super()._traduire(o)
        j.pop("dimensions", None)
        if "height" in o:
            j["hauteurLignes"] = int(o["height"] or 10)
        if "columns" in o or "show" in o or "displaycolumns" in o:
            self._planifier()
        return j

    def _it(self, item):
        iid = str(item)
        if iid not in self._items:
            raise TclError(f"Item {item} not found")
        return self._items[iid]

    def _colonnes(self):
        c = self._o.get("columns") or ()
        return [str(x) for x in (c if isinstance(c, (list, tuple)) else str(c).split())]

    def _affichees(self):
        d = self._o.get("displaycolumns", "#all")
        tous = self._colonnes()
        if d in ("#all", None, "") or d == ("#all",):
            return tous
        out = []
        for x in (d if isinstance(d, (list, tuple)) else str(d).split()):
            out.append(tous[x] if isinstance(x, int) else str(x))
        return out

    def _show(self):
        s = self._o.get("show", "tree headings")
        return s if isinstance(s, str) else " ".join(s)

    def _nom_colonne(self, column):
        """« #0 », « #n » (n-ième colonne affichée), indice ou identifiant → identifiant de colonne."""
        c = str(column)
        if c == "#0":
            return "#0"
        if c.startswith("#") and c[1:].isdigit():
            aff = self._affichees()
            n = int(c[1:])
            if 1 <= n <= len(aff):
                return aff[n - 1]
        elif isinstance(column, int) and 0 <= column < len(self._colonnes()):
            return self._colonnes()[column]
        if c in self._colonnes():
            return c
        raise TclError(f"Invalid column index {column}")

    def _planifier(self):
        if self._planifie:
            return
        self._planifie = True
        js.queueMicrotask(create_once_callable(self._envoyer))

    def _vider(self):
        """Dessine tout de suite ce qui attend (avant une mesure dans la page)."""
        if self._planifie:
            self._envoyer()

    def _hauteur_ligne(self):
        h = None
        for st in self._chaine_style():
            if "rowheight" in _styles.get(st, {}):
                h = _styles[st]["rowheight"]
        return int(_pixels(h)) if h else 22

    def _envoyer(self):
        if not self._planifie:
            return
        self._planifie = False
        if self._detruit:
            return
        arbre = "tree" in self._show()

        def desc(c):
            co, en = self._cols.get(c, {}), self._entetes.get(c, {})
            return {"id": c, "titre": str(en.get("text", "")), "largeur": int(_pixels(co.get("width", 200))), "ancre": str(co.get("anchor", "w")),
                    "ancreTitre": str(en.get("anchor", "center")), "etire": _vrai(co.get("stretch", True))}

        cols = ([desc("#0")] if arbre else []) + [desc(c) for c in self._affichees()]
        tous = self._colonnes()
        affichees = self._affichees()
        lignes = []

        def parcourir(iid, niveau):
            for enfant in self._items[iid]["children"]:
                it = self._items[enfant]
                cellules = [it["text"]] if arbre else []
                for c in affichees:
                    k = tous.index(c) if c in tous else -1
                    cellules.append(it["values"][k] if 0 <= k < len(it["values"]) else "")
                ligne = {"iid": enfant, "cellules": [str(x) for x in cellules], "niveau": niveau, "aEnfants": bool(it["children"]), "ouvert": bool(it["open"])}
                for t in it["tags"]:
                    ligne.update(self._styles_tags.get(t, {}))
                lignes.append(ligne)
                if it["open"] and arbre:
                    parcourir(enfant, niveau + 1)

        parcourir("", 0)
        self._affiche = [l["iid"] for l in lignes]
        _ui.configurer(self._id, _js({"arbre": {"colonnes": cols, "lignes": lignes, "selection": list(self._sel), "focus": self._focus, "arbre": arbre,
                                                "entetes": "headings" in self._show(), "hauteurLigne": self._hauteur_ligne(), "voir": self._a_voir}}))
        self._a_voir = None

    def insert(self, parent, index, iid=None, **kw):
        parent = str(parent)
        self._it(parent)
        if iid is None or iid == "":
            self._n += 1
            iid = f"I{self._n:03X}"
            while iid in self._items:
                self._n += 1
                iid = f"I{self._n:03X}"
        iid = str(iid)
        if iid in self._items:
            raise TclError(f"Item {iid} already exists")
        self._items[iid] = {"text": str(kw.get("text", "")), "values": _liste_tcl(kw.get("values", ())), "open": _vrai(kw.get("open", False)),
                            "tags": _tags(kw.get("tags")), "children": [], "parent": parent, "image": kw.get("image", "")}
        enfants = self._items[parent]["children"]
        pos = len(enfants) if str(index) == "end" else max(0, min(len(enfants), int(index)))
        enfants.insert(pos, iid)
        self._planifier()
        return iid

    def item(self, item, option=None, **kw):
        it = self._it(item)
        if option is not None and not kw:
            option = str(option).lstrip("-")
            if option in ("values", "tags"):
                return tuple(it[option]) if it[option] else ""
            if option == "open":
                return int(it["open"])
            if option in ("text", "image"):
                return it[option] or ""
            raise TclError(f'unknown option "-{option}"')
        if not kw:
            return {"text": it["text"], "image": it["image"] or "", "values": [_convertir(x) for x in it["values"]] if it["values"] else "",
                    "open": int(it["open"]), "tags": [_convertir(x) for x in it["tags"]] if it["tags"] else ""}
        for k, v in kw.items():
            if k == "values":
                it["values"] = _liste_tcl(v)
            elif k == "tags":
                it["tags"] = _tags(v)
            elif k == "open":
                it["open"] = _vrai(v)
            elif k in ("text", "image"):
                it[k] = str(v) if k == "text" else v
        self._planifier()

    def get_children(self, item=None):
        return tuple(self._it(item or "")["children"])

    def set_children(self, item, *newchildren):
        it = self._it(item or "")
        nouveaux = [str(c) for c in newchildren]
        for c in it["children"]:
            self._items[c]["parent"] = None
        for c in nouveaux:
            self._it(c)
            self._retirer(c)
            self._items[c]["parent"] = str(item or "")
        it["children"] = nouveaux
        self._planifier()

    def _retirer(self, iid):
        p = self._items[iid]["parent"]
        if p is not None and iid in self._items.get(p, {}).get("children", []):
            self._items[p]["children"].remove(iid)

    def delete(self, *items):
        avant = list(self._sel)
        for item in items:
            for iid in (item if isinstance(item, (list, tuple)) else [item]):
                iid = str(iid)
                if iid == "":
                    continue
                self._it(iid)
                self._retirer(iid)
                pile = [iid]
                while pile:
                    x = pile.pop()
                    pile.extend(self._items[x]["children"])
                    self._items.pop(x, None)
                    if x in self._sel:
                        self._sel.remove(x)
        if self._focus not in self._items:
            self._focus = ""
        self._planifier()
        if self._sel != avant:
            _virtuel(self, "<<TreeviewSelect>>")

    def detach(self, *items):
        for iid in self._aplatir(items):
            self._retirer(iid)
            self._items[iid]["parent"] = None
        self._planifier()

    def move(self, item, parent, index):
        item, parent = str(item), str(parent)
        self._it(item)
        self._it(parent)
        self._retirer(item)
        enfants = self._items[parent]["children"]
        pos = len(enfants) if str(index) == "end" else max(0, min(len(enfants), int(index)))
        enfants.insert(pos, item)
        self._items[item]["parent"] = parent
        self._planifier()

    reattach = move

    def parent(self, item):
        return self._it(item)["parent"] or ""

    def index(self, item):
        p = self.parent(item)
        return self._items[p]["children"].index(str(item))

    def next(self, item):
        p = self._items[self.parent(item)]["children"]
        i = p.index(str(item))
        return p[i + 1] if i + 1 < len(p) else ""

    def prev(self, item):
        p = self._items[self.parent(item)]["children"]
        i = p.index(str(item))
        return p[i - 1] if i > 0 else ""

    def exists(self, item):
        return str(item) in self._items

    def focus(self, item=None):
        if item is None:
            return self._focus
        self._it(item)
        self._focus = str(item)
        self._planifier()

    def selection(self, selop=None, items=None):
        if selop is not None:
            getattr(self, f"selection_{selop}")(items)
            return None
        return tuple(self._sel)

    def _aplatir(self, items):
        out = []
        for x in items:
            if isinstance(x, (list, tuple)):
                out.extend(self._aplatir(x))
            elif str(x) in self._items or " " not in str(x):
                out.append(str(x))
            else:
                out.extend(str(x).split())
        for x in out:
            self._it(x)
        return out

    def _changer_selection(self, sel):
        if sel != self._sel:
            self._sel = sel
            self._planifier()
            _virtuel(self, "<<TreeviewSelect>>")

    def selection_set(self, *items):
        sel = self._aplatir(items)
        if sel:
            self._focus = self._ancre = sel[-1]
        self._changer_selection(sel)

    def selection_add(self, *items):
        self._changer_selection(self._sel + [x for x in self._aplatir(items) if x not in self._sel])

    def selection_remove(self, *items):
        retires = set(self._aplatir(items))
        self._changer_selection([x for x in self._sel if x not in retires])

    def selection_toggle(self, *items):
        sel = list(self._sel)
        for x in self._aplatir(items):
            sel.remove(x) if x in sel else sel.append(x)
        self._changer_selection(sel)

    def see(self, item):
        p = self.parent(item)
        while p:
            self._items[p]["open"] = True
            p = self.parent(p)
        self._a_voir = str(item)
        self._planifier()

    def set(self, item, column=None, value=None):
        it = self._it(item)
        if column is None:
            return {c: (_convertir(it["values"][k]) if k < len(it["values"]) else "") for k, c in enumerate(self._colonnes())}
        nom = self._nom_colonne(column)
        if nom == "#0":
            raise TclError("Display column #0 cannot be set")
        k = self._colonnes().index(nom)
        if value is None:
            return it["values"][k] if k < len(it["values"]) else ""
        while len(it["values"]) <= k:
            it["values"].append("")
        it["values"][k] = tkinter._chaine_tcl(value)
        self._planifier()

    def heading(self, column, option=None, **kw):
        h = self._entetes.setdefault(self._nom_colonne(column), {})
        defauts = {"text": "", "image": "", "anchor": "center", "command": "", "state": ""}
        if option is not None and not kw:
            return h.get(str(option).lstrip("-"), defauts.get(str(option).lstrip("-"), ""))
        if not kw:
            return {**defauts, **h}
        h.update(kw)
        self._planifier()

    def column(self, column, option=None, **kw):
        nom = self._nom_colonne(column)
        c = self._cols.setdefault(nom, {})
        defauts = {"width": 200, "minwidth": 20, "anchor": "w", "stretch": 1, "id": nom}
        if option is not None and not kw:
            return c.get(str(option).lstrip("-"), defauts.get(str(option).lstrip("-"), ""))
        if not kw:
            return {**defauts, **c}
        c.update(kw)
        self._planifier()

    def tag_configure(self, tagname, option=None, **kw):
        tag = str(tagname)
        brut = self._opts_tags.setdefault(tag, {})
        if option is not None and not kw:
            return brut.get(str(option).lstrip("-"), "")
        if not kw:
            return dict(brut)
        st = self._styles_tags.setdefault(tag, {})
        for k, v in kw.items():
            brut[k] = v
            if k == "background":
                st["fond"] = tkinter._couleur(v)
            elif k == "foreground":
                st["couleur"] = tkinter._couleur(v)
            elif k == "font":
                st["police"] = tkinter._police(v)
        self._planifier()

    tag_config = tag_configure

    def tag_bind(self, tagname, sequence=None, callback=None):
        liaisons = self._liaisons_items.setdefault(str(tagname), {})
        if sequence is None:
            return tuple(liaisons)
        lst = liaisons.setdefault(tkinter._analyser(sequence), [])
        lst.clear()
        if callback is not None:
            lst.append(callback)
        tkinter._maj_ecoute(self)
        return f"{id(callback)}"

    def tag_unbind(self, tagname, sequence, funcid=None):
        self._liaisons_items.get(str(tagname), {}).pop(tkinter._analyser(sequence), None)

    def tag_has(self, tagname, item=None):
        if item is not None:
            return str(tagname) in self._it(item)["tags"]
        return tuple(i for i, it in self._items.items() if i and str(tagname) in it["tags"])

    def _evenement_item(self, d, ev, e):
        """Liaisons de tags (tag_bind) : déclenchées sur la ligne sous la souris."""
        iid = d.get("ligne")
        if iid is None or str(iid) not in self._items:
            return
        for t in self._items[str(iid)]["tags"]:
            liaisons = self._liaisons_items.get(t)
            if liaisons:
                for fn in list(_choisir(liaisons, ev)):
                    e.widget = self
                    _appeler(fn, e)

    def identify_row(self, y):
        self._vider()
        return str(_ui.lire(self._id, "ligneA", int(y)) or "")

    def identify_column(self, x):
        self._vider()
        i = _ui.lire(self._id, "colonneA", int(x))
        i = -1 if i is None else int(i)
        if i < 0:
            return ""
        return f"#{i}" if "tree" in self._show() else f"#{i + 1}"

    def identify_region(self, x, y):
        self._vider()
        return str(_ui.lire(self._id, "regionA", _js([int(x), int(y)])) or "nothing")

    def identify(self, component, x, y):
        if component in ("row", "item"):
            return self.identify_row(y)
        if component == "column":
            return self.identify_column(x)
        return self.identify_region(x, y)

    def identify_element(self, x, y):
        return ""

    def bbox(self, item, column=None):
        self._vider()
        col = None
        if column is not None:
            nom = self._nom_colonne(column)
            col = 0 if nom == "#0" else self._affichees().index(nom) + (1 if "tree" in self._show() else 0)
        b = _py(_ui.lire(self._id, "boiteLigne", _js([str(item), col])))
        return tuple(int(x) for x in b) if b else ""

    def xview(self, *args):
        return (0.0, 1.0)

    def yview(self, *args):
        self._vider()
        if not args:
            return tuple(float(x) for x in (_py(_ui.lire(self._id, "vue")) or [0.0, 1.0]))
        if args[0] == "moveto":
            _ui.ecrire(self._id, "defiler", float(args[1]))

    def yview_moveto(self, fraction):
        self._vider()
        _ui.ecrire(self._id, "defiler", float(fraction))

    def yview_scroll(self, number, what):
        debut, fin = self.yview()
        n = max(1, len(self._affiche))
        pas = (fin - debut) if str(what).startswith("p") else 1 / n
        _ui.ecrire(self._id, "defiler", max(0.0, debut + int(number) * pas))

    xview_moveto = xview_scroll = xview

    def configure(self, cnf=None, **kw):
        r = super().configure(cnf, **kw)
        self._planifier()
        return r

    config = configure

    def _recevoir(self, type_, d):
        if type_ == "selection":
            iid = str(d.get("iid", ""))
            mode = str(self._o.get("selectmode", "extended"))
            if iid not in self._items:
                return None
            self._focus = iid
            if mode == "none":
                sel = list(self._sel)
            elif mode == "browse" or not (d.get("etendre") or d.get("ajouter")):
                sel = [iid]
                self._ancre = iid
            elif d.get("etendre") and self._ancre in self._affiche and iid in self._affiche:
                a, b = sorted((self._affiche.index(self._ancre), self._affiche.index(iid)))
                sel = self._affiche[a:b + 1]
            else:
                sel = [x for x in self._sel if x != iid] if iid in self._sel else self._sel + [iid]
                self._ancre = iid
            self._planifier()
            self._changer_selection(sel)
            return None
        if type_ == "entete":
            cmd = self._entetes.get(str(d.get("colonne", "")), {}).get("command")
            if cmd:
                _appeler(cmd)
            return None
        if type_ == "ouvrir":
            iid = str(d.get("iid", ""))
            if iid in self._items:
                self._focus = iid
                ouvrir = not self._items[iid]["open"]
                # Comme ttk : l'événement part AVANT l'ouverture (chargement des enfants à la demande).
                _virtuel(self, "<<TreeviewOpen>>" if ouvrir else "<<TreeviewClose>>", differe=False)
                if iid in self._items:
                    self._items[iid]["open"] = ouvrir
                self._planifier()
            return None
        return super()._recevoir(type_, d)


class OptionMenu(tkinter.OptionMenu):
    """ttk.OptionMenu(master, variable, default=None, *values) : « default » n'est PAS ajouté à la liste."""

    def __init__(self, master, variable, default=None, *values, **kwargs):
        kwargs.pop("style", None)
        kwargs.pop("direction", None)
        super().__init__(master, variable, *values, **kwargs)
        if default is not None:
            variable.set(default)

    def set_menu(self, default=None, *values):
        self._liste = [str(v) for v in values]
        _ui.configurer(self._id, _js({"valeurs": self._liste}))
        if default is not None:
            self._var.set(default)


class LabeledScale(Frame):
    def __init__(self, master=None, variable=None, from_=0, to=10, **kw):
        super().__init__(master, **kw)
        self._variable = variable or tkinter.IntVar(value=from_)
        self.label = Label(self, textvariable=self._variable)
        self.scale = Scale(self, variable=self._variable, from_=from_, to=to)
        self.label.pack()
        self.scale.pack(fill="x")

    @property
    def value(self):
        return self._variable.get()

    @value.setter
    def value(self, val):
        self._variable.set(val)


import js  # noqa: E402
from pyodide.ffi import create_once_callable  # noqa: E402
`;

export const TK_MESSAGEBOX = String.raw`
"""tkinter.messagebox : boîtes de dialogue du navigateur (alerte, confirmation)."""
import atelier_ui as _ui

ERROR = "error"
INFO = "info"
QUESTION = "question"
WARNING = "warning"
ABORTRETRYIGNORE = "abortretryignore"
OK = "ok"
OKCANCEL = "okcancel"
RETRYCANCEL = "retrycancel"
YESNO = "yesno"
YESNOCANCEL = "yesnocancel"
ABORT = "abort"
RETRY = "retry"
IGNORE = "ignore"
CANCEL = "cancel"
YES = "yes"
NO = "no"


def _texte(title, message, detail=None):
    m = "" if message is None else str(message)
    if detail:
        m += "\n\n" + str(detail)
    return ("" if title is None else str(title)), m


def showinfo(title=None, message=None, **options):
    _ui.alerte(*_texte(title, message, options.get("detail")))
    return OK


def showwarning(title=None, message=None, **options):
    t, m = _texte(title, message, options.get("detail"))
    _ui.alerte("⚠ " + t, m)
    return OK


def showerror(title=None, message=None, **options):
    t, m = _texte(title, message, options.get("detail"))
    _ui.alerte("✖ " + t, m)
    return OK


def askquestion(title=None, message=None, **options):
    if options.get("type") == YESNOCANCEL:
        r = askyesnocancel(title, message, **options)
        return YES if r else CANCEL if r is None else NO
    return YES if _ui.confirmer(*_texte(title, message, options.get("detail"))) else NO


def askokcancel(title=None, message=None, **options):
    return bool(_ui.confirmer(*_texte(title, message, options.get("detail"))))


def askyesno(title=None, message=None, **options):
    return bool(_ui.confirmer(*_texte(title, message, options.get("detail"))))


def askyesnocancel(title=None, message=None, **options):
    """Oui → True, Non → False, Annuler → None (le navigateur n'a que OK / Annuler : deux questions)."""
    t, m = _texte(title, message, options.get("detail"))
    if _ui.confirmer(t, m + "\n\n[OK = Oui · Annuler = autres choix]"):
        return True
    if _ui.confirmer(t, "Répondre « Non » ?\n\n[OK = Non · Annuler = Annuler]"):
        return False
    return None


def askretrycancel(title=None, message=None, **options):
    return bool(_ui.confirmer(*_texte(title, message, options.get("detail"))))


class Message:
    def __init__(self, master=None, **options):
        self.options = options

    def show(self, **options):
        o = {**self.options, **options}
        t = o.get("type", OK)
        if t in (OK,):
            return showinfo(o.get("title"), o.get("message"))
        if t == YESNOCANCEL:
            r = askyesnocancel(o.get("title"), o.get("message"))
            return YES if r else CANCEL if r is None else NO
        if t in (OKCANCEL, RETRYCANCEL):
            ok = askokcancel(o.get("title"), o.get("message"))
            return (OK if t == OKCANCEL else RETRY) if ok else CANCEL
        return YES if askyesno(o.get("title"), o.get("message")) else NO
`;

export const TK_SIMPLEDIALOG = String.raw`
"""tkinter.simpledialog : saisie par la boîte de dialogue du navigateur."""
import atelier_ui as _ui
import tkinter


def _demander(title, prompt, initialvalue):
    r = _ui.demander("" if title is None else str(title), "" if prompt is None else str(prompt), "" if initialvalue is None else str(initialvalue))
    return None if r is None else str(r)


def askstring(title, prompt, initialvalue=None, show=None, parent=None, **kw):
    return _demander(title, prompt, initialvalue)


def _ask_nombre(title, prompt, initialvalue, minvalue, maxvalue, conv, nom):
    valeur = initialvalue
    while True:
        r = _demander(title, prompt, valeur)
        if r is None:
            return None
        try:
            v = conv(r.strip().replace(",", ".") if conv is float else r.strip())
        except ValueError:
            _ui.alerte("Valeur invalide", f"Entrez {nom}.")
            valeur = r
            continue
        if minvalue is not None and v < minvalue:
            _ui.alerte("Valeur trop petite", f"La valeur minimale est {minvalue}.")
            continue
        if maxvalue is not None and v > maxvalue:
            _ui.alerte("Valeur trop grande", f"La valeur maximale est {maxvalue}.")
            continue
        return v


def askinteger(title, prompt, initialvalue=None, minvalue=None, maxvalue=None, parent=None, **kw):
    return _ask_nombre(title, prompt, initialvalue, minvalue, maxvalue, int, "un nombre entier")


def askfloat(title, prompt, initialvalue=None, minvalue=None, maxvalue=None, parent=None, **kw):
    return _ask_nombre(title, prompt, initialvalue, minvalue, maxvalue, float, "un nombre")


class Dialog(tkinter.Toplevel):
    """Boîte personnalisée : comme Tk, le constructeur attend sa fermeture (avec JSPI ; sinon il rend la main)."""

    def __init__(self, parent=None, title=None):
        super().__init__(parent)
        if title:
            self.title(title)
        self.parent = parent
        self.result = None
        corps = tkinter.Frame(self)
        self.initial_focus = self.body(corps)
        corps.pack(padx=5, pady=5)
        self.buttonbox()
        self.bind("<Return>", self.ok)
        self.bind("<Escape>", self.cancel)
        self.protocol("WM_DELETE_WINDOW", self.cancel)
        (self.initial_focus or self).focus_set()
        self.wait_window(self)

    def body(self, master):
        return None

    def buttonbox(self):
        boite = tkinter.Frame(self)
        tkinter.Button(boite, text="OK", width=10, command=self.ok).pack(side="left", padx=5, pady=5)
        tkinter.Button(boite, text="Annuler", width=10, command=self.cancel).pack(side="left", padx=5, pady=5)
        boite.pack()

    def ok(self, event=None):
        if not self.validate():
            (self.initial_focus or self).focus_set()
            return
        self.withdraw()
        self.apply()
        self.cancel()

    def cancel(self, event=None):
        self.destroy()

    def validate(self):
        return 1

    def apply(self):
        pass


class SimpleDialog:
    def __init__(self, master, text="", buttons=[], default=None, cancel=None, title=None, class_=None):
        self._text, self._buttons, self._title = text, buttons, title

    def go(self):
        return 0 if _ui.confirmer(self._title or "", self._text) else (len(self._buttons) - 1 if self._buttons else 0)
`;

export const TK_FILEDIALOG = String.raw`
"""tkinter.filedialog : choix d'un fichier du dossier de la console (fichiers du projet et importés)."""
import os

import atelier_ui as _ui


def _fichiers(filetypes=None):
    motifs = []
    for ft in filetypes or ():
        if isinstance(ft, (list, tuple)) and len(ft) == 2:
            m = ft[1]
            motifs.extend(m if isinstance(m, (list, tuple)) else str(m).split())
    motifs = [m.lower().lstrip("*") for m in motifs if m and m not in ("*", "*.*")]
    out = []
    for racine, dossiers, noms in os.walk(os.getcwd()):
        dossiers[:] = sorted(d for d in dossiers if not d.startswith(".") and d not in ("__pycache__", "node_modules"))
        for n in sorted(noms):
            if not motifs or any(n.lower().endswith(m) for m in motifs):
                out.append(os.path.relpath(os.path.join(racine, n)))
        if len(out) > 40:
            break
    return out


def askopenfilename(**options):
    fichiers = _fichiers(options.get("filetypes"))
    liste = "\n".join(f"  • {f}" for f in fichiers[:25]) or "  (aucun fichier : importez-en avec le bouton « Importer des fichiers » de la console)"
    titre = options.get("title") or "Ouvrir un fichier"
    r = _ui.demander(titre, f"Fichiers disponibles :\n{liste}\n\nNom du fichier à ouvrir :", fichiers[0] if fichiers else "")
    if not r:
        return ""
    r = r.strip()
    return os.path.abspath(r) if os.path.exists(r) else ""


def askopenfilenames(**options):
    r = askopenfilename(**options)
    return (r,) if r else ()


def asksaveasfilename(**options):
    nom = options.get("initialfile") or ""
    ext = options.get("defaultextension") or ""
    titre = options.get("title") or "Enregistrer sous"
    r = _ui.demander(titre, "Nom du fichier à enregistrer (dans le dossier de la console) :", nom)
    if not r:
        return ""
    r = r.strip()
    if ext and not os.path.splitext(r)[1]:
        r += ext if ext.startswith(".") else "." + ext
    return os.path.abspath(r)


def askdirectory(**options):
    return os.getcwd()


def askopenfile(mode="r", **options):
    f = askopenfilename(**options)
    return open(f, mode) if f else None


def askopenfiles(mode="r", **options):
    f = askopenfile(mode, **options)
    return [f] if f else []


def asksaveasfile(mode="w", **options):
    f = asksaveasfilename(**options)
    return open(f, mode) if f else None


class FileDialog:
    def __init__(self, master, title=None):
        self.title = title

    def go(self, *a, **k):
        return askopenfilename(title=self.title)


LoadFileDialog = SaveFileDialog = FileDialog
Open = SaveAs = Directory = FileDialog
`;

export const TK_COLORCHOOSER = String.raw`
"""tkinter.colorchooser : couleur saisie au format #rrggbb."""
import re

import atelier_ui as _ui


def askcolor(color=None, **options):
    r = _ui.demander(options.get("title") or "Choisir une couleur", "Couleur au format #rrggbb (ex. #3a7bd5) :", str(color or "#000000"))
    if not r:
        return (None, None)
    r = r.strip()
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", r):
        return (None, None)
    r = "#" + r.lstrip("#").lower()
    return ((int(r[1:3], 16), int(r[3:5], 16), int(r[5:7], 16)), r)


class Chooser:
    def __init__(self, master=None, **options):
        self.options = options

    def show(self, color=None, **options):
        return askcolor(color, **{**self.options, **options})
`;

export const TK_SCROLLEDTEXT = String.raw`
"""tkinter.scrolledtext : zone de texte avec défilement (natif dans le navigateur)."""
import tkinter

__all__ = ["ScrolledText"]


class ScrolledText(tkinter.Text):
    def __init__(self, master=None, **kw):
        super().__init__(master, **kw)
        self.frame = self
        self.vbar = tkinter.Scrollbar(master)
`;

export const TK_COMMONDIALOG = String.raw`
class Dialog:
    command = None

    def __init__(self, master=None, **options):
        self.master = master
        self.options = options

    def show(self, **options):
        return None
`;

export const TK_DIALOG = String.raw`
import atelier_ui as _ui

DIALOG_ICON = "questhead"


class Dialog:
    def __init__(self, master=None, cnf={}, **kw):
        o = {**cnf, **kw}
        self.num = 0 if _ui.confirmer(str(o.get("title", "")), str(o.get("text", ""))) else 1
`;
