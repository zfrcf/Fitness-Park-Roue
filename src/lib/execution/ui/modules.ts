/**
 * Modules Python écrits dans Pyodide au premier chargement (dossier ajouté en tête de sys.path) :
 * tkinter (+ ttk, dialogues…), turtle, lancement des programmes, matplotlib, cales d'import.
 */
import { CALE_IMAGETK, CALE_TKAGG, MPL, RUN, TKINTER_NATIF } from "./lanceur";
import { TK_COLORCHOOSER, TK_COMMONDIALOG, TK_CONSTANTS, TK_DIALOG, TK_FILEDIALOG, TK_FONT, TK_MESSAGEBOX, TK_SCROLLEDTEXT, TK_SIMPLEDIALOG, TK_TTK } from "./tk-annexes";
import { TK_INIT } from "./tk-noyau";
import { TURTLE } from "./turtle";

export const DOSSIER_MODULES = "/lib/atelier";

export const MODULES_PYTHON: Record<string, string> = {
  "tkinter/__init__.py": TK_INIT,
  "tkinter/constants.py": TK_CONSTANTS,
  "tkinter/font.py": TK_FONT,
  "tkinter/ttk.py": TK_TTK,
  "tkinter/messagebox.py": TK_MESSAGEBOX,
  "tkinter/simpledialog.py": TK_SIMPLEDIALOG,
  "tkinter/filedialog.py": TK_FILEDIALOG,
  "tkinter/colorchooser.py": TK_COLORCHOOSER,
  "tkinter/scrolledtext.py": TK_SCROLLEDTEXT,
  "tkinter/commondialog.py": TK_COMMONDIALOG,
  "tkinter/dialog.py": TK_DIALOG,
  "_tkinter.py": TKINTER_NATIF,
  "turtle.py": TURTLE,
  "atelier_run.py": RUN,
  "atelier_mpl.py": MPL,
  "atelier_cales/tkagg.py": CALE_TKAGG,
  "atelier_cales/imagetk.py": CALE_IMAGETK,
};
