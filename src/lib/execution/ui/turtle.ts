/**
 * Module Python `turtle` de la console du navigateur : la tortue dessine sur un Canvas du tkinter de la
 * console, dans une fenêtre, avec une animation qui suit speed() et tracer().
 */
export const TURTLE = String.raw`
"""turtle pour la console Python du navigateur."""
import math

import tkinter
from tkinter import _couleur, _js, _ui

__all__ = ["ScrolledCanvas", "TurtleScreen", "Screen", "RawTurtle", "Turtle", "RawPen", "Pen", "Shape", "Vec2D", "Terminator", "TurtleGraphicsError"]


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


def _vers_css(args, mode):
    if len(args) == 1:
        a = args[0]
        if isinstance(a, (list, tuple)) and len(a) == 3:
            args = tuple(a)
        else:
            return str(a)
    if len(args) == 3:
        r, g, b = args
        if mode == 1.0:
            r, g, b = (int(round(float(x) * 255)) for x in (r, g, b))
        for x in (r, g, b):
            if not 0 <= int(x) <= 255:
                raise TurtleGraphicsError(f"bad color sequence: {args}")
        return "#%02x%02x%02x" % (int(r), int(g), int(b))
    raise TurtleGraphicsError(f"bad color arguments: {args}")


class _Screen:
    def __init__(self):
        self._root = tkinter.Tk()
        self._root.title("Python Turtle Graphics")
        l, h = (int(x) for x in _ui.ecran().to_py())
        self._l = max(240, min(720, int(l * 0.7)))
        self._h = max(200, min(540, int(h * 0.65)))
        self.cv = tkinter.Canvas(self._root, width=self._l, height=self._h, bg="white", highlightthickness=0)
        self.cv.pack(fill="both", expand=True)
        self._root._ecran_tortue = self
        self._tracer = 1
        self._delai = 10
        self._mode = "standard"
        self._colormode = 1.0
        self._monde = None
        self._tortues = []
        self._formes = dict(_FORMES)
        self._bg = "white"
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
        if self._tracer == 0 or all(t._vitesse == 0 for t in self._tortues if t._visible or t._baisse) and self._tortues:
            n = 0
        else:
            n = 2 * max(1, int(self._tracer or 1))
        if n != self._anime:
            self._anime = n
            _ui.configurer(self.cv._id, _js({"anime": n}))

    def _anime_actif(self):
        return self._anime != 0

    # — fenêtre —
    def title(self, titlestring):
        self._root.title(titlestring)

    def setup(self, width=0.5, height=0.75, startx=None, starty=None):
        ecran = [int(x) for x in _ui.ecran().to_py()]
        l = int(width * ecran[0]) if isinstance(width, float) and width <= 1 else int(width)
        h = int(height * ecran[1]) if isinstance(height, float) and height <= 1 else int(height)
        self._l, self._h = max(100, min(l, ecran[0] - 30)), max(80, min(h, ecran[1] - 80))
        self.cv.configure(width=self._l, height=self._h)

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
        self._bg = args[0] if len(args) == 1 else args
        self.cv.configure(bg=_couleur(_vers_css(args, self._colormode)))

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
        if delay is not None:
            self._delai = delay
        self._regler_animation()
        if self._tracer:
            self.update()

    def delay(self, delay=None):
        if delay is None:
            return self._delai
        self._delai = int(delay)

    def update(self):
        for t in self._tortues:
            t._dessiner_curseur(force=True)

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

        return simpledialog.askstring(title, prompt)

    def numinput(self, title, prompt, default=None, minval=None, maxval=None):
        from tkinter import simpledialog

        return simpledialog.askfloat(title, prompt, initialvalue=default, minvalue=minval, maxvalue=maxval)

    def mainloop(self):
        pass

    done = mainloop

    def bye(self):
        try:
            self._root.destroy()
        except Exception:
            pass
        _ecran[0] = None
        _tortue[0] = None

    def exitonclick(self):
        self.onclick(lambda x, y: self.bye())


TurtleScreen = _Screen


def Screen():
    e = _ecran[0]
    if e is None or e._root._detruit:
        e = _ecran[0] = _Screen()
    return e


class RawTurtle:
    def __init__(self, canvas=None, shape="classic", undobuffersize=1000, visible=True):
        self.screen = canvas if isinstance(canvas, _Screen) else Screen()
        self._items = []
        self._tampons = {}
        self._curseur = None
        self._remplit = False
        self._rempl_points = []
        self._rempl_premier = None
        self._poly = None
        self._clics = {}
        self._initialiser(shape, visible)
        self.screen._tortues.append(self)
        self.screen._regler_animation()
        self._dessiner_curseur(force=True)

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

    def _c(self, x, y):
        return self.screen._vers_canvas(x, y)

    def _angle_utilisateur(self, a):
        """Angle utilisateur (degrés ou unité choisie, mode logo) → angle standard en degrés."""
        return float(a) * 360.0 / self._unite

    def _pas(self, distance):
        if not self.screen._anime_actif() or self._vitesse == 0:
            return 1
        return max(1, int(abs(distance) / _PX_PAR_PAS.get(self._vitesse, 14)))

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
                self._curseur = self._cv.create_image(x, y, image=forme[1], tags=("tortue",))
            else:
                self._cv.coords(self._curseur, x, y)
            return
        pts = self._poly_curseur()
        if not pts or len(pts) < 6:
            self._effacer_curseur()
            return
        if self._curseur is None:
            self._curseur = self._cv.create_polygon(*pts, fill=self._remplissage_css, outline=self._crayon_css, width=self._etirement[2], tags=("tortue",))
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
        n = self._pas(math.hypot(x - x0, y - y0))
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
            if n > 1 or k == n:
                self._dessiner_curseur()
        self._x, self._y = x, y
        if self._remplit:
            self._rempl_points.append((x, y))
        if self._poly is not None:
            self._poly.append((x, y))

    def _tourner(self, angle, animer=True):
        if animer and self.screen._anime_actif() and self._vitesse and self._visible:
            pas = max(1, int(abs(angle) / (10 * max(1, self._vitesse) / 3)))
            for _ in range(pas):
                self._cap = (self._cap + angle / pas) % 360
                self._dessiner_curseur()
        else:
            self._cap = (self._cap + angle) % 360
            self._dessiner_curseur()

    def forward(self, distance):
        a = math.radians(self._cap)
        self._aller(self._x + float(distance) * math.cos(a), self._y + float(distance) * math.sin(a))

    fd = forward

    def backward(self, distance):
        self.forward(-float(distance))

    bk = back = backward

    def left(self, angle):
        self._tourner(self._angle_utilisateur(angle) * (-1 if self.screen._mode == "logo" else 1))

    lt = left

    def right(self, angle):
        self._tourner(-self._angle_utilisateur(angle) * (-1 if self.screen._mode == "logo" else 1))

    rt = right

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._aller(x, y)

    setpos = setposition = goto

    def teleport(self, x=None, y=None, *, fill_gap=False):
        self._aller(self._x if x is None else x, self._y if y is None else y, tracer_ligne=False)

    def setx(self, x):
        self._aller(x, self._y)

    def sety(self, y):
        self._aller(self._x, y)

    def setheading(self, to_angle):
        a = self._angle_utilisateur(to_angle)
        cible = (90 - a) if self.screen._mode == "logo" else a
        diff = (cible - self._cap + 180) % 360 - 180
        self._tourner(diff)

    seth = setheading

    def home(self):
        self.goto(0, 0)
        self.setheading(0)

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
        vitesse = self._vitesse
        self._tourner(w2, animer=False)
        for _ in range(steps):
            self._vitesse = min(10, vitesse + 3) if vitesse else 0
            self.forward(l)
            self._vitesse = vitesse
            self._tourner(w, animer=False)
        self._tourner(-w2, animer=False)

    def dot(self, size=None, *color):
        if size is not None and not isinstance(size, (int, float)):
            color = (size,) + color
            size = None
        d = float(size) if size else max(self._epaisseur + 4, 2 * self._epaisseur)
        css = _vers_css(color, self.screen._colormode) if color else self._crayon_css
        x, y = self._c(self._x, self._y)
        i = self._cv.create_oval(x - d / 2, y - d / 2, x + d / 2, y + d / 2, fill=css, outline="")
        self._items.append(i)
        self._dessiner_curseur()

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

    def write(self, arg, move=False, align="left", font=("Arial", 8, "normal")):
        x, y = self._c(self._x, self._y)
        ancre = {"left": "sw", "center": "s", "right": "se"}.get(align, "sw")
        i = self._cv.create_text(x, y, text=str(arg), anchor=ancre, fill=self._crayon_css, font=font)
        self._items.append(i)
        if move:
            b = self._cv.bbox(i)
            if b:
                self._aller(self._x + (b[2] - b[0]), self._y, tracer_ligne=False)
        self._dessiner_curseur()

    # — remplissage —
    def begin_fill(self):
        self._remplit = True
        self._rempl_points = [(self._x, self._y)]
        self._rempl_premier = None

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
        self._dessiner_curseur()

    def filling(self):
        return self._remplit

    def begin_poly(self):
        self._poly = [(self._x, self._y)]

    def end_poly(self):
        pass

    def get_poly(self):
        return tuple(self._poly or ())

    # — crayon —
    def pendown(self):
        self._baisse = True

    pd = down = pendown

    def penup(self):
        self._baisse = False

    pu = up = penup

    def isdown(self):
        return self._baisse

    def pensize(self, width=None):
        if width is None:
            return self._epaisseur
        self._epaisseur = float(width)

    width = pensize

    def speed(self, speed=None):
        if speed is None:
            return self._vitesse
        if isinstance(speed, str):
            speed = _VITESSES.get(speed, 6)
        speed = float(speed)
        self._vitesse = 0 if speed > 10 or speed < 0.5 else int(round(speed))
        self.screen._regler_animation()

    def pencolor(self, *args):
        if not args:
            return self._crayon
        self._crayon = args[0] if len(args) == 1 else args
        self._crayon_css = _couleur(_vers_css(args, self.screen._colormode))
        self._dessiner_curseur()

    def fillcolor(self, *args):
        if not args:
            return self._remplissage
        self._remplissage = args[0] if len(args) == 1 else args
        self._remplissage_css = _couleur(_vers_css(args, self.screen._colormode))
        self._dessiner_curseur()

    def color(self, *args):
        if not args:
            return (self._crayon, self._remplissage)
        if len(args) == 1 or (len(args) == 3 and all(isinstance(a, (int, float)) for a in args)):
            self.pencolor(*args)
            self.fillcolor(*args)
        else:
            self.pencolor(args[0])
            self.fillcolor(args[1])

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
    def showturtle(self):
        self._visible = True
        self._dessiner_curseur(force=True)

    st = showturtle

    def hideturtle(self):
        self._visible = False
        self._effacer_curseur()

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
        self._dessiner_curseur(force=True)

    def shapesize(self, stretch_wid=None, stretch_len=None, outline=None):
        if stretch_wid is None and stretch_len is None and outline is None:
            return self._etirement
        sw = float(stretch_wid) if stretch_wid is not None else self._etirement[0]
        sl = float(stretch_len) if stretch_len is not None else (sw if stretch_wid is not None else self._etirement[1])
        self._etirement = (sw, sl, outline if outline is not None else self._etirement[2])
        self._dessiner_curseur()

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

    def clear(self):
        for i in self._items:
            self._cv.delete(i)
        self._items = []
        self._tampons = {}

    def reset(self):
        self.clear()
        self._effacer_curseur()
        self._initialiser(self._forme, True)
        self._dessiner_curseur(force=True)

    def getscreen(self):
        return self.screen

    def getturtle(self):
        return self

    getpen = getturtle

    def clone(self):
        t = type(self).__new__(type(self))
        RawTurtle.__init__(t, self.screen, self._forme, visible=self._visible)
        for k in ("_x", "_y", "_cap", "_baisse", "_crayon", "_remplissage", "_crayon_css", "_remplissage_css", "_epaisseur", "_vitesse", "_etirement", "_unite"):
            setattr(t, k, getattr(self, k))
        t._dessiner_curseur(force=True)
        return t

    def undo(self):
        pass

    def setundobuffer(self, size):
        pass

    def undobufferentries(self):
        return 0

    # — événements de la tortue —
    def onclick(self, fun, btn=1, add=None):
        self._cv.tag_bind("tortue", f"<Button-{btn}>", lambda e: fun(*self.screen._depuis_canvas(e.x, e.y)) if fun else None)

    def onrelease(self, fun, btn=1, add=None):
        self._cv.tag_bind("tortue", f"<ButtonRelease-{btn}>", lambda e: fun(*self.screen._depuis_canvas(e.x, e.y)) if fun else None)

    def ondrag(self, fun, btn=1, add=None):
        self._cv.bind(f"<B{btn}-Motion>", lambda e: fun(*self.screen._depuis_canvas(e.x, e.y)) if fun else None)


class Turtle(RawTurtle):
    def __init__(self, shape="classic", undobuffersize=1000, visible=True):
        super().__init__(None, shape, undobuffersize, visible)


RawPen = RawTurtle
Pen = Turtle


def _tortue_defaut():
    t = _tortue[0]
    if t is None or t.screen is not Screen() or t not in t.screen._tortues:
        t = _tortue[0] = Turtle()
    return t


def _reinitialiser():
    e = _ecran[0]
    if e is not None:
        e.bye()


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
    "shearfactor", "showturtle", "speed", "st", "stamp", "teleport", "tilt", "tiltangle", "towards", "turtlesize",
    "undo", "undobufferentries", "up", "width", "write", "xcor", "ycor",
]


def _fonction_ecran(nom):
    def f(*args, **kw):
        return getattr(Screen(), nom)(*args, **kw)

    f.__name__ = nom
    return f


def _fonction_tortue(nom):
    def f(*args, **kw):
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
