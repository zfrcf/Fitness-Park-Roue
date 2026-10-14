"use client";

/**
 * Exécution de Python DANS LE NAVIGATEUR de l'utilisateur, via Pyodide (CPython compilé en
 * WebAssembly). Tout tourne dans l'onglet de l'utilisateur, dans le bac à sable du navigateur :
 * aucun accès au serveur, à ses clés ni aux données des autres comptes. C'est ce qui permet
 * d'offrir « Python intégré » à tout le monde sans faille de sécurité.
 *
 * Pyodide (~10 Mo) n'est chargé qu'au premier « Exécuter », depuis le CDN jsDelivr (ou l'adresse
 * NEXT_PUBLIC_PYODIDE_URL). Les programmes à interface (tkinter, turtle) ouvrent des fenêtres dans
 * la page ; matplotlib affiche ses figures comme images ; input() ouvre une boîte de saisie.
 */
import { codeChargementPip } from "./pip-console";
import { cheminConsole, projetConsole } from "./projet-console";
import { indiceShell, transformerCommandes } from "./python-shell";
import { moteurFenetres } from "./ui/fenetres";
import { DOSSIER_MODULES, MODULES_PYTHON } from "./ui/modules";

const VERSION = "0.26.4";
const BASE = process.env.NEXT_PUBLIC_PYODIDE_URL || `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
/** Dossier courant de Python dans Pyodide : les fichiers du projet et les imports y sont copiés. */
export const DOSSIER_CONSOLE = "/home/pyodide";

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  setStdout(opts: { write: (b: Uint8Array) => number }): void;
  setStderr(opts: { write: (b: Uint8Array) => number }): void;
  loadPackagesFromImports(code: string): Promise<void>;
  loadPackage(nom: string): Promise<void>;
  registerJsModule(nom: string, module: object): void;
  FS: {
    writeFile(chemin: string, donnees: string | Uint8Array): void;
    readFile(chemin: string, opts: { encoding: "utf8" }): string;
    unlink(chemin: string): void;
    mkdirTree(chemin: string): void;
  };
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<Pyodide>;
    __pyodide?: Promise<Pyodide>;
  }
}

/** Morceau de sortie d'un programme : texte (sortie standard ou d'erreur) ou image (matplotlib). */
export type Morceau = { texte: string; erreur?: boolean } | { image: string };

/* Routage de la sortie : pendant une exécution, vers son résultat ; ensuite (rappels de boutons,
   minuteries, fenêtres), vers le dernier lanceur qui s'est inscrit. */
let sortieCourante: ((m: Morceau) => void) | null = null;
let sortieTardive: ((m: Morceau) => void) | null = null;
let recente = "";

function emettre(m: Morceau) {
  if ("texte" in m) recente = (recente + m.texte).slice(-6000);
  (sortieCourante ?? sortieTardive)?.(m);
}

/** input() : boîte de saisie du navigateur, avec les dernières lignes affichées par le programme. */
function demanderSaisie(): string | null {
  const contexte = recente.split("\n").slice(-14).join("\n").trimStart();
  recente = "";
  return window.prompt(contexte || "Le programme attend une saisie :", "");
}

function chargerScript(src: string): Promise<void> {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[data-pyodide]`)) return ok();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.pyodide = "1";
    s.onload = () => ok();
    s.onerror = () => ko(new Error("Chargement de Pyodide impossible (hors ligne ?)."));
    document.head.appendChild(s);
  });
}

/** Installe dans Pyodide les flux de sortie, le moteur des fenêtres et nos modules Python. */
function preparer(py: Pyodide) {
  const sortie = new TextDecoder();
  const erreurs = new TextDecoder();
  py.setStdout({
    write: (b) => {
      emettre({ texte: sortie.decode(b, { stream: true }) });
      return b.length;
    },
  });
  py.setStderr({
    write: (b) => {
      emettre({ texte: erreurs.decode(b, { stream: true }), erreur: true });
      return b.length;
    },
  });
  py.registerJsModule("atelier_ui", {
    ...moteurFenetres,
    image: (src: string) => emettre({ image: src }),
    saisie: () => demanderSaisie(),
  });
  for (const [chemin, source] of Object.entries(MODULES_PYTHON)) {
    const complet = `${DOSSIER_MODULES}/${chemin}`;
    py.FS.mkdirTree(complet.slice(0, complet.lastIndexOf("/")));
    py.FS.writeFile(complet, source);
  }
  py.runPython(`import sys\nif ${JSON.stringify(DOSSIER_MODULES)} not in sys.path: sys.path.insert(0, ${JSON.stringify(DOSSIER_MODULES)})\nimport atelier_run`);
}

/** Charge Pyodide une seule fois (partagé par toute la page). */
export function chargerPyodide(onProgres?: (etape: string) => void): Promise<Pyodide> {
  if (!window.__pyodide) {
    window.__pyodide = (async () => {
      onProgres?.("Téléchargement de Python (une fois)…");
      await chargerScript(`${BASE}pyodide.js`);
      if (!window.loadPyodide) throw new Error("Pyodide indisponible.");
      const py = await window.loadPyodide({ indexURL: BASE });
      preparer(py);
      return py;
    })().catch((e) => {
      window.__pyodide = undefined; // permet de réessayer
      throw e;
    });
  }
  return window.__pyodide;
}

/** Écrit un fichier dans le dossier de la console (crée les sous-dossiers). Renvoie le chemin relatif, ou null. */
function ecrire(py: Pyodide, chemin: string, donnees: string | Uint8Array): string | null {
  const sur = cheminConsole(chemin);
  if (!sur) return null;
  const complet = `${DOSSIER_CONSOLE}/${sur}`;
  const dossier = complet.slice(0, complet.lastIndexOf("/"));
  if (dossier) py.FS.mkdirTree(dossier);
  py.FS.writeFile(complet, donnees);
  return sur;
}

/**
 * Copie les fichiers du projet de la conversation dans la console. Seuls les fichiers dont le
 * contenu a changé côté projet sont réécrits : une modification faite depuis Python est conservée
 * tant que le projet ne change pas ce fichier. Les copies d'un projet quitté (autre conversation)
 * sont retirées, sauf si elles ont été modifiées depuis Python.
 */
const copies = new Map<string, string>();
function synchroniserProjet(py: Pyodide): void {
  const actuels = new Set(projetConsole().map((f) => f.chemin));
  for (const [chemin, contenu] of copies) {
    if (actuels.has(chemin)) continue;
    copies.delete(chemin);
    const sur = cheminConsole(chemin);
    try {
      if (sur && py.FS.readFile(`${DOSSIER_CONSOLE}/${sur}`, { encoding: "utf8" }) === contenu) py.FS.unlink(`${DOSSIER_CONSOLE}/${sur}`);
    } catch {
      /* déjà supprimé depuis Python */
    }
  }
  for (const f of projetConsole()) {
    if (copies.get(f.chemin) === f.contenu) continue;
    try {
      if (ecrire(py, f.chemin, f.contenu)) copies.set(f.chemin, f.contenu);
    } catch {
      /* chemin refusé par le système de fichiers : ignoré */
    }
  }
}

/** Fichiers choisis par l'utilisateur (bouton « Importer ») copiés dans la console. */
export async function importerFichiersConsole(liste: FileList | File[], onProgres?: (etape: string) => void): Promise<string[]> {
  const py = await chargerPyodide(onProgres);
  const ecrits: string[] = [];
  for (const f of Array.from(liste)) {
    const chemin = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const sur = ecrire(py, chemin, new Uint8Array(await f.arrayBuffer()));
    if (sur) ecrits.push(sur);
  }
  return ecrits;
}

/** micropip + le module pip de la console, chargés une seule fois. */
let pipPret: Promise<void> | null = null;
function preparerPip(py: Pyodide): Promise<void> {
  pipPret ??= (async () => {
    await py.loadPackage("micropip");
    py.runPython(codeChargementPip());
  })().catch((e) => {
    pipPret = null;
    throw e;
  });
  return pipPret;
}

export interface ResultatExecution {
  sortie: string;
  erreur?: string;
  images: string[];
}

export interface OptionsExecution {
  /** Reçoit ce que le programme affiche APRÈS la fin de l'exécution (clics, minuteries, fenêtres). */
  sortieTardive?: (m: Morceau) => void;
}

/**
 * Exécute du code Python et renvoie sa sortie exacte (stdout, stderr, images). Charge les paquets
 * importés (distribution Pyodide, sinon PyPI) ; les commandes pip et « python fichier.py » sont
 * traduites ; les fenêtres tkinter/turtle restent ouvertes et actives après la fin.
 */
export async function executerPython(code: string, onProgres?: (etape: string) => void, options: OptionsExecution = {}): Promise<ResultatExecution> {
  const py = await chargerPyodide(onProgres);
  const res = { sortie: "", erreur: "", images: [] as string[] };
  sortieCourante = (m) => {
    if ("image" in m) res.images.push(m.image);
    else if (m.erreur) res.erreur += m.texte;
    else res.sortie += m.texte;
  };
  if (options.sortieTardive) sortieTardive = options.sortieTardive;
  recente = "";
  synchroniserProjet(py);
  const { code: codeExec, pip } = transformerCommandes(code);
  try {
    if (pip) {
      onProgres?.("Installation des paquets…");
      await preparerPip(py);
    } else {
      onProgres?.("Installation des dépendances…");
    }
    await py.loadPackagesFromImports(codeExec).catch(() => {});
    py.runPython("import atelier_run\natelier_run._debut_execution()");
    await (py.runPythonAsync(`import atelier_run\nawait atelier_run.preparer_imports(${JSON.stringify(code)})`) as Promise<unknown>).catch(() => {});
    onProgres?.("Exécution…");
    const valeur = await py.runPythonAsync(codeExec);
    py.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()");
    const rendu = valeur === undefined || valeur === null ? "" : String(valeur);
    const sortie = res.sortie;
    return {
      sortie: rendu && !sortie.endsWith(`${rendu}\n`) ? `${sortie}${sortie && !sortie.endsWith("\n") ? "\n" : ""}${rendu}` : sortie,
      erreur: res.erreur || undefined,
      images: res.images,
    };
  } catch (e) {
    try {
      py.runPython("import sys\nsys.stdout.flush()\nsys.stderr.flush()");
    } catch {
      /* rien */
    }
    const message = e instanceof Error ? e.message : String(e);
    // Commande shell / outil de build tapé par réflexe : on montre l'aide seule, sans le traceback.
    const indice = indiceShell(code, message);
    return { sortie: res.sortie, erreur: indice ?? (res.erreur + nettoyerTraceback(message)), images: res.images };
  } finally {
    sortieCourante = null;
  }
}

/** Retire du traceback les cadres internes de Pyodide (« File "/lib/python312.zip/_pyodide/… »). */
export function nettoyerTraceback(message: string): string {
  const lignes = message.split("\n");
  const sortie: string[] = [];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s+File "\/lib\/python3\d+\.zip\/(_pyodide|pyodide)\//.test(l)) {
      if (lignes[i + 1] && /^\s{4,}\S/.test(lignes[i + 1]) && !/^\s+File /.test(lignes[i + 1])) i++;
      while (lignes[i + 1] && /^\s+[\^~]+\s*$/.test(lignes[i + 1])) i++;
      continue;
    }
    sortie.push(l);
  }
  return sortie.join("\n").trim();
}
