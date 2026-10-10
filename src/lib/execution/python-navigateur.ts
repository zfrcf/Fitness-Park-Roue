"use client";

/**
 * Exécution de Python DANS LE NAVIGATEUR de l'utilisateur, via Pyodide (CPython compilé en
 * WebAssembly). Tout tourne dans l'onglet de l'utilisateur, dans le bac à sable du navigateur :
 * aucun accès au serveur, à ses clés ni aux données des autres comptes. C'est ce qui permet
 * d'offrir « Python intégré » à tout le monde sans faille de sécurité.
 *
 * Pyodide (~10 Mo) n'est chargé qu'au premier « Exécuter », depuis le CDN jsDelivr.
 */
const VERSION = "0.26.4";
const BASE = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
  loadPackagesFromImports(code: string): Promise<void>;
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

export interface ResultatExecution {
  sortie: string;
  erreur?: string;
}

/**
 * Exécute du code Python et renvoie sa sortie (stdout + stderr). Installe automatiquement les
 * paquets importés disponibles dans Pyodide (numpy, pandas…).
 */
export async function executerPython(code: string, onProgres?: (etape: string) => void): Promise<ResultatExecution> {
  const py = await chargerPyodide(onProgres);
  const morceaux: string[] = [];
  py.setStdout({ batched: (s) => morceaux.push(s) });
  py.setStderr({ batched: (s) => morceaux.push(s) });
  try {
    onProgres?.("Installation des dépendances…");
    await py.loadPackagesFromImports(code).catch(() => {});
    onProgres?.("Exécution…");
    const valeur = await py.runPythonAsync(code);
    const sortie = morceaux.join("");
    const rendu = valeur === undefined || valeur === null ? "" : String(valeur);
    return { sortie: [sortie, rendu && !sortie.endsWith(rendu) ? rendu : ""].filter(Boolean).join(sortie && rendu ? "\n" : "") };
  } catch (e) {
    return { sortie: morceaux.join(""), erreur: e instanceof Error ? e.message : String(e) };
  }
}
