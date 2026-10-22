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
import { ajouterMorceau, dernierTexte, imagesDe, texteDuFlux, type Morceau } from "./morceaux";
import { codeChargementPip } from "./pip-console";
import { cheminConsole, projetConsole } from "./projet-console";
import { indiceShell, transformerCommandes } from "./python-shell";
import { fermerToutesFenetres, moteurFenetres } from "./ui/fenetres";
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
  pyimport(nom: string): ModuleAtelierRun;
  FS: {
    writeFile(chemin: string, donnees: string | Uint8Array): void;
    readFile(chemin: string, opts: { encoding: "utf8" }): string;
    unlink(chemin: string): void;
    mkdirTree(chemin: string): void;
  };
}

/** Module Python `atelier_run` vu depuis JavaScript (PyProxy). */
interface ModuleAtelierRun {
  cellule(code: string, ident: number): Promise<unknown>;
  preparer(code: string, ident: number): Promise<unknown>;
  interrompre(): void;
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<Pyodide>;
    __pyodide?: Promise<Pyodide>;
  }
}

export type { Morceau } from "./morceaux";

/** Module `atelier_run` (PyProxy gardé pour toute la page, comme Pyodide). */
let atelierRun: ModuleAtelierRun | null = null;

/** Options passées à l'interface quand le programme attend une ligne (input(), sys.stdin, getpass). */
export interface OptionsSaisie {
  /** Saisie masquée (getpass) : la réponse n'est pas réécrite dans la sortie. */
  masque?: boolean;
  /** Lecture de sys.stdin : Échap signale la fin du fichier au lieu d'interrompre le programme. */
  finDeFichier?: boolean;
  /** Déclenché quand la demande est abandonnée (Arrêter, fin du programme) : l'interface retire le champ. */
  signal: AbortSignal;
}

/** Réponse de l'interface : le texte, null = annulé (Échap), false = plus aucune saisie possible (console fermée). */
export type GestionnaireSaisie = (invite: string, options: OptionsSaisie) => Promise<string | null | false>;

/* Routage de la sortie : chaque écriture du Python porte l'identifiant de l'exécution qui l'a produite
   (contexte asyncio de sa cellule, hérité par ses tâches) et part vers cette exécution, même si une autre a
   démarré entre-temps ; une fois l'exécution finie, vers sa sortie tardive. Sans identifiant (rappels de
   boutons, minuteries), vers l'exécution en cours la plus récente, sinon vers le dernier lanceur inscrit. */
interface ExecutionActive {
  id: number;
  recevoir: (m: Morceau) => void;
  saisie?: GestionnaireSaisie;
  /** Visée par « Arrêter » : si elle en était encore à sa préparation (paquets), son code n'est pas lancé. */
  arretee: boolean;
  /** Interpréteur planté : l'exécution cesse d'attendre une cellule qui ne se terminera jamais. */
  abandonner: (e: Error) => void;
}
const pileSorties: ExecutionActive[] = [];
let sortieTardive: ((m: Morceau) => void) | null = null;
/** Sortie tardive de chaque exécution récente (identifiant → réception), bornée. */
const tardives = new Map<number, (m: Morceau) => void>();
let prochaineExecution = 1;
let recente = "";

function executionDe(ident: unknown): ExecutionActive | undefined {
  return typeof ident === "number" ? pileSorties.find((e) => e.id === ident) : undefined;
}

function emettre(m: Morceau, ident?: unknown) {
  if ("texte" in m) recente = (recente + m.texte).slice(-6000);
  const cible = executionDe(ident)?.recevoir ?? (typeof ident === "number" ? tardives.get(ident) : undefined) ?? pileSorties[pileSorties.length - 1]?.recevoir ?? sortieTardive;
  cible?.(m);
}

/* Arrêt (bouton « Arrêter ») : comme un Ctrl+C, un signal PONCTUEL. Chaque clic incrémente numeroArret ; une
   attente Python (sleep, input, update, mainloop…) lève KeyboardInterrupt si le numéro a changé PENDANT
   qu'elle attendait, puis le signale (arretVu). Avec JSPI, le clic ne peut arriver que pendant une attente :
   seules les attentes en cours au moment du clic sont interrompues ; le code de nettoyage (except, finally)
   et les exécutions lancées ensuite attendent normalement. */
let numeroArret = 0;
/** Un arrêt a été demandé et aucune attente ne l'a encore vu (arretDemande() côté Python). */
let arretEnAttente = false;
/** Attentes de dormir() en cours : réveillées tout de suite par « Arrêter ». */
const reveilsArret = new Set<() => void>();
/** Programmes en attente dans mainloop() / wait_window() (le programme tourne mais attend l'utilisateur). */
let attentes = 0;
const ecouteursEtat = new Set<() => void>();

function signalerEtat() {
  for (const f of ecouteursEtat) f();
}

/** L'arrêt demandé ne vise plus personne (toutes les exécutions visées sont finies) : il n'est pas hérité. */
function oublierArretSansCible() {
  if (!pileSorties.some((e) => e.arretee)) arretEnAttente = false;
}

/**
 * Arrête les programmes en cours AU MOMENT DU CLIC : fenêtres fermées, attentes en cours interrompues
 * (KeyboardInterrupt), tâches asyncio annulées, saisies abandonnées. Une exécution lancée ensuite n'est
 * pas touchée et n'annule pas cet arrêt.
 */
export function arreterExecution(): void {
  numeroArret++;
  arretEnAttente = true;
  for (const e of pileSorties) e.arretee = true;
  for (const reveiller of [...reveilsArret]) reveiller();
  annulerSaisies("arret");
  try {
    atelierRun?.interrompre();
  } catch {
    /* Python occupé ou pas encore chargé */
  }
  fermerToutesFenetres();
  signalerEtat();
}

/** Promesse résolue après `ms` millisecondes, ou tout de suite au prochain clic sur « Arrêter ». */
function dormir(ms: number): Promise<void> {
  return new Promise((ok) => {
    const fin = () => {
      clearTimeout(minuterie);
      reveilsArret.delete(fin);
      ok();
    };
    const minuterie = setTimeout(fin, Math.max(0, Number(ms) || 0));
    reveilsArret.add(fin);
  });
}

/** Nombre d'exécutions en cours et d'attentes (mainloop) : pour l'interface et le banc d'essai. */
export function etatExecution(): { enCours: number; attentes: number } {
  return { enCours: pileSorties.length, attentes };
}

export function abonnerEtatExecution(f: () => void): () => void {
  ecouteursEtat.add(f);
  return () => ecouteursEtat.delete(f);
}

/* Lecture d'une ligne avec JSPI (input(), sys.stdin, getpass) : dans l'interface qui a lancé l'exécution
   (ligne de la console), sinon boîte du navigateur. Les demandes passent une à une, dans l'ordre (deux
   rappels qui appellent input() : la seconde attend la réponse à la première, comme avec Tk). */
type FinSaisie = "annule" | "eof" | "arret";
/** Résultat vu par le Python : [genre, texte], genre = "texte" ou une fin de saisie. */
type ResultatSaisie = [string, string];
interface DemandeSaisie {
  invite: string;
  ident: unknown;
  masque: boolean;
  finDeFichier: boolean;
  proprietaire: ExecutionActive;
  abandon: AbortController;
  presentee: boolean;
  finir: (r: ResultatSaisie) => void;
}
const fileSaisies: DemandeSaisie[] = [];

function presenterSaisieSuivante() {
  const d = fileSaisies[0];
  if (!d || d.presentee || !d.proprietaire.saisie) return;
  d.presentee = true;
  // L'invite s'affiche quand SA demande est présentée (deux rappels : la seconde invite après la première réponse).
  if (d.invite) emettre({ texte: d.invite }, d.ident);
  recente = "";
  d.proprietaire.saisie(d.invite, { masque: d.masque, finDeFichier: d.finDeFichier, signal: d.abandon.signal }).then(
    (v) => terminerSaisie(d, typeof v === "string" ? ["texte", v] : [v === false ? "eof" : "annule", ""]),
    () => terminerSaisie(d, ["annule", ""]),
  );
}

function terminerSaisie(d: DemandeSaisie, r: ResultatSaisie) {
  const i = fileSaisies.indexOf(d);
  if (i < 0) return; // déjà terminée
  fileSaisies.splice(i, 1);
  if (r[0] !== "texte") d.abandon.abort();
  d.finir(r);
  presenterSaisieSuivante();
}

/** Abandonne les saisies en attente (toutes, ou celles d'une exécution) : le Python reçoit `genre`. */
function annulerSaisies(genre: FinSaisie, de?: ExecutionActive) {
  const visees = fileSaisies.filter((d) => !de || d.proprietaire === de);
  for (const d of visees) fileSaisies.splice(fileSaisies.indexOf(d), 1);
  for (const d of visees) {
    d.abandon.abort();
    d.finir([genre, ""]);
  }
  presenterSaisieSuivante();
}

function lireLigne(invite: string, masque: boolean, finDeFichier: boolean, ident: unknown): Promise<ResultatSaisie> {
  const proprietaire = executionDe(ident) ?? pileSorties[pileSorties.length - 1];
  if (!proprietaire?.saisie) {
    if (invite) emettre({ texte: invite }, ident);
    const v = demanderSaisie();
    return Promise.resolve(v === null ? ["annule", ""] : ["texte", v]);
  }
  return new Promise((finir) => {
    fileSaisies.push({ invite, ident, masque, finDeFichier, proprietaire, abandon: new AbortController(), presentee: false, finir });
    presenterSaisieSuivante();
  });
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
  // Ce qu'écrit encore un interpréteur planté (et remplacé) est ignoré.
  const vivant = () => !plantes.has(py);
  py.setStdout({
    write: (b) => {
      if (vivant()) emettre({ texte: sortie.decode(b, { stream: true }) });
      return b.length;
    },
  });
  py.setStderr({
    write: (b) => {
      if (vivant()) emettre({ texte: erreurs.decode(b, { stream: true }), erreur: true });
      return b.length;
    },
  });
  py.registerJsModule("atelier_ui", {
    ...moteurFenetres,
    /** sys.stdout / sys.stderr du lanceur : texte écrit par l'exécution `ident` (null = hors exécution). */
    sortie: (texte: string, erreur?: boolean, ident?: number | null) => {
      if (vivant()) emettre(erreur ? { texte: String(texte), erreur: true } : { texte: String(texte) }, ident);
    },
    image: (src: string, figure?: number, ident?: number | null) => {
      if (vivant()) emettre(typeof figure === "number" ? { image: src, figure } : { image: src }, ident);
    },
    saisie: () => demanderSaisie(),
    /** Une ligne tapée par l'utilisateur (JSPI ; l'invite est affichée ici) : [genre, texte], genre « texte », « annule », « eof » ou « arret ». */
    lireLigne: (invite: string, masque?: boolean, finDeFichier?: boolean, ident?: number | null) => lireLigne(String(invite ?? ""), Boolean(masque), Boolean(finDeFichier), ident),
    /** Ancienne forme de lireLigne (texte, ou null si la saisie n'a pas abouti). */
    saisieAsync: (invite: string) => lireLigne(String(invite ?? ""), false, false, null).then(([genre, texte]) => (genre === "texte" ? texte : null)),
    /* Arrêt : numéro à relever avant une attente et à comparer après (arrêt arrivé pendant l'attente),
       booléen « arrêt pas encore vu », accusé de réception, pause interrompue par l'arrêt. */
    numeroArret: () => numeroArret,
    arretDemande: () => arretEnAttente,
    arretVu: () => {
      arretEnAttente = false;
    },
    dormir: (ms: number) => dormir(ms),
    attente: (delta: number) => {
      attentes = Math.max(0, attentes + delta);
      signalerEtat();
    },
  });
  for (const [chemin, source] of Object.entries(MODULES_PYTHON)) {
    const complet = `${DOSSIER_MODULES}/${chemin}`;
    py.FS.mkdirTree(complet.slice(0, complet.lastIndexOf("/")));
    py.FS.writeFile(complet, source);
  }
  py.runPython(`import sys\nif ${JSON.stringify(DOSSIER_MODULES)} not in sys.path: sys.path.insert(0, ${JSON.stringify(DOSSIER_MODULES)})\nimport atelier_run`);
  atelierRun = py.pyimport("atelier_run");
}

/** Interpréteur chargé (pour ne l'abandonner qu'une fois s'il plante) et interpréteurs plantés. */
let instance: Pyodide | null = null;
const plantes = new WeakSet<Pyodide>();

/**
 * Erreur après laquelle Pyodide est inutilisable (« Pyodide has suffered a fatal error », puis « Pyodide
 * already fatally failed and can no longer be used ») : pile WebAssembly épuisée, mémoire, bogue interne.
 */
export function estErreurFatale(e: unknown): boolean {
  if (e && typeof e === "object" && (e as { pyodide_fatal_error?: unknown }).pyodide_fatal_error) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /fatally failed|already exited and can no longer be used|suffered a fatal error/i.test(message);
}

const MESSAGE_PLANTAGE = "Python a planté : l'interpréteur est rechargé (les variables, les imports et les paquets installés sont perdus).";

/** L'interpréteur répond-il encore ? (non après une erreur fatale) */
function interpreteurUtilisable(py: Pyodide): boolean {
  try {
    py.runPython("None");
    return true;
  } catch (e) {
    return !estErreurFatale(e);
  }
}

/**
 * Interpréteur planté : on l'oublie (le prochain chargement en crée un neuf, lancé tout de suite), ses
 * fenêtres sont fermées, ses attentes et saisies abandonnées, les exécutions qui l'attendaient libérées.
 */
function abandonnerInterpreteur(py: Pyodide) {
  if (instance !== py) return; // déjà fait
  instance = null;
  plantes.add(py);
  window.__pyodide = undefined;
  atelierRun = null;
  pipPret = null;
  copies.clear();
  reveilsArret.clear();
  for (const d of fileSaisies.splice(0)) d.abandon.abort();
  attentes = 0;
  const erreur = Object.assign(new Error(MESSAGE_PLANTAGE), { pyodide_fatal_error: true });
  for (const e of [...pileSorties]) e.abandonner(erreur);
  fermerToutesFenetres();
  signalerEtat();
  void chargerPyodide().catch(() => undefined);
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
      instance = py;
      // Crochet interne de Pyodide (s'il existe) : un plantage pendant un programme est traité tout de suite.
      const api = (py as unknown as { _api?: { on_fatal?: (e: unknown) => void } })._api;
      if (api) api.on_fatal = () => setTimeout(() => abandonnerInterpreteur(py), 0);
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
  /** Toute la sortie, dans l'ordre exact où le programme l'a produite (textes, erreurs, images). */
  morceaux: Morceau[];
  /** Sortie standard seule (compatibilité). */
  sortie: string;
  /** Sortie d'erreur et traceback (compatibilité). */
  erreur?: string;
  /** Images seules (compatibilité). */
  images: string[];
}

export interface OptionsExecution {
  /** Reçoit ce que le programme affiche APRÈS la fin de l'exécution (clics, minuteries, fenêtres). */
  sortieTardive?: (m: Morceau) => void;
  /** Reçoit chaque morceau dès qu'il est affiché (programme encore en cours : mainloop, boucle avec sleep…). */
  enDirect?: (m: Morceau) => void;
  /**
   * input(), sys.stdin, getpass (avec JSPI) : demande la ligne à l'interface ; null = annulé (Échap), false =
   * plus de saisie possible. Une seule demande à la fois ; `signal` prévient quand elle est abandonnée.
   * Sans gestionnaire (ou sans JSPI) : boîte de saisie du navigateur.
   */
  saisie?: GestionnaireSaisie;
  /**
   * Repartir d'un état propre : fenêtres tkinter/turtle et figures des exécutions précédentes fermées.
   * Pour le bouton « Exécuter » d'un bloc de code ; la console garde volontairement son état.
   */
  neuf?: boolean;
}

function resultat(morceaux: Morceau[]): ResultatExecution {
  return { morceaux, sortie: texteDuFlux(morceaux), erreur: texteDuFlux(morceaux, true) || undefined, images: imagesDe(morceaux) };
}

/** Fin d'exécution côté Python : figures matplotlib modifiées affichées, flux vidés. */
function finirExecution(py: Pyodide): void {
  try {
    py.runPython("import atelier_run\natelier_run._fin_execution()");
  } catch {
    /* rien */
  }
}

/**
 * Exécute du code Python et renvoie sa sortie exacte (stdout, stderr, images). Charge les paquets
 * importés (distribution Pyodide, sinon PyPI) ; les commandes pip et « python fichier.py » sont
 * traduites ; les fenêtres tkinter/turtle restent ouvertes et actives après la fin.
 */
export async function executerPython(code: string, onProgres?: (etape: string) => void, options: OptionsExecution = {}): Promise<ResultatExecution> {
  let py = await chargerPyodide(onProgres);
  const morceaux: Morceau[] = [];
  if (!interpreteurUtilisable(py)) {
    // Planté depuis la dernière exécution (dans un rappel de fenêtre, par exemple) : on repart d'un interpréteur neuf.
    abandonnerInterpreteur(py);
    py = await chargerPyodide(onProgres);
    ajouterMorceau(morceaux, { texte: "(Python avait planté : l'interpréteur a été rechargé ; les variables et les paquets installés sont perdus.)\n", erreur: true });
  }
  let abandonner: (e: Error) => void = () => undefined;
  const plantage = new Promise<never>((_, ko) => (abandonner = ko));
  plantage.catch(() => undefined);
  const active: ExecutionActive = {
    id: prochaineExecution++,
    recevoir: (m) => {
      ajouterMorceau(morceaux, m);
      options.enDirect?.(m);
    },
    saisie: options.saisie,
    arretee: false,
    abandonner,
  };
  // Un arrêt qui ne vise plus aucune exécution en cours n'est pas hérité ; s'il en vise encore une, il est gardé.
  oublierArretSansCible();
  pileSorties.push(active);
  signalerEtat();
  if (options.sortieTardive) {
    sortieTardive = options.sortieTardive;
    tardives.set(active.id, options.sortieTardive);
    if (tardives.size > 100) tardives.delete(tardives.keys().next().value as number);
  }
  recente = "";
  synchroniserProjet(py);
  const { code: codeExec, pip } = transformerCommandes(code);
  try {
    if (options.neuf) py.runPython("import atelier_run\natelier_run._repartir_a_neuf()");
    if (pip) {
      onProgres?.("Installation des paquets…");
      await preparerPip(py);
    } else {
      onProgres?.("Installation des dépendances…");
    }
    await py.loadPackagesFromImports(codeExec).catch(() => {});
    atelierRun ??= py.pyimport("atelier_run");
    if (!active.arretee) await atelierRun.preparer(code, active.id).catch(() => {});
    if (active.arretee) {
      // « Arrêter » pendant la préparation (paquets) : le code n'est pas lancé.
      ajouterMorceau(morceaux, { texte: "[programme interrompu : arrêt demandé]\n", erreur: true });
      return resultat(morceaux);
    }
    py.runPython("import atelier_run\natelier_run._debut_execution()");
    onProgres?.("Exécution…");
    // Via atelier_run.cellule : sys.exit() / exit() s'affichent proprement au lieu d'un traceback.
    const valeur = await Promise.race([atelierRun.cellule(codeExec, active.id), plantage]);
    finirExecution(py);
    const rendu = valeur === undefined || valeur === null ? "" : String(valeur);
    if (rendu && !texteDuFlux(morceaux).endsWith(`${rendu}\n`)) {
      const precedent = dernierTexte(morceaux);
      ajouterMorceau(morceaux, { texte: `${precedent && !precedent.endsWith("\n") ? "\n" : ""}${rendu}` });
    }
    return resultat(morceaux);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    let texte: string;
    if (estErreurFatale(e)) {
      abandonnerInterpreteur(py);
      texte = message === MESSAGE_PLANTAGE ? message : `${MESSAGE_PLANTAGE}\nCause : ${message.split("\n")[0]}`;
    } else {
      finirExecution(py);
      // Commande shell / outil de build tapé par réflexe : on montre l'aide seule, sans le traceback.
      texte = indiceShell(code, message) ?? nettoyerTraceback(message);
    }
    const precedent = dernierTexte(morceaux);
    ajouterMorceau(morceaux, { texte: `${precedent && !precedent.endsWith("\n") ? "\n" : ""}${texte}`, erreur: true });
    return resultat(morceaux);
  } finally {
    // Saisies encore en attente (input() d'un rappel quand la fenêtre se ferme) : abandonnées, pas suspendues pour toujours.
    annulerSaisies("arret", active);
    const i = pileSorties.lastIndexOf(active);
    if (i >= 0) pileSorties.splice(i, 1);
    oublierArretSansCible();
    signalerEtat();
  }
}

/**
 * Retire du traceback les cadres internes : Pyodide (« File "/lib/python312.zip/_pyodide/… ») et
 * le lanceur de la console (atelier_run : cellules, asyncio.run, attentes).
 */
export function nettoyerTraceback(message: string): string {
  const lignes = message.split("\n");
  const sortie: string[] = [];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s+File "\/lib\/python3\d+\.zip\/(_pyodide|pyodide)\//.test(l) || /^\s+File "(\/lib\/atelier\/atelier_run\.py", line \d+, in \w+|[^"]*\/atelier_run\.py", line \d+, in cellule)$/.test(l)) {
      if (lignes[i + 1] && /^\s{4,}\S/.test(lignes[i + 1]) && !/^\s+File /.test(lignes[i + 1])) i++;
      while (lignes[i + 1] && /^\s+[\^~]+\s*$/.test(lignes[i + 1])) i++;
      continue;
    }
    sortie.push(l);
  }
  return sortie.join("\n").trim();
}
