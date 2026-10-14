"use client";

/**
 * Exécution de Python DANS LE NAVIGATEUR de l'utilisateur, via Pyodide (CPython compilé en
 * WebAssembly). Tout tourne dans l'onglet de l'utilisateur, dans le bac à sable du navigateur :
 * aucun accès au serveur, à ses clés ni aux données des autres comptes. C'est ce qui permet
 * d'offrir « Python intégré » à tout le monde sans faille de sécurité.
 *
 * Pyodide (~10 Mo) n'est chargé qu'au premier « Exécuter », depuis le CDN jsDelivr.
 */
import { codeChargementPip } from "./pip-console";
import { cheminConsole, projetConsole } from "./projet-console";
import { indiceShell, transformerPip } from "./python-shell";

const VERSION = "0.26.4";
const BASE = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
/** Dossier courant de Python dans Pyodide : les fichiers du projet et les imports y sont copiés. */
export const DOSSIER_CONSOLE = "/home/pyodide";

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
  loadPackagesFromImports(code: string): Promise<void>;
  loadPackage(nom: string): Promise<void>;
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

/** Charge Pyodide une seule fois (partagé par toute la page). */
export function chargerPyodide(onProgres?: (etape: string) => void): Promise<Pyodide> {
  if (!window.__pyodide) {
    window.__pyodide = (async () => {
      onProgres?.("Téléchargement de Python (une fois)…");
      await chargerScript(`${BASE}pyodide.js`);
      if (!window.loadPyodide) throw new Error("Pyodide indisponible.");
      const py = await window.loadPyodide({ indexURL: BASE });
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
}

/**
 * Exécute du code Python et renvoie sa sortie (stdout + stderr). Installe automatiquement les
 * paquets importés disponibles dans Pyodide (numpy, pandas…) ; les commandes pip (toutes formes,
 * y compris « pip install -r requirements.txt ») passent par micropip.
 */
export async function executerPython(code: string, onProgres?: (etape: string) => void): Promise<ResultatExecution> {
  const py = await chargerPyodide(onProgres);
  const morceaux: string[] = [];
  py.setStdout({ batched: (s) => morceaux.push(s) });
  py.setStderr({ batched: (s) => morceaux.push(s) });
  synchroniserProjet(py);
  const { code: codeExec, pip } = transformerPip(code);
  try {
    if (pip) {
      onProgres?.("Installation des paquets…");
      await preparerPip(py);
    } else {
      onProgres?.("Installation des dépendances…");
    }
    await py.loadPackagesFromImports(codeExec).catch(() => {});
    onProgres?.("Exécution…");
    const valeur = await py.runPythonAsync(codeExec);
    const sortie = morceaux.join("");
    const rendu = valeur === undefined || valeur === null ? "" : String(valeur);
    return { sortie: [sortie, rendu && !sortie.endsWith(rendu) ? rendu : ""].filter(Boolean).join(sortie && rendu ? "\n" : "") };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Commande shell / outil de build tapé par réflexe : on montre l'aide seule, sans le traceback.
    const indice = indiceShell(code, message);
    return { sortie: morceaux.join(""), erreur: indice ?? message };
  }
}
