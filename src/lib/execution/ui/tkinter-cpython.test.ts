/**
 * Le tkinter de la console (Python, dessiné dans la page) exécuté pour de vrai en CPython, avec un faux
 * navigateur : le module JS `atelier_ui` et `js` / `pyodide.ffi` sont remplacés par des cales qui ne dessinent
 * rien. Vérifie la logique Python (index du Text, recherche, annulation, Listbox, Treeview, Notebook,
 * OptionMenu, Canvas, images) ; le rendu et les événements se vérifient au banc dans un vrai navigateur.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULES_PYTHON } from "./modules";

const python = spawnSync("python3", ["--version"], { encoding: "utf-8" }).status === 0 ? "python3" : null;

const CALES: Record<string, string> = {
  "js.py": String.raw`
class Object:
    @staticmethod
    def fromEntries(x):
        return dict(x)

_file = []

def setTimeout(f, ms=0):
    _file.append(f)
    return len(_file)

def queueMicrotask(f):
    _file.append(f)

def vider():
    while _file:
        _file.pop(0)()

__atelierSansJSPI = True
`,
  "pyodide/__init__.py": "",
  "pyodide/ffi.py": String.raw`
def create_once_callable(f):
    return f

def create_proxy(f):
    return f

def to_js(v, **k):
    return v

def can_run_sync():
    return False

def run_sync(p):
    return None
`,
  "atelier_ui.py": String.raw`
import js
APPELS = []

def differer(f, ms=0):
    js._file.append(f)

def __getattr__(nom):
    def f(*a, **k):
        APPELS.append((nom, a))
        return None
    return f
`,
};

let dossier = "";

/** Exécute un programme Python avec le tkinter de la console ; renvoie ce qu'il affiche. */
function executer(code: string): string {
  const r = spawnSync(python!, ["-c", `import sys; sys.path.insert(0, ${JSON.stringify(dossier)})\n${code}`], { encoding: "utf-8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

beforeAll(() => {
  if (!python) return;
  dossier = mkdtempSync(path.join(tmpdir(), "tk-cpython-"));
  for (const [chemin, source] of Object.entries({ ...MODULES_PYTHON, ...CALES })) {
    const complet = path.join(dossier, chemin);
    mkdirSync(path.dirname(complet), { recursive: true });
    writeFileSync(complet, source);
  }
});

afterAll(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true });
});

describe.skipIf(!python)("tkinter de la console en CPython", () => {
  it("Text : « +1line » atteint end (numéros de ligne qui s'arrêtent), end-1line", () => {
    const sortie = executer(String.raw`
import tkinter as tk
t = tk.Text(tk.Tk())
t.insert("1.0", "a = 1\nb = 2\nprint(a + b)")
print(t.index("3.0+1line"), t.index("3.4+1line"), t.index("end+1line"), t.index("1.0+10lines"), t.index("end-1line"), t.index("2.3+1line"))
vus, i = [], t.index("1.0")
while t.compare(i, "<", "end") and len(vus) < 20:
    vus.append(i)
    i = t.index(i + "+1line")
print(vus)
`);
    expect(sortie.split("\n")).toEqual(["4.0 4.0 4.0 4.0 3.0 3.3", "['1.0', '2.0', '3.0']"]);
  });

  it("Text.search : ^ et $ par ligne, \\m \\M de Tcl, recherche arrière au plus proche", () => {
    const sortie = executer(String.raw`
import tkinter as tk
t = tk.Text(tk.Tk())
t.insert("1.0", "def f(x):\n    return x  # commentaire\n# ligne seule\nclass A:\n    pass")
n = tk.IntVar()
print(t.search(r"^class", "1.0", stopindex="end", regexp=True), t.search(r"^\s+pass", "1.0", stopindex="end", regexp=True), t.search(r"#.*$", "1.0", stopindex="end", regexp=True, count=n), n.get())
t2 = tk.Text(tk.Tk()); t2.insert("1.0", "define def\nundef def x")
print(t2.search(r"\mdef\M", "1.0", regexp=True))
t3 = tk.Text(tk.Tk()); t3.insert("1.0", "xaaa")
print(t3.search("aa", "end", backwards=True))
try:
    t3.search("(", "1.0", regexp=True)
except tk.TclError:
    print("TclError")
`);
    expect(sortie.split("\n")).toEqual(["4.0 5.0 2.14 13", "1.7", "1.2", "TclError"]);
  });

  it("Text : tag_nextrange / tag_prevrange renvoient la plage entière (navigation « suivant »)", () => {
    const sortie = executer(String.raw`
import tkinter as tk
t = tk.Text(tk.Tk())
t.insert("1.0", "abc\nxx\nyy\nhello")
t.tag_add("k", "1.0", "1.3"); t.tag_add("k", "4.0", "4.5")
print(t.tag_nextrange("k", "1.1"), t.tag_prevrange("k", "4.2"), t.tag_nextrange("k", "1.0"))
`);
    expect(sortie).toBe("('4.0', '4.5') ('4.0', '4.5') ('1.0', '1.3')");
  });

  it("Text : une suite d'insertions forme un seul pas d'annulation (autoseparators)", () => {
    const sortie = executer(String.raw`
import tkinter as tk
t = tk.Text(tk.Tk(), undo=True)
for i in range(500):
    t.insert("end", f"ligne {i}\n")
print(len(t._annuler))
t.edit_undo()
print(repr(t.get("1.0", "end")))
t.insert("end", "a"); t.delete("1.0"); t.insert("end", "b")
print(len(t._annuler))
`);
    expect(sortie.split("\n")).toEqual(["1", "'\\n'", "3"]);
  });

  it("Listbox : get / delete acceptent lb.curselection() (1-tuple)", () => {
    const sortie = executer(String.raw`
import tkinter as tk
lb = tk.Listbox(tk.Tk())
lb.insert("end", "Pain", "Lait", "Oeufs")
print(lb.get((1,)))
lb.delete((1,))
print(lb.get(0, "end"))
try:
    lb.get(())
except tk.TclError:
    print("TclError")
`);
    expect(sortie.split("\n")).toEqual(["Lait", "('Pain', 'Oeufs')", "TclError"]);
  });

  it("Treeview : tree.item(tree.selection()), et déplacement sous un descendant refusé", () => {
    const sortie = executer(String.raw`
import tkinter as tk
from tkinter import ttk
tree = ttk.Treeview(tk.Tk(), columns=("nom",))
a = tree.insert("", "end", text="docs", values=("A",))
b = tree.insert(a, "end", text="photos", values=("B",))
c = tree.insert(b, "end", text="vacances")
tree.selection_set(b)
print(tree.item(tree.selection())["values"], tree.index(tree.selection()), tree.exists(tree.selection()))
for x, p in ((a, c), (b, b)):
    try:
        tree.move(x, p, "end")
    except tk.TclError as e:
        print(e)
print(tree.get_children(""), tree.parent(c))
`);
    expect(sortie.split("\n")).toEqual(["['B'] 0 True", "Cannot insert I001 as descendant of I003", "Cannot insert I002 as descendant of I002", "('I001',) I002"]);
  });

  it("Notebook : page détruite retirée (onglet voisin choisi), onglet désactivé non sélectionnable", () => {
    const sortie = executer(String.raw`
import tkinter as tk, js
from tkinter import ttk
root = tk.Tk()
nb = ttk.Notebook(root)
evts = []
nb.bind("<<NotebookTabChanged>>", lambda e: evts.append(nb.index("current")))
pages = [ttk.Frame(nb) for _ in range(3)]
for i, p in enumerate(pages):
    nb.add(p, text=str(i))
externe = ttk.Frame(root)
nb.add(externe, text="ext")
js.vider()
nb.select(pages[2]); js.vider()
pages[2].destroy(); js.vider()
print(len(nb.tabs()), nb.index("current"), evts)
nb.tab(0, state="disabled"); nb.select(0)
print(nb.index("current"))
try:
    nb.add(ttk.Frame(tk.Toplevel(root)))
except tk.TclError:
    print("TclError")
`);
    expect(sortie.split("\n")).toEqual(["3 2 [0, 2, 2]", "2", "TclError"]);
  });

  it("OptionMenu['menu'] : index par libellé, delete d'une entrée, command des entrées reconstruites", () => {
    const sortie = executer(String.raw`
import tkinter as tk
root = tk.Tk()
v = tk.StringVar(value="Rouge")
om = tk.OptionMenu(root, v, "Rouge", "Vert", "Bleu")
m = om["menu"]
print(m.index("Vert"), m.index("end"))
m.delete(m.index("Vert"))
print(om._liste)
journal = []
m.delete(0, "end")
for x in ("Un", "Deux"):
    m.add_command(label=x, command=lambda x=x: journal.append(x))
om._recevoir("commande", {"index": 1, "valeur": "Deux"})
print(journal, v.get())
`);
    expect(sortie.split("\n")).toEqual(["1 2", "['Rouge', 'Bleu']", "['Deux'] Rouge"]);
  });

  it("Canvas : find_overlapping / find_closest selon la forme réelle, éléments cachés ignorés", () => {
    const sortie = executer(String.raw`
import tkinter as tk
c = tk.Canvas(tk.Tk(), width=300, height=300)
c.create_line(0, 0, 300, 300, width=3)
c.create_oval(100, 0, 200, 100, fill="red")
c.create_rectangle(250, 0, 300, 50, state="hidden")
c.create_oval(20, 200, 60, 240, fill="green")
c.create_line(10, 290, 290, 150)
print(c.find_overlapping(275, 15, 285, 25), c.find_overlapping(101, 1, 103, 3), c.find_closest(290, 10), c.find_enclosed(240, -10, 310, 60), c.find_closest(40, 220))
`);
    expect(sortie).toBe("() () (2,) () (4,)");
  });

  it("PhotoImage : zoom / copy copient les pixels (même juste après put), GIF et PPM lus pixel par pixel", () => {
    const sortie = executer(String.raw`
import tkinter as tk, base64
root = tk.Tk()
img = tk.PhotoImage(width=4, height=4)
img.put("#ff0000", to=(0, 0, 2, 2)); img.put("#0000ff", to=(2, 0, 4, 4))
g = img.zoom(20)
print(g.width(), g.height(), g.get(45, 5), g.get(1, 0), img.subsample(2).width(), img.copy().get(3, 3))
gif = tk.PhotoImage(data="R0lGODlhKAAoAIEAAP8AAACgAAAA/////ywAAAAAKAAoAAAC/wQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIECBAgAATJkyYMGHChAkTJgQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIECBAgAATJkyYMGHChAkTJgQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIECBAgAATJkyYMGHChAkTJgQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIECBAgAATJkyYMGHChAkTJgQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIECBAgAATJkyYMGHChAkTJgQIECBAgAABAgQIMGHChAkTJkyYMGFCgAABAgQIEP8gQIAAEyZMmDBhwoQJEyYECBAgQIAAAQIECDBhwoQJEyZMmDBhQoAAAQIECBAgQIAAEyZMmDBhwoQJEyYECBAgQIAAAQIECDBhwoQJEyZMmDBhQoAAAQIECBAgQIAAEyZMmDBhwoQJEyYECBAgQIAAAQIECDBhwoQJEyZMmDBhQoAAAQIECBAgQIAAEyZMmDBhwoQJEyYECBAgQIAAAQIECDBhwoQJEyZMmDBhQoAAAQIECBAgQIAAEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoQJEyZMmDBhwoT/CRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmTJgwYcKECRMmiEyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTJkyYMGHChAkTRgUAOw==")
print(gif.width(), gif.get(5, 5), gif.get(30, 30), gif.get(39, 39))
gif.put("#ffff00", to=(30, 0, 40, 10))
print(gif.get(5, 5), gif.get(35, 5))
ppm = tk.PhotoImage(data=b"P6 2 1 255 " + bytes([255, 128, 0, 1, 2, 3]))
print(ppm.width(), ppm.get(0, 0), ppm.get(1, 0))
`);
    expect(sortie.split("\n")).toEqual([
      "80 80 (0, 0, 255) (255, 0, 0) 2 (0, 0, 255)",
      "40 (255, 0, 0) (0, 160, 0) (0, 0, 255)",
      "(255, 0, 0) (255, 255, 0)",
      "2 (255, 128, 0) (1, 2, 3)",
    ]);
  });

  it("update() lève TclError une fois la fenêtre principale détruite (fin des boucles de jeu)", () => {
    const sortie = executer(String.raw`
import tkinter as tk
root = tk.Tk()
c = tk.Canvas(root)
r = c.create_rectangle(0, 0, 10, 10)
root.update()
root.destroy()
for f in (root.update, lambda: c.move(r, 1, 0)):
    try:
        f()
        print("pas d'erreur")
    except tk.TclError as e:
        print("TclError")
`);
    expect(sortie.split("\n")).toEqual(["TclError", "TclError"]);
  });

  it("Double / triple clic : la liaison la plus précise seulement (comme Tk)", () => {
    const sortie = executer(String.raw`
import tkinter as tk
c = tk.Canvas(tk.Tk())
journal = []
c.bind("<Button-1>", lambda e: journal.append("simple"))
c.bind("<Double-Button-1>", lambda e: journal.append("double"))
for clics in (1, 2):
    c._recevoir("mousedown", {"bouton": 1, "clics": clics, "x": 5, "y": 5})
print(journal)
c.bind("<Triple-Button-1>", lambda e: journal.append("triple"))
journal.clear()
for clics in (1, 2, 3):
    c._recevoir("mousedown", {"bouton": 1, "clics": clics, "x": 5, "y": 5})
print(journal)
`);
    expect(sortie.split("\n")).toEqual(["['simple', 'double']", "['simple', 'double', 'triple']"]);
  });
});
