/**
 * Module Python `turtle` de la console du navigateur : la tortue dessine sur un Canvas du tkinter de la
 * console — sa propre fenêtre (Screen) ou le Canvas d'un programme tkinter (TurtleScreen(cv),
 * RawTurtle(cv)) — avec une animation qui suit speed() et tracer(), le mode « logo » et undo().
 * Avec JSPI, l'animation est minutée en Python comme dans CPython (chaque mise à jour redessine la page
 * puis attend delay() ms) ; fermer la fenêtre arrête le programme (turtle.Terminator).
 */
export const TURTLE = String.raw`
"""turtle pour la console Python du navigateur."""
import itertools
import math
import re

import tkinter
from tkinter import _couleur, _js, _ui

__all__ = ["ScrolledCanvas", "TurtleScreen", "Screen", "RawTurtle", "Turtle", "RawPen", "Pen", "Shape", "Vec2D", "Terminator", "TurtleGraphicsError", "write_docstringdict"]


class Terminator(Exception):
    pass


class TurtleGraphicsError(Exception):
    pass


class Vec2D(tuple):
    def __new__(cls, x, y):
        return tuple.__new__(cls, (x, y))

    def __add__(self, o):
        return Vec2D(self[0] + o[0], self[1] + o[1])

    def __sub__(self, o):
        return Vec2D(self[0] - o[0], self[1] - o[1])

    def __mul__(self, o):
        if isinstance(o, Vec2D):
            return self[0] * o[0] + self[1] * o[1]
        return Vec2D(self[0] * o, self[1] * o)

    def __rmul__(self, o):
        return Vec2D(self[0] * o, self[1] * o)

    def __neg__(self):
        return Vec2D(-self[0], -self[1])

    def __abs__(self):
        return math.hypot(*self)

    def rotate(self, angle):
        a = math.radians(angle)
        c, s = math.cos(a), math.sin(a)
        return Vec2D(self[0] * c - self[1] * s, self[0] * s + self[1] * c)

    def __getnewargs__(self):
        return (self[0], self[1])

    def __repr__(self):
        return "(%.2f,%.2f)" % self


_FORMES = {
    "arrow": ((-10, 0), (10, 0), (0, 10)),
    "turtle": ((0, 16), (-2, 14), (-1, 10), (-4, 7), (-7, 9), (-9, 8), (-6, 5), (-7, 1), (-5, -3), (-8, -6), (-6, -8), (-4, -5), (0, -7), (4, -5), (6, -8), (8, -6), (5, -3), (7, 1), (6, 5), (9, 8), (7, 9), (4, 7), (1, 10), (2, 14)),
    "circle": tuple((10 * math.cos(math.radians(a)), 10 * math.sin(math.radians(a))) for a in range(0, 360, 18)),
    "square": ((10, -10), (10, 10), (-10, 10), (-10, -10)),
    "triangle": ((10, -5.77), (0, 11.55), (-10, -5.77)),
    "classic": ((0, 0), (-5, -9), (0, -7), (5, -9)),
    "blank": (),
}


class Shape:
    def __init__(self, type_, data=None):
        self._type = type_
        self._data = data

    def addcomponent(self, poly, fill, outline=None):
        self._data = poly


_VITESSES = {"fastest": 0, "fast": 10, "normal": 6, "slow": 3, "slowest": 1}
_PX_PAR_PAS = {1: 3, 2: 4, 3: 6, 4: 8, 5: 11, 6: 14, 7: 18, 8: 24, 9: 32, 10: 45}

_ecran = [None]
_tortue = [None]
_NUMEROS = itertools.count(1)
_FERMEE = "fenêtre turtle fermée : programme arrêté"
_couleurs_connues = set()


def _couleur_connue(nom):
    """Nom de couleur Tk reconnu par le navigateur (« light blue », « red3 », « gray50 »…)."""
    if str(_ui.rgb(_couleur(nom)) or ""):
        return True
    return not str(_ui.rgb("black") or "")  # navigateur incapable de vérifier : on n'empêche rien


def _chaine_couleur(s):
    """Couleur donnée par un nom ou « #rgb » : refusée comme dans CPython (TurtleGraphicsError) si elle est
    inconnue — « rouge », « #FF000 »… donneraient sinon un trait invisible, sans aucun message."""
    if s == "" or s in _couleurs_connues:
        return s
    if s.startswith("#"):
        ok = re.fullmatch(r"#(?:[0-9a-fA-F]{3}){1,4}", s) is not None
    else:
        ok = re.fullmatch(r"[A-Za-z][A-Za-z0-9 ]*", s) is not None and _couleur_connue(s)
    if not ok:
        raise TurtleGraphicsError(f"bad color string: {s}")
    if len(_couleurs_connues) < 2048:
        _couleurs_connues.add(s)
    return s


def _vers_css(args, mode):
    """Couleur de turtle (nom, « #rrggbb », (r, g, b) selon colormode) → couleur Tk, comme _colorstr de CPython.
    Le nom Tk est gardé tel quel : le Canvas le traduit en CSS une seule fois (« red3 » resterait sinon invisible)."""
    couleur = args[0] if len(args) == 1 else args
    if isinstance(couleur, str):
        return _chaine_couleur(couleur)
    try:
        r, g, b = couleur
    except (TypeError, ValueError):
        raise TurtleGraphicsError(f"bad color arguments: {couleur}") from None
    if mode == 1.0:
        r, g, b = (round(255.0 * float(x)) for x in (r, g, b))
    if not all(0 <= float(x) <= 255 for x in (r, g, b)):
        raise TurtleGraphicsError(f"bad color sequence: {couleur}")
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def _px(v, defaut):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        try:
            return int(tkinter._pixels(v, defaut))
        except Exception:
            return defaut


class ScrolledCanvas(tkinter.Canvas):
    """Zone de dessin de turtle. Dans le navigateur, c'est un Canvas simple (sans barres de défilement) :
    l'origine de la tortue est au centre de la zone visible."""

    def __init__(self, master, width=500, height=350, canvwidth=600, canvheight=500):
        super().__init__(master, width=width, height=height, bg="white", highlightthickness=0)
        self.width, self.height = width, height
        self.canvwidth, self.canvheight = canvwidth, canvheight
        self.bg = "white"
        self._rootwindow = self.winfo_toplevel()
        self._canvas = self

    def reset(self, canvwidth=None, canvheight=None, bg=None):
        if canvwidth:
            self.canvwidth = canvwidth
        if canvheight:
            self.canvheight = canvheight
        if bg:
            self.bg = bg
            self.configure(bg=bg)

    def adjustScrolls(self):
        pass

    def onResize(self, event):
        pass


class TurtleScreen:
    """Écran de la tortue dessiné dans un Canvas tkinter donné (la fenêtre de Screen() ou celle du programme)."""

    _RUNNING = True  # comme CPython : passe à False quand la fenêtre de Screen() se ferme (→ Terminator)

    def __init__(self, cv, mode="standard", colormode=1.0, delay=10):
        if mode not in ("standard", "logo", "world"):
            raise TurtleGraphicsError(f"No turtle-graphics-mode {mode}")
        self.cv = cv
        self._root = cv.winfo_toplevel()
        self._l = max(1, _px(cv.cget("width"), 378))
        self._h = max(1, _px(cv.cget("height"), 265))
        cv._ecran_tortue = self
        self._tracer = 1
        self._compteur = 0  # mises à jour comptées pour tracer(n > 1)
        self._delai = delay
        self._mode = mode
        self._colormode = 1.0 if float(colormode) == 1.0 else 255
        self._monde = None
        self._tortues = []
        self._formes = dict(_FORMES)
        self._bg = cv.cget("background") or "white"
        self._image_fond = None
        self._anime = None
        self._regler_animation()

    # — coordonnées —
    def _vers_canvas(self, x, y):
        if self._monde:
            llx, lly, urx, ury = self._monde
            return ((x - llx) * self._l / (urx - llx), (ury - y) * self._h / (ury - lly))
        return (self._l / 2 + x, self._h / 2 - y)

    def _depuis_canvas(self, x, y):
        if self._monde:
            llx, lly, urx, ury = self._monde
            return (llx + x * (urx - llx) / self._l, ury - y * (ury - lly) / self._h)
        return (x - self._l / 2, self._h / 2 - y)

    def _regler_animation(self):
        """File d'animation du moteur (opérations dessinées par image), utilisée sans JSPI. Quand le programme
        peut attendre le navigateur (JSPI), c'est Python qui donne le rythme (_cadence) : chaque opération est
        dessinée tout de suite."""
        if tkinter._peut_attendre() or self._tracer == 0 or all(t._vitesse == 0 for t in self._tortues if t._visible or t._baisse) and self._tortues:
            n = 0
        else:
            n = 2 * max(1, int(self._tracer or 1))
        if n != self._anime:
            self._anime = n
            _ui.configurer(self.cv._id, _js({"anime": n}))

    def _anime_actif(self):
        return self._anime != 0

    def _verifier(self):
        """Comme _incrementudc de CPython : après la fermeture de la fenêtre de Screen() (croix, bye(), « Fermer
        les fenêtres »), la tortue lève turtle.Terminator, ce qui arrête le programme ; sur le Canvas détruit
        d'un programme tkinter, TclError."""
        if not TurtleScreen._RUNNING:
            TurtleScreen._RUNNING = True
            raise Terminator(_FERMEE)
        if self.cv._detruit:
            if isinstance(self, _Screen):
                raise Terminator(_FERMEE)
            raise tkinter.TclError(f'invalid command name "{self.cv}"')

    def _cadence(self):
        """Fin d'une mise à jour de la tortue, comme _update() + _delay() de CPython. Quand le programme peut
        attendre le navigateur (JSPI) : avec tracer(1), la page se redessine et reçoit les événements (clavier,
        « Arrêter », fermeture) puis le programme attend delay() ms ; avec tracer(n > 1), la page se redessine
        toutes les n mises à jour, sans attente. Python reste ainsi au rythme de l'affichage, et une boucle
        « while True: t.forward(…) » ne fige pas l'onglet. Sans JSPI, le moteur étale l'animation (file « anime »)."""
        if self._tracer == 0 or not tkinter._peut_attendre():
            return
        if self._anime:
            self._anime = 0
            _ui.configurer(self.cv._id, _js({"anime": 0}))
        if self._tracer == 1:
            tkinter._ceder(max(0, self._delai or 0) / 1000)
        else:
            self._compteur = (self._compteur + 1) % self._tracer
            if self._compteur:
                return
            tkinter._ceder(0)
        self._apres_attente()

    def _apres_attente(self):
        """Après avoir rendu la main : sys.exit() appelé par un rappel (onkey…) pendant l'attente arrête le
        programme, comme dans Tk ; fenêtre fermée pendant l'attente → Terminator."""
        relancer = getattr(tkinter, "_relancer_sortie", None)
        if relancer is not None:
            relancer()
        self._verifier()

    # — fenêtre —
    def screensize(self, canvwidth=None, canvheight=None, bg=None):
        if canvwidth is None and canvheight is None and bg is None:
            return (self._l, self._h)
        if bg is not None:
            self.bgcolor(bg)

    def window_width(self):
        return self._l

    def window_height(self):
        return self._h

    def setworldcoordinates(self, llx, lly, urx, ury):
        self._mode = "world"
        self._monde = (float(llx), float(lly), float(urx), float(ury))
        for t in self._tortues:
            t._dessiner_curseur()

    def bgcolor(self, *args):
        if not args:
            return self._bg
        self._verifier()
        css = _vers_css(args, self._colormode)  # couleur refusée : l'état d'avant reste, comme dans CPython
        self._bg = args[0] if len(args) == 1 else args
        self.cv.configure(bg=css)

    def bgpic(self, picname=None):
        if picname is None:
            return self._image_fond or "nopic"
        if self._image_fond_item:
            self.cv.delete(self._image_fond_item)
            self._image_fond_item = None
        if picname == "nopic":
            self._image_fond = None
            return
        self._image_fond = picname
        self._photo = tkinter.PhotoImage(file=picname)
        self._image_fond_item = self.cv.create_image(self._l / 2, self._h / 2, image=self._photo)
        self.cv.tag_lower(self._image_fond_item)

    _image_fond_item = None

    def mode(self, mode=None):
        if mode is None:
            return self._mode
        if mode not in ("standard", "logo", "world"):
            raise TurtleGraphicsError(f"No turtle-graphics-mode {mode}")
        self._mode = mode
        if mode != "world":
            self._monde = None
        for t in self._tortues:
            t.reset()

    def colormode(self, cmode=None):
        if cmode is None:
            return self._colormode
        self._colormode = 1.0 if float(cmode) == 1.0 else 255

    def tracer(self, n=None, delay=None):
        if n is None:
            return self._tracer
        self._tracer = int(n)
        self._compteur = 0
        if delay is not None:
            self._delai = int(delay)
        self._regler_animation()
        if self._tracer:
            self._rafraichir()  # sans le garde-fou d'update() : tracer(1) n'est pas une boucle

    def delay(self, delay=None):
        if delay is None:
            return self._delai
        self._delai = int(delay)

    def _rafraichir(self):
        """Redessine les curseurs ; avec JSPI, rend la main au navigateur (la page se redessine, reçoit le clavier).
        Renvoie False si le programme ne peut pas attendre (pas de JSPI)."""
        self._verifier()
        for t in self._tortues:
            t._dessiner_curseur(force=True)
        if not tkinter._peut_attendre():
            return False
        tkinter._ceder(0)
        self._apres_attente()
        return True

    def update(self):
        # Boucle de jeu « while True: écran.update() » : avec JSPI, la page se redessine et reçoit le clavier.
        # Sans JSPI, elle resterait figée pour toujours : arrêtée au bout de 3 s, comme update() de tkinter.
        if self._rafraichir():
            return
        try:
            tkinter._surveiller_boucle()
        except RuntimeError:
            raise RuntimeError(
                "Boucle sans fin avec update() : dans ce navigateur, la fenêtre turtle ne peut se redessiner que si "
                "le programme rend la main. Remplacez « while True: … écran.update() » par une fonction qui se "
                "reprogramme avec écran.ontimer(fonction, millisecondes)."
            ) from None

    def turtles(self):
        return list(self._tortues)

    def getcanvas(self):
        return self.cv

    def getshapes(self):
        return sorted(self._formes)

    def register_shape(self, name, shape=None):
        if shape is None:
            self._formes[name] = ("image", tkinter.PhotoImage(file=name))
        elif isinstance(shape, Shape):
            self._formes[name] = tuple(shape._data or ())
        else:
            self._formes[name] = tuple(tuple(p) for p in shape)

    addshape = register_shape

    def clearscreen(self):
        for t in list(self._tortues):
            t._effacer_curseur()
        self.cv.delete("all")
        self._tortues.clear()
        self.bgcolor("white")

    clear = clearscreen

    def resetscreen(self):
        for t in self._tortues:
            t.reset()

    reset = resetscreen

    # — événements —
    def onkey(self, fun, key=None):
        seq = f"<KeyRelease-{key}>" if key else "<KeyRelease>"
        if fun is None:
            self._root.unbind(seq)
        else:
            self._root.bind(seq, lambda e: fun())

    onkeyrelease = onkey

    def onkeypress(self, fun, key=None):
        seq = f"<KeyPress-{key}>" if key else "<KeyPress>"
        if fun is None:
            self._root.unbind(seq)
        else:
            self._root.bind(seq, lambda e: fun())

    def listen(self, xdummy=None, ydummy=None):
        self._root.focus_set()

    def onclick(self, fun, btn=1, add=None):
        if fun is None:
            self.cv.unbind(f"<Button-{btn}>")
            return
        self.cv.bind(f"<Button-{btn}>", lambda e: fun(*self._depuis_canvas(e.x, e.y)), add)

    onscreenclick = onclick

    def onrelease(self, fun, btn=1, add=None):
        self.cv.bind(f"<ButtonRelease-{btn}>", lambda e: fun(*self._depuis_canvas(e.x, e.y)), add)

    def ontimer(self, fun, t=0):
        self._root.after(int(t), fun)

    def textinput(self, title, prompt):
        from tkinter import simpledialog

        self._verifier()
        return simpledialog.askstring(title, prompt)

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        from tkinter import simpledialog

        self._verifier()
        return simpledialog.askfloat(title, prompt, initialvalue=default, minvalue=minval, maxvalue=maxval)

    def mainloop(self):
        tkinter.mainloop()  # attend la fermeture de la fenêtre quand le navigateur le permet (JSPI)
        if self.cv._detruit:
            # Sortie de mainloop() parce que la fenêtre a été fermée : c'est la fin normale du programme. La console
            # continue (pas un vrai processus) : la cellule suivante ne doit pas recevoir de Terminator.
            TurtleScreen._RUNNING = True

    done = mainloop


class _Root(tkinter.Tk):
    """Fenêtre de Screen() (comme _Root de CPython) : la fermer — croix, bye(), « Fermer les fenêtres » de la
    console — arrête le programme turtle en cours (TurtleScreen._RUNNING = False → turtle.Terminator)."""

    def destroy(self):
        e = getattr(self, "_ecran_tortue", None)
        if not self._detruit and e is not None and _ecran[0] is e:
            _ecran[0] = _tortue[0] = None
            # Bouton « Arrêter » ou sys.exit() dans un rappel : le programme s'arrête déjà (KeyboardInterrupt,
            # SystemExit) ; pas de Terminator en attente pour la suite de la console.
            if not _ui.arretDemande() and getattr(tkinter, "_sortie", [None])[0] is None:
                TurtleScreen._RUNNING = False
        super().destroy()


class _Screen(TurtleScreen):
    """L'écran unique de Screen() : une fenêtre « Python Turtle Graphics » avec son propre Canvas."""

    def __init__(self):
        root = _Root()
        root.title("Python Turtle Graphics")
        l, h = (int(x) for x in _ui.ecran().to_py())
        cv = ScrolledCanvas(root, max(240, min(720, int(l * 0.7))), max(200, min(540, int(h * 0.65))))
        cv.pack(fill="both", expand=True)
        root._ecran_tortue = self
        TurtleScreen.__init__(self, cv)

    def title(self, titlestring):
        self._root.title(titlestring)

    def setup(self, width=0.5, height=0.75, startx=None, starty=None):
        ecran = [int(x) for x in _ui.ecran().to_py()]
        l = int(width * ecran[0]) if isinstance(width, float) and width <= 1 else int(width)
        h = int(height * ecran[1]) if isinstance(height, float) and height <= 1 else int(height)
        self._l, self._h = max(100, min(l, ecran[0] - 30)), max(80, min(h, ecran[1] - 80))
        self.cv.configure(width=self._l, height=self._h)

    def bye(self):
        try:
            self._root.destroy()
        except Exception:
            pass
        if _ecran[0] is self:
            _ecran[0] = None
            _tortue[0] = None

    def exitonclick(self):
        self.onclick(lambda x, y: self.bye())
        self.mainloop()


def _ecran_du_canvas(cv):
    """Écran de la tortue d'un Canvas tkinter : créé une fois, puis réutilisé (RawTurtle(cv) plusieurs fois)."""
    e = getattr(cv, "_ecran_tortue", None)
    if isinstance(e, TurtleScreen) and e.cv is cv:
        return e
    return TurtleScreen(cv)


def Screen():
    e = _ecran[0]
    if e is None or e._root._detruit:
        e = _ecran[0] = _Screen()
    return e


def _annulable(methode):
    """Méthode de la tortue annulable par undo() : l'état d'avant et les dessins créés sont notés.
    Les appels imbriqués (circle → forward…) ne forment qu'une seule annulation, comme dans CPython. Avec JSPI,
    un rappel (ondrag, ontimer…) peut agir sur la tortue pendant qu'une méthode attend la page : il rejoint alors
    l'annulation de la méthode en cours, notée par l'appel extérieur seulement."""

    def f(self, *args, **kw):
        exterieur = self._niveau_annul == 0
        if exterieur:
            if args or kw or methode.__name__ not in _LECTURES:
                self.screen._verifier()  # fenêtre fermée : Terminator avant tout dessin
            avant, n = self._etat_annul(), len(self._items)
        self._niveau_annul += 1
        try:
            return methode(self, *args, **kw)
        finally:
            self._niveau_annul -= 1
            if exterieur:
                self._noter_annul(avant, n)

    f.__name__ = methode.__name__
    f.__doc__ = methode.__doc__
    return f


_LECTURES = {"pencolor", "fillcolor", "color", "pensize", "pen"}  # sans argument : simple lecture
_ETAT_ANNUL = ("_x", "_y","_cap", "_baisse", "_crayon", "_remplissage", "_crayon_css", "_remplissage_css", "_epaisseur", "_visible", "_remplit", "_rempl_premier")


class RawTurtle:
    def __init__(self, canvas=None, shape="classic", undobuffersize=1000, visible=True):
        if isinstance(canvas, TurtleScreen):
            self.screen = canvas
        elif isinstance(canvas, tkinter.Canvas):
            self.screen = _ecran_du_canvas(canvas)
        else:
            self.screen = Screen()
        self._annulations = []
        self._annul_max = int(undobuffersize) if undobuffersize else 0
        self._niveau_annul = 0
        self._items = []
        self._tampons = {}
        self._curseur = None
        self._etiquette = f"tortue{next(_NUMEROS)}"  # tag propre du curseur : onclick / ondrag de CETTE tortue
        self._remplit = False
        self._rempl_points = []
        self._rempl_premier = None
        self._poly = None
        self._initialiser(shape, visible)
        self.screen._tortues.append(self)
        self.screen._regler_animation()
        self._maj(force=True)

    def _initialiser(self, shape="classic", visible=True):
        self._x = self._y = 0.0
        self._cap = 90.0 if self.screen._mode == "logo" else 0.0
        self._baisse = True
        self._crayon = "black"
        self._remplissage = "black"
        self._crayon_css = "black"
        self._remplissage_css = "black"
        self._epaisseur = 1
        self._vitesse = 3
        self._visible = visible
        self._forme = shape
        self._etirement = (1.0, 1.0, 1)
        self._unite = 360.0

    # — utilitaires —
    @property
    def _cv(self):
        return self.screen.cv

    def _etat_annul(self):
        e = {k: getattr(self, k) for k in _ETAT_ANNUL}
        # Ces listes ne font que s'allonger : on note la liste et sa longueur (pas de copie, coût constant
        # même pour un long remplissage) ; undo() la retronque.
        e["_rempl_points"] = (self._rempl_points, len(self._rempl_points))
        e["_poly"] = None if self._poly is None else (self._poly, len(self._poly))
        return e

    def _noter_annul(self, avant, n):
        if not self._annul_max:
            return
        crees = self._items[n:]
        if not crees and avant == self._etat_annul():
            return  # simple lecture (pencolor() sans argument…) : rien à annuler
        self._annulations.append((avant, crees))
        if len(self._annulations) > self._annul_max:
            del self._annulations[0]

    def _c(self, x, y):
        return self.screen._vers_canvas(x, y)

    def _angle_utilisateur(self, a):
        """Angle utilisateur (degrés ou unité choisie, mode logo) → angle standard en degrés."""
        return float(a) * 360.0 / self._unite

    def _pas(self, x0, y0, x, y):
        """Nombre de mises à jour d'un déplacement (distance en pixels) : la formule de CPython (vitesse,
        tracer(1)) quand Python donne le rythme (JSPI) ; sinon, un découpage adapté à la file du moteur."""
        if not self._vitesse:
            return 1
        (a, b), (c, d) = self._c(x0, y0), self._c(x, y)
        distance = math.hypot(c - a, d - b)
        if tkinter._peut_attendre():
            if self.screen._tracer != 1:
                return 1
            return 1 + int(distance / (3 * 1.1 ** self._vitesse * self._vitesse))
        if not self.screen._anime_actif():
            return 1
        return max(1, int(distance / _PX_PAR_PAS.get(self._vitesse, 14)))

    def _maj(self, force=False):
        """Comme _update() de CPython, après chaque changement : fenêtre fermée → Terminator, curseur redessiné,
        puis (tracer actif, JSPI) la page se redessine et le programme attend delay() ms."""
        self.screen._verifier()
        self._dessiner_curseur(force)
        self.screen._cadence()

    def _effacer_curseur(self):
        if self._curseur is not None:
            self._cv.delete(self._curseur)
            self._curseur = None

    def _poly_curseur(self):
        forme = self.screen._formes.get(self._forme, _FORMES["classic"])
        if isinstance(forme, tuple) and forme and forme[0] == "image":
            return None
        a = math.radians(self._cap)
        e0, e1 = math.cos(a), math.sin(a)
        sw, sl, _ = self._etirement
        pts = []
        for x, y in forme:
            x, y = x * sw, y * sl
            wx = self._x + (e1 * x + e0 * y)
            wy = self._y + (-e0 * x + e1 * y)
            pts.extend(self._c(wx, wy))
        return pts

    def _dessiner_curseur(self, force=False):
        if not force and self.screen._tracer == 0:
            return
        if not self._visible:
            self._effacer_curseur()
            return
        forme = self.screen._formes.get(self._forme)
        if isinstance(forme, tuple) and forme and forme[0] == "image":
            x, y = self._c(self._x, self._y)
            if self._curseur is None:
                self._curseur = self._cv.create_image(x, y, image=forme[1], tags=("tortue", self._etiquette))
            else:
                self._cv.coords(self._curseur, x, y)
            return
        pts = self._poly_curseur()
        if not pts or len(pts) < 6:
            self._effacer_curseur()
            return
        if self._curseur is None:
            self._curseur = self._cv.create_polygon(*pts, fill=self._remplissage_css, outline=self._crayon_css, width=self._etirement[2], tags=("tortue", self._etiquette))
        else:
            it = self._cv._items.get(self._curseur)
            if it is not None:
                it["coords"] = pts
                it["opts"].update({"fill": self._remplissage_css, "outline": self._crayon_css})
                self._cv._maj_item(self._curseur)
                self._cv.tag_raise(self._curseur)

    # — déplacements —
    def _aller(self, x, y, tracer_ligne=True):
        x0, y0 = self._x, self._y
        x, y = float(x), float(y)
        n = self._pas(x0, y0, x, y)
        ligne = None
        if self._baisse and tracer_ligne and (x, y) != (x0, y0):
            c0 = self._c(x0, y0)
            ligne = self._cv.create_line(*c0, *(self._c(x, y) if n == 1 else c0), fill=self._crayon_css, width=self._epaisseur, capstyle="round")
            self._items.append(ligne)
            if self._remplit and self._rempl_premier is None:
                self._rempl_premier = ligne
        for k in range(1, n + 1):
            xi = x0 + (x - x0) * k / n
            yi = y0 + (y - y0) * k / n
            if ligne is not None and n > 1:
                self._cv.coords(ligne, *self._c(x0, y0), *self._c(xi, yi))
            self._x, self._y = xi, yi
            self._maj()  # une mise à jour par pas, comme CPython (même en vitesse 0 : une seule)
        self._x, self._y = x, y
        if self._remplit:
            self._rempl_points.append((x, y))
        if self._poly is not None:
            self._poly.append((x, y))

    def _tourner(self, angle):
        """Rotation animée pas à pas (vitesse > 0), puis une mise à jour finale, comme _rotate de CPython."""
        pas = 0
        if self._vitesse:
            if tkinter._peut_attendre():
                if self.screen._tracer == 1:
                    pas = 1 + int(abs(angle) / (3.0 * self._vitesse))
            elif self.screen._anime_actif() and self._visible:
                pas = max(1, int(abs(angle) / (10 * self._vitesse / 3)))
        cap = (self._cap + angle) % 360
        for _ in range(pas):
            self._cap = (self._cap + angle / pas) % 360
            self._maj()
        self._cap = cap
        self._maj()

    def _changer_vitesse(self, vitesse, rythme):
        """Vitesse changée pendant circle() : avec JSPI, compte une mise à jour comme speed() de CPython."""
        self._vitesse = vitesse
        if rythme:
            self._maj()

    @_annulable
    def forward(self, distance):
        a = math.radians(self._cap)
        self._aller(self._x + float(distance) * math.cos(a), self._y + float(distance) * math.sin(a))

    fd = forward

    def backward(self, distance):
        self.forward(-float(distance))

    bk = back = backward

    @_annulable
    def left(self, angle):
        # Même en mode « logo », left tourne à gauche : seule la numérotation du cap change (0 = nord,
        # sens horaire), gérée par heading() / setheading() / towards().
        self._tourner(self._angle_utilisateur(angle))

    lt = left

    @_annulable
    def right(self, angle):
        self._tourner(-self._angle_utilisateur(angle))

    rt = right

    @_annulable
    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._aller(x, y)

    setpos = setposition = goto

    @_annulable
    def teleport(self, x=None, y=None, *, fill_gap=False):
        self._aller(self._x if x is None else x, self._y if y is None else y, tracer_ligne=False)

    @_annulable
    def setx(self, x):
        self._aller(x, self._y)

    @_annulable
    def sety(self, y):
        self._aller(self._x, y)

    @_annulable
    def setheading(self, to_angle):
        a = self._angle_utilisateur(to_angle)
        cible = (90 - a) if self.screen._mode == "logo" else a
        diff = (cible - self._cap + 180) % 360 - 180
        self._tourner(diff)

    seth = setheading

    @_annulable
    def home(self):
        self.goto(0, 0)
        self.setheading(0)

    @_annulable
    def circle(self, radius, extent=None, steps=None):
        radius = float(radius)
        extent = self._unite if extent is None else float(extent)
        ext_deg = self._angle_utilisateur(extent)
        if steps is None:
            frac = abs(ext_deg) / 360
            steps = 1 + int(min(11 + abs(radius) / 6.0, 59.0) * frac)
        w = ext_deg / steps
        w2 = 0.5 * w
        l = 2.0 * radius * math.sin(math.radians(w2))
        if radius < 0:
            l, w, w2 = -l, -w, -w2
        # Comme CPython : en vitesse 0, le cercle se dessine d'un coup (tracer coupé le temps du cercle) ; sinon
        # chaque côté avance à la vitesse de la tortue et chaque rotation se fait en vitesse 0. Sans JSPI, la
        # file du moteur anime les côtés un peu plus vite (vitesse + 3).
        vitesse = self._vitesse
        ecran = self.screen
        rythme = tkinter._peut_attendre()
        cote = vitesse if rythme or not vitesse else min(10, vitesse + 3)
        tr = ecran._tracer
        if vitesse == 0:
            ecran._tracer = 0
        try:
            self._changer_vitesse(0, rythme)
            self._tourner(w2)
            for _ in range(steps):
                self._changer_vitesse(cote, rythme)
                self.forward(l)
                self._changer_vitesse(0, rythme)
                self._tourner(w)
            self._tourner(-w2)
        finally:
            self._vitesse = vitesse
            if vitesse == 0:
                ecran._tracer = tr
        if vitesse == 0:
            ecran.tracer(tr)
        elif rythme:
            self._maj()

    @_annulable
    def dot(self, size=None, *color):
        if size is not None and not isinstance(size, (int, float)):
            color = (size,) + color
            size = None
        d = float(size) if size else max(self._epaisseur + 4, 2 * self._epaisseur)
        css = _vers_css(color, self.screen._colormode) if color else self._crayon_css
        x, y = self._c(self._x, self._y)
        i = self._cv.create_oval(x - d / 2, y - d / 2, x + d / 2, y + d / 2, fill=css, outline="")
        self._items.append(i)
        self._maj()

    @_annulable
    def stamp(self):
        pts = self._poly_curseur()
        if not pts:
            return None
        i = self._cv.create_polygon(*pts, fill=self._remplissage_css, outline=self._crayon_css)
        self._tampons[i] = True
        self._items.append(i)
        self._dessiner_curseur()
        return i

    def clearstamp(self, stampid):
        if stampid in self._tampons:
            self._cv.delete(stampid)
            del self._tampons[stampid]

    def clearstamps(self, n=None):
        ids = list(self._tampons)
        if n is not None:
            ids = ids[:n] if n >= 0 else ids[n:]
        for i in ids:
            self.clearstamp(i)

    @_annulable
    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        x, y = self._c(self._x, self._y)
        ancre = {"left": "sw", "center": "s", "right": "se"}.get(align, "sw")
        i = self._cv.create_text(x, y, text=str(arg), anchor=ancre, fill=self._crayon_css, font=font)
        self._items.append(i)
        if move:
            b = self._cv.bbox(i)
            if b:
                self._aller(self._x + (b[2] - b[0]), self._y, tracer_ligne=False)
        self._maj()

    # — remplissage —
    @_annulable
    def begin_fill(self):
        self._remplit = True
        self._rempl_points = [(self._x, self._y)]
        self._rempl_premier = None
        self._maj()

    @_annulable
    def end_fill(self):
        if self._remplit and len(self._rempl_points) > 2:
            pts = []
            for x, y in self._rempl_points:
                pts.extend(self._c(x, y))
            poly = self._cv.create_polygon(*pts, fill=self._remplissage_css, outline="")
            self._items.append(poly)
            if self._rempl_premier is not None:
                self._cv.tag_lower(poly, self._rempl_premier)
        self._remplit = False
        self._rempl_points = []
        self._maj()

    def filling(self):
        return self._remplit

    def begin_poly(self):
        self._poly = [(self._x, self._y)]

    def end_poly(self):
        pass

    def get_poly(self):
        return tuple(self._poly or ())

    # — crayon —
    @_annulable
    def pendown(self):
        self._baisse = True
        self._maj()

    pd = down = pendown

    @_annulable
    def penup(self):
        self._baisse = False
        self._maj()

    pu = up = penup

    def isdown(self):
        return self._baisse

    @_annulable
    def pensize(self, width=None):
        if width is None:
            return self._epaisseur
        self._epaisseur = float(width)
        self._maj()

    width = pensize

    def speed(self, speed=None):
        if speed is None:
            return self._vitesse
        if isinstance(speed, str):
            speed = _VITESSES.get(speed, 6)
        speed = float(speed)
        self._vitesse = 0 if speed > 10 or speed < 0.5 else int(round(speed))
        self.screen._regler_animation()
        self._maj()

    # Couleurs : vérifiées AVANT de changer l'état ; une couleur refusée laisse l'état d'avant, comme CPython.
    @_annulable
    def pencolor(self, *args):
        if not args:
            return self._crayon
        css = _vers_css(args, self.screen._colormode)
        self._crayon = args[0] if len(args) == 1 else args
        self._crayon_css = css
        self._maj()

    @_annulable
    def fillcolor(self, *args):
        if not args:
            return self._remplissage
        css = _vers_css(args, self.screen._colormode)
        self._remplissage = args[0] if len(args) == 1 else args
        self._remplissage_css = css
        self._maj()

    @_annulable
    def color(self, *args):
        if not args:
            return (self._crayon, self._remplissage)
        if len(args) == 2:
            crayon, remplissage = args
        elif len(args) in (1, 3):
            crayon = remplissage = args[0] if len(args) == 1 else args
        else:
            raise TurtleGraphicsError(f"bad color arguments: {args}")
        mode = self.screen._colormode
        css_crayon, css_remplissage = _vers_css((crayon,), mode), _vers_css((remplissage,), mode)
        self._crayon, self._crayon_css = crayon, css_crayon
        self._remplissage, self._remplissage_css = remplissage, css_remplissage
        self._maj()

    @_annulable
    def pen(self, pen=None, **pendict):
        etat = {"shown": self._visible, "pendown": self._baisse, "pencolor": self._crayon, "fillcolor": self._remplissage, "pensize": self._epaisseur, "speed": self._vitesse, "resizemode": "noresize", "stretchfactor": self._etirement[:2], "outline": self._etirement[2], "tilt": 0.0}
        if pen is None and not pendict:
            return etat
        o = {**(pen or {}), **pendict}
        if "shown" in o:
            self.showturtle() if o["shown"] else self.hideturtle()
        if "pendown" in o:
            self._baisse = bool(o["pendown"])
        if "pencolor" in o:
            self.pencolor(o["pencolor"])
        if "fillcolor" in o:
            self.fillcolor(o["fillcolor"])
        if "pensize" in o:
            self.pensize(o["pensize"])
        if "speed" in o:
            self.speed(o["speed"])

    # — état —
    @_annulable
    def showturtle(self):
        self._visible = True
        self._maj(force=True)

    st = showturtle

    @_annulable
    def hideturtle(self):
        self._visible = False
        self._effacer_curseur()
        self._maj()

    ht = hideturtle

    def isvisible(self):
        return self._visible

    def shape(self, name=None):
        if name is None:
            return self._forme
        if name not in self.screen._formes:
            raise TurtleGraphicsError(f"There is no shape named {name}")
        self._forme = name
        self._effacer_curseur()
        self._maj(force=True)

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None and outline is None:
            return self._etirement
        sw = float(stretch_wid) if stretch_wid is not None else self._etirement[0]
        sl = float(stretch_len) if stretch_len is not None else (sw if stretch_wid is not None else self._etirement[1])
        self._etirement = (sw, sl, outline if outline is not None else self._etirement[2])
        self._maj()

    turtlesize = shapesize

    def resizemode(self, rmode=None):
        return "noresize"

    def shearfactor(self, shear=None):
        return 0.0

    def tilt(self, angle):
        pass

    def settiltangle(self, angle):
        pass

    def tiltangle(self, angle=None):
        return 0.0

    def shapetransform(self, *args):
        return (1, 0, 0, 1)

    def position(self):
        return Vec2D(self._x, self._y)

    pos = position

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        h = (90 - self._cap) % 360 if self.screen._mode == "logo" else self._cap
        return h * self._unite / 360.0

    def towards(self, x, y=None):
        if y is None:
            x, y = (x.position() if isinstance(x, RawTurtle) else x)
        a = math.degrees(math.atan2(float(y) - self._y, float(x) - self._x)) % 360
        if self.screen._mode == "logo":
            a = (90 - a) % 360
        return a * self._unite / 360.0

    def distance(self, x, y=None):
        if y is None:
            x, y = (x.position() if isinstance(x, RawTurtle) else x)
        return math.hypot(float(x) - self._x, float(y) - self._y)

    def degrees(self, fullcircle=360.0):
        self._unite = float(fullcircle)

    def radians(self):
        self._unite = 2 * math.pi

    def _effacer_dessins(self):
        for i in self._items:
            self._cv.delete(i)
        self._items = []
        self._tampons = {}
        self._annulations = []

    def clear(self):
        self.screen._verifier()
        self._effacer_dessins()
        self._maj()

    def reset(self):
        self.screen._verifier()
        self._effacer_dessins()
        self._effacer_curseur()
        self._initialiser(self._forme, True)
        self._maj(force=True)

    def getscreen(self):
        return self.screen

    def getturtle(self):
        return self

    getpen = getturtle

    def clone(self):
        t = type(self).__new__(type(self))
        RawTurtle.__init__(t, self.screen, self._forme, self._annul_max, visible=self._visible)
        for k in ("_x", "_y", "_cap", "_baisse", "_crayon", "_remplissage", "_crayon_css", "_remplissage_css", "_epaisseur", "_vitesse", "_etirement", "_unite"):
            setattr(t, k, getattr(self, k))
        t._dessiner_curseur(force=True)
        return t

    def undo(self):
        """Annule la dernière action (déplacement, rotation, cercle, tampon, remplissage, crayon…)."""
        self.screen._verifier()
        if not self._annulations:
            return
        avant, crees = self._annulations.pop()
        for i in crees:
            self._cv.delete(i)
            self._tampons.pop(i, None)
        if crees:
            supprimes = set(crees)
            self._items = [i for i in self._items if i not in supprimes]
        for k, v in avant.items():
            if k in ("_rempl_points", "_poly") and v is not None:
                liste, n = v
                del liste[n:]
                v = liste
            setattr(self, k, v)
        self._maj(force=True)

    def setundobuffer(self, size):
        self._annul_max = int(size) if size else 0
        self._annulations = []

    def undobufferentries(self):
        return len(self._annulations)

    def get_shapepoly(self):
        forme = self.screen._formes.get(self._forme, ())
        if not forme or forme[0] == "image":
            return None
        sw, sl, _ = self._etirement
        return tuple((x * sw, y * sl) for x, y in forme)

    # — événements de la tortue —
    # Comme CPython : chaque tortue lie son propre curseur (tag self._etiquette, gardé quand le curseur est
    # recréé), pas toutes les tortues ni tout le canevas.
    def _lier(self, sequence, fun, add):
        if fun is None:
            self._cv.tag_unbind(self._etiquette, sequence)
            return
        ecran = self.screen
        self._cv.tag_bind(self._etiquette, sequence, lambda e: fun(*ecran._depuis_canvas(e.x, e.y)), add)

    def onclick(self, fun, btn=1, add=None):
        self._lier(f"<Button-{btn}>", fun, add)

    def onrelease(self, fun, btn=1, add=None):
        _ecouter_boutons(self._cv)
        self._lier(f"<ButtonRelease-{btn}>", fun, add)

    def ondrag(self, fun, btn=1, add=None):
        _ecouter_boutons(self._cv)
        self._lier(f"<B{btn}-Motion>", fun, add)


class Turtle(RawTurtle):
    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        super().__init__(None, shape, undobuffersize, visible)


RawPen = RawTurtle
Pen = Turtle


_SAISIE = "turtle-saisie"  # tag qu'aucun élément ne porte


def _ecouter_boutons(cv):
    """Le Canvas suit l'élément pressé pendant un glisser (saisie implicite de Tk : un glisser rapide ne perd pas la
    tortue) à condition de recevoir les pressions et relâchements de bouton, même sans onclick : liaisons vides sur
    un tag qu'aucun élément ne porte."""
    if not cv.tag_bind(_SAISIE):
        cv.tag_bind(_SAISIE, "<ButtonPress>", lambda e: None, "+")
        cv.tag_bind(_SAISIE, "<ButtonRelease>", lambda e: None, "+")


def _tortue_defaut():
    t = _tortue[0]
    if t is None or t.screen is not Screen() or t not in t.screen._tortues:
        t = _tortue[0] = Turtle()
    return t


def _reinitialiser():
    """Nouveau lancement (lanceur) : la fenêtre turtle précédente se ferme, sans que le nouveau programme reçoive
    le Terminator de cette fermeture."""
    e = _ecran[0]
    if e is not None:
        e.bye()
    TurtleScreen._RUNNING = True


def _verifier_fonctionnement():
    """Comme les fonctions du module de CPython : après la fermeture de la fenêtre, le premier appel lève
    turtle.Terminator (le programme s'arrête au lieu de rouvrir une fenêtre) ; l'appel suivant en rouvre une."""
    if not TurtleScreen._RUNNING:
        TurtleScreen._RUNNING = True
        raise Terminator(_FERMEE)


_METHODES_ECRAN = [
    "addshape", "bgcolor", "bgpic", "bye", "clearscreen", "colormode", "delay", "exitonclick", "getcanvas", "getshapes",
    "listen", "mainloop", "mode", "numinput", "onkey", "onkeypress", "onkeyrelease", "onscreenclick", "ontimer",
    "register_shape", "resetscreen", "screensize", "setup", "setworldcoordinates", "textinput", "title", "tracer",
    "turtles", "update", "window_height", "window_width", "done",
]
_METHODES_TORTUE = [
    "back", "backward", "begin_fill", "begin_poly", "bk", "circle", "clear", "clearstamp", "clearstamps", "clone",
    "color", "degrees", "distance", "dot", "down", "end_fill", "end_poly", "fd", "fillcolor", "filling", "forward",
    "get_poly", "getpen", "getscreen", "getturtle", "goto", "heading", "hideturtle", "home", "ht", "isdown",
    "isvisible", "left", "lt", "onclick", "ondrag", "onrelease", "pd", "pen", "pencolor", "pendown", "pensize",
    "penup", "pos", "position", "pu", "radians", "right", "reset", "resizemode", "rt", "seth", "setheading", "setpos",
    "setposition", "settiltangle", "setundobuffer", "setx", "sety", "shape", "shapesize", "shapetransform",
    "shearfactor", "showturtle", "speed", "st", "stamp", "teleport", "tilt", "tiltangle", "towards", "turtlesize", "get_shapepoly",
    "undo", "undobufferentries", "up", "width", "write", "xcor", "ycor",
]


def _fonction_ecran(nom):
    def f(*args, **kw):
        _verifier_fonctionnement()
        return getattr(Screen(), nom)(*args, **kw)

    f.__name__ = nom
    return f


def _fonction_tortue(nom):
    def f(*args, **kw):
        _verifier_fonctionnement()
        return getattr(_tortue_defaut(), nom)(*args, **kw)

    f.__name__ = nom
    return f


for _n in _METHODES_ECRAN:
    globals()[_n] = _fonction_ecran(_n)
for _n in _METHODES_TORTUE:
    globals()[_n] = _fonction_tortue(_n)
__all__ += _METHODES_ECRAN + _METHODES_TORTUE
del _n


def write_docstringdict(filename="turtle_docstringdict"):
    pass
`;
