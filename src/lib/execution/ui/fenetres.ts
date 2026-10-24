"use client";

/**
 * Moteur d'affichage des programmes Python à interface (tkinter, turtle) : le module `tkinter` de la
 * console (Python, exécuté dans Pyodide) décrit les widgets ; ce moteur les dessine en HTML dans des
 * fenêtres flottantes déplaçables, au-dessus de la page. Les événements (clic, clavier, saisie,
 * fermeture) remontent au Python par un rappel unique : rappel(idWidget, type, données).
 *
 * Géométrie : `pack` (algorithme de la cavité de Tk, reproduit par des boîtes flex imbriquées),
 * `grid` (grille CSS, poids → fr, sticky) et `place` (positionnement absolu).
 */

type Opts = Record<string, unknown>;
/** Fonction Python vue depuis JavaScript (PyProxy) : callPromising permet au Python d'attendre (JSPI). */
type ProxyPy = ((...args: unknown[]) => unknown) & { callPromising?: (...args: unknown[]) => Promise<unknown>; destroy?: () => void };
type Rappel = ProxyPy;
type Gestion = "pack" | "grid" | "place" | "page";

interface CanvasEtat {
  svg: SVGSVGElement;
  items: Map<number, SVGElement>;
  fenetres: Map<number, number>; // item « window » → id du widget intégré
  anime: number; // opérations par image (0 = immédiat) : animation de turtle
  file: unknown[][];
  enCours: boolean;
  /** Tour du navigateur où la file a reçu ses dernières opérations, et nombre d'opérations à dessiner tout de suite. */
  tourFile?: number;
  limite?: number;
  /** scrollregion [x1, y1, x2, y2] : le canvas défile (barres natives, molette, xview / yview). */
  zone?: [number, number, number, number] | null;
  espace?: HTMLElement;
}

interface Widget {
  id: number;
  type: string;
  el: HTMLElement; // élément extérieur, placé par le gestionnaire de géométrie
  contenu: HTMLElement; // zone qui reçoit les enfants (conteneurs)
  parent: Widget | null;
  enfants: Widget[];
  geo: { gestion: Gestion; opts: Opts; ordre: number } | null;
  fen: Fenetre;
  opts: Opts;
  propage: boolean;
  lignes: Map<number, Opts>;
  colonnes: Map<number, Opts>;
  canvas?: CanvasEtat;
  dansCanvas?: number; // id du canvas qui l'affiche (create_window)
  detruit?: boolean;
  resize?: ResizeObserver;
  /** Taille demandée (CSS) ; le gestionnaire de géométrie peut l'étirer (fill / sticky). */
  dimL?: string;
  dimH?: string;
  etire?: { x: boolean; y: boolean };
  /** Text : dernière sélection connue [début, fin] (décalages dans le texte). */
  selTexte?: [number, number];
  /** Text : dernière plage sélectionnée signalée au Python (<<Selection>>). */
  selPrec?: string;
  /** Taille imposée par l'élément de canvas qui l'affiche (create_window(width=…, height=…)). */
  tailleCanvas?: { l: number; h: number };
  /** Page d'un Notebook dont le parent Tk n'est pas le Notebook (Frame(root) ajouté par nb.add). */
  pageExterne?: boolean;
  /** Treeview : identifiants de colonnes affichées et lignes déjà dessinées (par iid). */
  colonnesArbre?: string[];
  lignesArbre?: Map<string, HTMLTableRowElement>;
  /** Rang d'empilement parmi les frères (ordre de création, changé par lift / lower), comme Tk. */
  rang: number;
}

interface Fenetre {
  id: number;
  cadre: HTMLElement;
  barre: HTMLElement;
  titre: HTMLElement;
  menu: HTMLElement;
  widget: Widget;
  ecoutes: Set<string>;
  tailleFixe: boolean;
  menuDesc?: Opts[] | null;
  focusDemande?: HTMLElement;
}

const SVG = "http://www.w3.org/2000/svg";
const widgets = new Map<number, Widget>();
const fenetres = new Map<number, Fenetre>();
let rappel: Rappel | null = null;
let couche: HTMLElement | null = null;
let zMax = 70;
let ordrePack = 0;
let rangMax = 0;
let rangMin = 0;
let cascade = 0;
const sales = new Set<Widget>();
let planifie = false;
const ecouteursFenetres = new Set<(n: number) => void>();
/** Saisie implicite de la souris (comme Tk) : après un clic, le widget cliqué reçoit les mouvements et le relâchement. */
let saisie: { fen: Fenetre; cible: number } | null = null;
let ecoutesGlobales = false;
/** Description des menus par identifiant (rafraîchie par le Python, ex. après postcommand). */
const descMenus = new Map<number, Opts[]>();

/** JSPI : les rappels Python sont lancés en appel « promettant » et peuvent attendre (update(), time.sleep()). */
let suspensible = false;
let retourSync: unknown;
/** Résultat d'un rappel qui s'est suspendu (update(), sleep…) avant de répondre : sa réponse viendra plus tard. */
const EN_ATTENTE = Symbol("en attente");
/**
 * Profondeur d'appels Python → JS en cours. Un événement DOM émis pendant ce temps (focus(), execCommand,
 * suppression d'un élément qui a le focus) ne doit JAMAIS relancer un callPromising imbriqué : Pyodide 0.26
 * y perd ses piles et meurt (« memory access out of bounds »). Il est alors appelé de façon synchrone, ou mis
 * en file comme le fait Tk pour FocusIn/FocusOut.
 */
let dansPython = 0;
/** Sonde Python synchrone : du code Python est-il déjà en cours (appelé hors de moteurFenetres) ? */
let sondePython: ProxyPy | null = null;

/**
 * Rappels Python endormis dans time.sleep() : comme Tk, qui ne traite les événements que dans mainloop(),
 * update() et wait_*(), les événements et minuteries qui arrivent pendant ce sommeil attendent (file FIFO)
 * la fin du rappel ou son prochain update(), au lieu de lancer un rappel qui s'entrelace avec lui.
 */
let rappelsEndormis = 0;
const fileTk: (() => void)[] = [];
let vidageProgramme = false;
let enVidage = false;
function viderFileTk() {
  vidageProgramme = false;
  while (fileTk.length && rappelsEndormis === 0 && dansPython === 0) {
    const f = fileTk.shift()!;
    enVidage = true;
    try {
      f();
    } catch (e) {
      console.error("[fenêtres]", e);
    } finally {
      enVidage = false;
    }
  }
  if (fileTk.length && rappelsEndormis === 0 && !vidageProgramme) {
    vidageProgramme = true;
    window.setTimeout(viderFileTk, 0);
  }
}
const doitAttendre = () => suspensible && dansPython === 0 && (rappelsEndormis > 0 || (fileTk.length > 0 && !enVidage)) && sondePython?.() !== true;

function appeler(cible: number, type: string, donnees: Opts = {}, apres?: (final: unknown) => void): unknown {
  if (!rappel) return undefined;
  try {
    if (doitAttendre()) {
      fileTk.push(() => {
        const r = appeler(cible, type, donnees, apres);
        if (r !== EN_ATTENTE && apres) apres(r);
      });
      return EN_ATTENTE;
    }
    if (dansPython > 0 || (suspensible && sondePython?.() === true)) {
      if (type === "focusin" || type === "focusout") {
        queueMicrotask(() => appeler(cible, type, donnees));
        return undefined;
      }
      const sauve = retourSync; // le rappel imbriqué dépose aussi son résultat : ne pas écraser celui de l'appel en cours
      try {
        return rappel(cible, type, donnees);
      } finally {
        retourSync = sauve;
      }
    }
    if (suspensible && rappel.callPromising) {
      // Le Python s'exécute tout de suite jusqu'à sa première attente ; s'il n'a pas attendu, il a déjà
      // déposé son résultat (« break »…) par moteurFenetres.retour avant la fin de cet appel.
      retourSync = EN_ATTENTE;
      let p: Promise<unknown>;
      dansPython++;
      try {
        p = rappel.callPromising(cible, type, donnees);
      } finally {
        dansPython--;
      }
      p.catch((e) => console.error("[fenêtres]", e));
      const r = retourSync;
      retourSync = undefined;
      if (r === EN_ATTENTE && apres) p.then(apres, () => apres(undefined));
      return r;
    }
    return rappel(cible, type, donnees);
  } catch (e) {
    console.error("[fenêtres]", e);
    return undefined;
  }
}

function signalerNombre() {
  for (const f of ecouteursFenetres) f(fenetres.size);
}

/* ───────────────────────────── Styles ───────────────────────────── */

const CSS = `
.tk-couche{position:fixed;inset:0;pointer-events:none;z-index:70}
.tk-fen{position:fixed;pointer-events:auto;display:flex;flex-direction:column;background:#f0f0f0;color:#000;border:1px solid #8a8a8a;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:13px "Segoe UI",system-ui,-apple-system,sans-serif;max-width:calc(100vw - 8px);max-height:calc(100dvh - 8px);overflow:hidden;outline:none;color-scheme:light}
.tk-fen *{box-sizing:border-box}
.tk-barre{display:flex;align-items:center;gap:8px;height:30px;padding:0 4px 0 12px;background:#fff;border-bottom:1px solid #d6d6d6;cursor:move;user-select:none;touch-action:none;flex:none}
.tk-titre{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#222}
.tk-fermer{width:30px;height:24px;border:0;background:transparent;border-radius:4px;font-size:15px;line-height:1;cursor:pointer;color:#333}
.tk-fermer:hover{background:#e81123;color:#fff}
.tk-menu{display:none;gap:2px;padding:2px 4px;background:#fff;border-bottom:1px solid #e3e3e3;flex:none}
.tk-menu.actif{display:flex}
.tk-menu>button{border:0;background:transparent;padding:3px 8px;border-radius:3px;font:inherit;cursor:default}
.tk-menu>button:hover{background:#e5f1fb}
.tk-deroulant{position:fixed;z-index:2147483000;background:#f9f9f9;border:1px solid #ccc;box-shadow:2px 4px 12px rgba(0,0,0,.25);padding:3px 0;min-width:160px;font:13px "Segoe UI",system-ui,sans-serif;color:#000;pointer-events:auto}
.tk-deroulant button{display:flex;width:100%;justify-content:space-between;gap:24px;border:0;background:transparent;padding:4px 24px;font:inherit;text-align:left;cursor:default;color:inherit}
.tk-deroulant button:hover:not(:disabled){background:#91c9f7}
.tk-deroulant button:disabled{color:#999}
.tk-deroulant hr{border:0;border-top:1px solid #ddd;margin:3px 0}
.tk-corps{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden;isolation:isolate}
.tk-cavite{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}
.tk-parcelle{position:relative;display:flex;min-width:0;min-height:0}
.tk-grille{display:grid;flex:1 1 auto;min-width:0;min-height:0;align-content:start;justify-content:start}
.tk-cellule{position:relative;display:flex;min-width:0;min-height:0}
.tk-w{position:relative;flex:0 0 auto;min-width:0;min-height:0}
.tk-frame{display:flex;flex-direction:column;background:#f0f0f0;isolation:isolate}
.tk-labelframe{display:flex;flex-direction:column;border:1px solid #c8c8c8;border-radius:3px;margin:0;padding:4px 6px 6px;background:#f0f0f0}
.tk-labelframe>legend{padding:0 4px;font-size:inherit}
.tk-label{display:flex;align-items:center;justify-content:center;white-space:pre;padding:1px 2px;line-height:1.25}
.tk-label img{display:block}
.tk-button{font:inherit;color:inherit;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:pre;border:1px solid #adadad;background:#e1e1e1;padding:3px 10px;border-radius:2px;cursor:pointer;line-height:1.2}
.tk-button:hover:not(:disabled){background:#e5f1fb;border-color:#0078d7}
.tk-button:active:not(:disabled){background:#cce4f7}
.tk-button:disabled{color:#a0a0a0;cursor:default}
.tk-entry{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 4px;border-radius:1px;outline:none;min-width:0}
.tk-entry:focus{border-color:#0078d7}
.tk-entry:disabled{background:#f0f0f0;color:#6d6d6d}
.tk-entry[readonly]{background:#f0f0f0}
.tk-text{font:13px Consolas,"Courier New",monospace;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 4px;white-space:pre-wrap;overflow:auto;outline:none;word-break:break-all;tab-size:8}
.tk-text.mots{word-break:normal;overflow-wrap:anywhere}
.tk-listbox{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;outline:none;overflow:auto}
.tk-listbox option{padding:0 4px}
.tk-listbox option:checked{background:#0078d7 linear-gradient(#0078d7,#0078d7);color:#fff}
.tk-check{display:inline-flex;align-items:center;gap:5px;white-space:pre;padding:1px 2px;cursor:default}
.tk-check input{margin:0}
.tk-check.tk-button:has(input:checked){border-style:inset;background:#cfcfcf}
.tk-scale{display:flex;flex-direction:column;align-items:stretch;padding:1px 2px}
.tk-scale.vertical{flex-direction:row}
.tk-scale input{min-width:0;min-height:0}
.tk-scale .tk-valeur{text-align:center;font-size:12px}
.tk-canvas{overflow:hidden;background:#f0f0f0;user-select:none}
.tk-canvas [data-actif]:hover{fill:var(--actif)}
.tk-canvas [data-actif-contour]:hover{stroke:var(--actif-contour)}
.tk-canvas [data-actif-ligne]:hover>*{stroke:var(--actif)}
.tk-canvas svg{position:absolute;inset:0;overflow:visible}
.tk-canvas>.tk-w{position:absolute}
.tk-select{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 2px;border-radius:2px;min-width:0}
.tk-combo input::-webkit-calendar-picker-indicator{display:block;opacity:1;cursor:default}
.tk-spin{display:flex;align-items:stretch}
.tk-spin>input{flex:1 1 auto;min-width:0}
.tk-spin>.tk-fleches{display:flex;flex-direction:column;flex:none;width:16px}
.tk-spin>.tk-fleches>button{flex:1 1 0;min-height:0;padding:0;border:1px solid #9a9a9a;background:#f0f0f0;color:#333;font-size:7px;line-height:1;cursor:default}
.tk-spin>.tk-fleches>button:active:not(:disabled){background:#cce4f7}
.tk-progress{height:18px;accent-color:#06b025}
.tk-separateur{background:#c8c8c8}
.tk-tableau{background:#fff;border:1px solid #9a9a9a;overflow:auto;font:inherit;outline:none}
.tk-tableau:focus-visible{border-color:#0078d7}
.tk-tableau table{border-collapse:collapse;table-layout:fixed;color:#000}
.tk-tableau th{position:sticky;top:0;z-index:1;height:26px;background:#f3f3f3;border-right:1px solid #ddd;border-bottom:1px solid #ccc;font-weight:400;padding:0 6px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
.tk-tableau td{height:var(--tk-ligne,22px);padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #f1f1f1;cursor:default}
.tk-tableau .cache{display:none}
.tk-tableau tr.sel td{background:#0078d7;color:#fff}
.tk-tableau tr:hover:not(.sel) td{background:#e5f3ff}
.tk-onglets{display:flex;flex-direction:column}
.tk-onglets>.tk-tabs{display:flex;gap:0;border-bottom:1px solid #c8c8c8;flex:none}
.tk-onglets>.tk-tabs>button{font:inherit;color:inherit;border:1px solid transparent;border-bottom:0;background:transparent;padding:4px 10px;margin-bottom:-1px;cursor:default}
.tk-onglets>.tk-tabs>button.actif{background:#fff;border-color:#c8c8c8;border-radius:3px 3px 0 0}
.tk-onglets>.tk-tabs>button:disabled{color:#a0a0a0}
.tk-onglets>.tk-page{position:relative;display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);flex:1 1 auto;min-height:0;background:#fff;border:1px solid #c8c8c8;border-top:0;isolation:isolate}
.tk-redim{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 50%,#bbb 50%,#bbb 60%,transparent 60%,transparent 70%,#bbb 70%,#bbb 80%,transparent 80%)}
`;

function assurerCouche(): HTMLElement {
  if (couche && document.body.contains(couche)) return couche;
  if (!document.getElementById("tk-styles")) {
    const s = document.createElement("style");
    s.id = "tk-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (!ecoutesGlobales) {
    ecoutesGlobales = true;
    // Sélection d'un widget Text suivie en continu : marque « insert » et tag « sel » du Python.
    document.addEventListener("selectionchange", () => {
      // Le Text est trouvé par la sélection elle-même : un Text désactivé (sans focus) se sélectionne aussi.
      const n = window.getSelection()?.anchorNode;
      const a = (n instanceof Element ? n : n?.parentElement)?.closest?.(".tk-text") as HTMLElement | null;
      const w = a ? widgets.get(Number(a.dataset.tkid)) : undefined;
      if (!w || enDisposition || !selectionDans(w.el)) return;
      const sel = lireSelectionTexte(w);
      // Le « \n » final (celui de Tk) n'est pas une ligne : le curseur ne va pas au-delà.
      const t = lireTexte(w.el);
      const max = t.endsWith("\n") ? t.length - 1 : t.length;
      if (sel && (sel[0] > max || sel[1] > max)) placerSelectionTexte(w, Math.min(sel[0], max), Math.min(sel[1], max), true);
      // <<Selection>> : seulement quand la plage sélectionnée change (pas à chaque déplacement du curseur).
      const plage = sel && sel[0] !== sel[1] ? `${Math.min(sel[0], sel[1])}:${Math.max(sel[0], sel[1])}` : "";
      if (plage !== (w.selPrec ?? "")) {
        w.selPrec = plage;
        appeler(w.id, "selection", {});
      }
    });
    // Saisie implicite : mouvements et relâchement hors de la fenêtre renvoyés au widget cliqué.
    document.addEventListener("mousemove", relayerSaisie, true);
    document.addEventListener("mouseup", (e) => {
      relayerSaisie(e);
      saisie = null;
    });
  }
  couche = document.createElement("div");
  couche.className = "tk-couche";
  document.body.appendChild(couche);
  return couche;
}

function relayerSaisie(e: MouseEvent) {
  if (!saisie) return;
  if (e.type === "mousemove" && !e.buttons) {
    saisie = null;
    return;
  }
  if (saisie.fen.cadre.contains(e.target as Node)) return; // la fenêtre le reçoit déjà
  ecouteurs.get(saisie.fen.cadre)?.get(e.type)?.(e);
}

/* ───────────────────────────── Outils ───────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  return e;
}

function nb(v: unknown, defaut = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : defaut;
}

function paire(v: unknown): [number, number] {
  if (Array.isArray(v)) return [nb(v[0]), nb(v[1] ?? v[0])];
  const n = nb(v);
  return [n, n];
}

function texte(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** Ancre Tk (n, ne, e, se, s, sw, w, nw, center) → alignement flex [horizontal, vertical]. */
/** Ancre Tk normalisée : « center » (défaut) → "" ; sinon n, ne, e, se, s, sw, w ou nw. */
function normAncre(v: unknown, defaut = ""): string {
  const a = (texte(v) || defaut).toLowerCase();
  return a === "center" || a === "c" ? "" : a;
}

/** Ancre Tk → alignement flex [horizontal, vertical]. */
function ancreFlex(ancre: unknown): [string, string] {
  const a = normAncre(ancre);
  const h = a.includes("w") ? "flex-start" : a.includes("e") ? "flex-end" : "center";
  const v = a.includes("n") ? "flex-start" : a.includes("s") ? "flex-end" : "center";
  return [h, v];
}

function demanderDisposition(w: Widget | null | undefined) {
  if (!w) return;
  sales.add(w);
  if (planifie) return;
  planifie = true;
  queueMicrotask(disposerTout);
}

let enDisposition = false;

function disposerTout() {
  planifie = false;
  const liste = [...sales];
  sales.clear();
  // Re-ranger les éléments les détache un instant : on garde le focus et la sélection de saisie.
  const actif = document.activeElement as HTMLElement | null;
  const champ = actif instanceof HTMLInputElement || actif instanceof HTMLTextAreaElement ? actif : null;
  const selChamp = champ ? [champ.selectionStart, champ.selectionEnd] : null;
  const sel = window.getSelection();
  const plage = sel && sel.rangeCount && actif?.isContentEditable ? sel.getRangeAt(0).cloneRange() : null;
  // Détacher un élément remet son défilement à 0 : Text, Listbox, Treeview et canvas défilants le retrouvent.
  const defilements: [HTMLElement, number, number][] = [];
  for (const f of fenetres.values()) {
    for (const e of f.cadre.querySelectorAll<HTMLElement>(".tk-text,.tk-listbox,.tk-tableau,.tk-canvas")) {
      if (e.scrollTop || e.scrollLeft) defilements.push([e, e.scrollTop, e.scrollLeft]);
    }
  }
  enDisposition = true;
  try {
    for (const w of liste) if (!w.detruit) disposer(w);
    for (const [e, haut, gauche] of defilements) {
      if (e.scrollTop !== haut) e.scrollTop = haut;
      if (e.scrollLeft !== gauche) e.scrollLeft = gauche;
    }
  } finally {
    if (actif && actif !== document.activeElement && document.contains(actif)) {
      actif.focus({ preventScroll: true });
      if (champ && selChamp && selChamp[0] !== null) champ.setSelectionRange(selChamp[0], selChamp[1] ?? selChamp[0]);
      if (plage) {
        sel?.removeAllRanges();
        sel?.addRange(plage);
      }
    }
    enDisposition = false;
  }
}

/* ───────────────────────────── Fenêtres ───────────────────────────── */

function premierPlan(f: Fenetre) {
  f.cadre.style.zIndex = String(++zMax);
}

function creerFenetre(id: number, opts: Opts) {
  const c = assurerCouche();
  const cadre = el("div", "tk-fen");
  cadre.tabIndex = -1;
  cadre.dataset.tkid = String(id);
  const barre = el("div", "tk-barre");
  const titre = el("span", "tk-titre");
  titre.textContent = texte(opts.titre) || "tk";
  const fermer = el("button", "tk-fermer");
  fermer.type = "button";
  fermer.textContent = "✕";
  fermer.title = "Fermer";
  fermer.addEventListener("click", (e) => {
    e.stopPropagation();
    appeler(id, "fermer");
  });
  barre.append(titre, fermer);
  const menu = el("div", "tk-menu");
  const corps = el("div", "tk-corps tk-frame");
  corps.dataset.tkid = String(id);
  cadre.append(barre, menu, corps);
  c.appendChild(cadre);
  // Position : en cascade autour du centre, ajustée une fois la taille connue.
  const decalage = (cascade++ % 8) * 26;
  cadre.style.left = `${Math.max(4, window.innerWidth / 2 - 180 + decalage)}px`;
  cadre.style.top = `${Math.max(4, window.innerHeight / 2 - 160 + decalage)}px`;
  const w: Widget = {
    id, type: "fenetre", el: cadre, contenu: corps, parent: null, enfants: [], geo: null,
    fen: undefined as unknown as Fenetre, opts: {}, propage: true, lignes: new Map(), colonnes: new Map(), rang: ++rangMax,
  };
  const f: Fenetre = { id, cadre, barre, titre, menu, widget: w, ecoutes: new Set(), tailleFixe: false };
  w.fen = f;
  widgets.set(id, w);
  fenetres.set(id, f);
  premierPlan(f);
  deplacable(f);
  cadre.addEventListener("pointerdown", () => premierPlan(f), true);
  cadre.addEventListener("mousedown", (e) => {
    saisie = { fen: f, cible: cibleDe(e.target) ?? id };
  }, true);
  cadre.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input,textarea,select,[contenteditable],.tk-tableau,.tk-barre")) return;
    // Comme Tk : cliquer un bouton, un libellé ou le fond ne retire pas le focus du champ actif
    // (Entrée / Espace ne relancent donc pas le dernier bouton cliqué).
    e.preventDefault();
    if (!cadre.contains(document.activeElement)) cadre.focus({ preventScroll: true });
  });
  requestAnimationFrame(() => {
    recadrer(f, true);
    const voulu = f.focusDemande;
    f.focusDemande = undefined;
    if (voulu && document.contains(voulu)) {
      const wv = voulu.classList.contains("tk-text") ? widgets.get(Number(voulu.dataset.tkid)) : undefined;
      const memo = wv?.selTexte ? [...wv.selTexte] : null;
      voulu.focus({ preventScroll: true });
      if (wv && memo) placerSelectionTexte(wv, memo[0], memo[1], true); // focus ne déplace pas « insert » (Tk)
    }
    else if (!document.activeElement || document.activeElement === document.body || !document.activeElement.closest(".tk-fen")) cadre.focus({ preventScroll: true });
  });
  signalerNombre();
}

/** Garde la fenêtre visible ; au premier affichage, la centre sur sa taille réelle. */
function recadrer(f: Fenetre, centrer = false) {
  const r = f.cadre.getBoundingClientRect();
  let x = r.left;
  let y = r.top;
  if (centrer && !f.cadre.dataset.positionnee) {
    const decalage = ((cascade - 1) % 8) * 26;
    x = (window.innerWidth - r.width) / 2 + decalage;
    y = Math.max(8, (window.innerHeight - r.height) / 2.5) + decalage;
  }
  x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - r.width - 4));
  y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - 40));
  f.cadre.style.left = `${x}px`;
  f.cadre.style.top = `${y}px`;
}

function deplacable(f: Fenetre) {
  let depart: { x: number; y: number; l: number; t: number } | null = null;
  f.barre.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = f.cadre.getBoundingClientRect();
    depart = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
    f.barre.setPointerCapture(e.pointerId);
    f.cadre.dataset.positionnee = "1";
  });
  f.barre.addEventListener("pointermove", (e) => {
    if (!depart) return;
    f.cadre.style.left = `${Math.min(Math.max(-f.cadre.offsetWidth + 60, depart.l + e.clientX - depart.x), window.innerWidth - 60)}px`;
    f.cadre.style.top = `${Math.min(Math.max(0, depart.t + e.clientY - depart.y), window.innerHeight - 30)}px`;
  });
  const fin = () => {
    depart = null;
  };
  f.barre.addEventListener("pointerup", fin);
  f.barre.addEventListener("pointercancel", fin);
}

function poignee(f: Fenetre) {
  if (f.cadre.querySelector(":scope>.tk-redim")) return;
  const p = el("div", "tk-redim");
  let depart: { x: number; y: number; w: number; h: number } | null = null;
  p.addEventListener("pointerdown", (e) => {
    const r = f.widget.contenu.getBoundingClientRect();
    depart = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    p.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  p.addEventListener("pointermove", (e) => {
    if (!depart) return;
    fixerTaille(f, Math.max(80, depart.w + e.clientX - depart.x), Math.max(40, depart.h + e.clientY - depart.y));
  });
  p.addEventListener("pointerup", () => (depart = null));
  f.cadre.appendChild(p);
}

function fixerTaille(f: Fenetre, l: number, h: number) {
  f.tailleFixe = true;
  f.widget.contenu.style.width = `${l}px`;
  f.widget.contenu.style.height = `${h}px`;
  f.widget.contenu.style.flex = "none";
}

function configurerFenetre(f: Fenetre, o: Opts) {
  if ("titre" in o) f.titre.textContent = texte(o.titre) || "tk";
  if ("fond" in o) f.widget.contenu.style.background = texte(o.fond);
  if ("geometrie" in o) {
    const g = o.geometrie as Opts;
    if (g.largeur !== undefined && g.hauteur !== undefined) fixerTaille(f, nb(g.largeur), nb(g.hauteur));
    if (g.x !== undefined && g.y !== undefined) {
      f.cadre.dataset.positionnee = "1";
      f.cadre.style.left = `${nb(g.x)}px`;
      f.cadre.style.top = `${nb(g.y)}px`;
      requestAnimationFrame(() => recadrer(f));
    }
  }
  if ("minimum" in o) {
    const [l, h] = paire(o.minimum);
    f.widget.contenu.style.minWidth = `${l}px`;
    f.widget.contenu.style.minHeight = `${h}px`;
  }
  if ("redimensionnable" in o) {
    if (o.redimensionnable) poignee(f);
    else f.cadre.querySelector(":scope>.tk-redim")?.remove();
  }
  if ("padx" in o || "pady" in o) {
    const px = nb(o.padx ?? f.widget.opts.padx);
    const py = nb(o.pady ?? f.widget.opts.pady);
    f.widget.contenu.style.padding = `${py}px ${px}px`;
  }
  if ("visible" in o) f.cadre.style.display = o.visible ? "" : "none";
  if ("menu" in o) dessinerMenu(f, o.menu as Opts[] | null);
}

/* ───────────────────────────── Menus ───────────────────────────── */

let deroulantOuvert: HTMLElement | null = null;

function fermerDeroulant() {
  deroulantOuvert?.remove();
  deroulantOuvert = null;
  document.removeEventListener("pointerdown", clicHorsMenu, true);
}

function clicHorsMenu(e: Event) {
  if (deroulantOuvert && !deroulantOuvert.contains(e.target as Node)) fermerDeroulant();
}

function ouvrirDeroulant(menuId: number, items: Opts[], x: number, y: number, sousMenu = false) {
  if (!sousMenu) fermerDeroulant();
  const d = el("div", "tk-deroulant");
  for (const it of items) {
    if (it.type === "separator") {
      d.appendChild(el("hr"));
      continue;
    }
    const b = el("button");
    b.type = "button";
    const libelle = el("span");
    const coche = it.type === "check" || it.type === "radio" ? (it.coche ? "✓ " : " ") : "";
    libelle.textContent = coche + texte(it.label);
    const acc = el("span");
    acc.style.color = "#666";
    acc.textContent = it.type === "cascade" ? "›" : texte(it.accelerateur);
    b.append(libelle, acc);
    b.disabled = it.etat === "disabled";
    b.addEventListener("mousedown", (e) => e.preventDefault()); // le champ actif garde le focus (Copier, Coller…)
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.type === "cascade") {
        const sous = nb(it.menu);
        const r = b.getBoundingClientRect(); // mesuré avant : postcommand peut redessiner les menus
        appeler(sous, "ouvrir"); // postcommand du sous-menu, qui peut le modifier
        ouvrirDeroulant(sous, descMenus.get(sous) ?? (it.items as Opts[]) ?? [], r.right, r.top, true);
        return;
      }
      fermerDeroulant();
      appeler(nb(it.menu ?? menuId), "menu", { index: nb(it.index) });
    });
    d.appendChild(b);
  }
  const c = assurerCouche();
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  if (sousMenu && deroulantOuvert) {
    deroulantOuvert.appendChild(d);
  } else {
    c.appendChild(d);
    deroulantOuvert = d;
    setTimeout(() => document.addEventListener("pointerdown", clicHorsMenu, true));
  }
  requestAnimationFrame(() => {
    const r = d.getBoundingClientRect();
    if (r.right > window.innerWidth) d.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight) d.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
  });
}

/** Mémorise la description de chaque sous-menu (lue au moment de l'ouvrir). */
function memoriserMenus(items: Opts[] | null | undefined) {
  for (const it of items ?? []) {
    if (it.type === "cascade" && Array.isArray(it.items)) {
      descMenus.set(nb(it.menu), it.items as Opts[]);
      memoriserMenus(it.items as Opts[]);
    }
  }
}

function dessinerMenu(f: Fenetre, barre: Opts[] | null) {
  f.menuDesc = barre;
  memoriserMenus(barre);
  f.menu.replaceChildren();
  f.menu.classList.toggle("actif", !!barre?.length);
  for (const cascadeItem of barre ?? []) {
    const b = el("button");
    b.type = "button";
    b.textContent = texte(cascadeItem.label);
    b.disabled = cascadeItem.etat === "disabled";
    b.addEventListener("click", () => {
      if (cascadeItem.type !== "cascade") {
        appeler(nb(cascadeItem.menu), "menu", { index: nb(cascadeItem.index) });
        return;
      }
      const sous = nb(cascadeItem.menu);
      // postcommand (fichiers récents…) peut reconstruire la barre et détacher ce bouton : position mesurée
      // avant, puis reprise sur le bouton reconstruit de même rang.
      const rang = [...f.menu.children].indexOf(b);
      const avant = b.getBoundingClientRect();
      appeler(sous, "ouvrir");
      const cible = b.isConnected ? b : (f.menu.children[rang] as HTMLElement | undefined);
      const r = cible?.isConnected ? cible.getBoundingClientRect() : avant;
      ouvrirDeroulant(sous, descMenus.get(sous) ?? (cascadeItem.items as Opts[]) ?? [], r.left, r.bottom);
    });
    f.menu.appendChild(b);
  }
}

/* ───────────────────────────── Widgets ───────────────────────────── */

function creer(id: number, type: string, parentId: number, opts: Opts) {
  const parent = widgets.get(parentId);
  if (!parent) return;
  let e: HTMLElement;
  let contenu: HTMLElement | null = null;
  const w: Widget = {
    id, type, el: null as unknown as HTMLElement, contenu: null as unknown as HTMLElement, parent, enfants: [], geo: null,
    fen: parent.fen, opts: {}, propage: true, lignes: new Map(), colonnes: new Map(), rang: ++rangMax,
  };
  switch (type) {
    case "frame":
      e = el("div", "tk-w tk-frame");
      break;
    case "labelframe": {
      e = el("fieldset", "tk-w tk-labelframe");
      e.appendChild(el("legend"));
      contenu = el("div", "tk-cavite");
      contenu.style.position = "relative";
      contenu.style.isolation = "isolate";
      e.appendChild(contenu);
      break;
    }
    case "label":
    case "message":
      e = el("div", "tk-w tk-label");
      break;
    case "button": {
      const b = el("button", "tk-w tk-button");
      b.type = "button";
      b.addEventListener("click", () => appeler(id, "commande"));
      e = b;
      break;
    }
    case "entry": {
      const i = el("input", "tk-w tk-entry");
      i.type = "text";
      i.spellcheck = false;
      i.addEventListener("input", () => appeler(id, "valeur", { valeur: i.value }));
      e = i;
      break;
    }
    case "text": {
      const t = el("div", "tk-w tk-text");
      t.contentEditable = "plaintext-only";
      t.spellcheck = false;
      t.addEventListener("input", (ev) => {
        if (ev.target !== t) return; // champ d'une fenêtre intégrée (window_create)
        lireSelectionTexte(w);
        appeler(id, "valeur", { valeur: lireTexte(t), selection: w.selTexte ?? null });
      });
      // Focus clavier (Tab) : le curseur reste à la marque « insert » ; un clic garde son placement natif.
      let souris = false;
      t.addEventListener("mousedown", () => (souris = true));
      t.addEventListener("mouseup", () => (souris = false));
      t.addEventListener("blur", () => (souris = false));
      t.addEventListener("focus", () => {
        if (!souris && w.selTexte) placerSelectionTexte(w, w.selTexte[0], w.selTexte[1], true);
      });
      t.addEventListener("keydown", (ev) => {
        if (ev.target !== t || ev.defaultPrevented || ev.isComposing || t.contentEditable === "false") return;
        const mod = ev.ctrlKey || ev.metaKey || ev.altKey;
        if ((ev.key === "Enter" && !mod) || (ev.key === "Tab" && !mod && !ev.shiftKey)) {
          // Saut de ligne et tabulation insérés comme du texte (\n, \t), comme dans Tk.
          ev.preventDefault();
          document.execCommand("insertText", false, ev.key === "Enter" ? "\n" : "\t");
        } else if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && /^[zy]$/i.test(ev.key)) {
          // Annuler / rétablir : pile du widget (option undo de Tk), pas celle du navigateur.
          ev.preventDefault();
          appeler(id, ev.key.toLowerCase() === "y" || ev.shiftKey ? "retablir" : "annuler");
        }
      });
      t.addEventListener("scroll", () => signalerDefilement(w));
      e = t;
      break;
    }
    case "listbox": {
      const s = el("select", "tk-w tk-listbox");
      s.size = 10;
      s.addEventListener("change", () => appeler(id, "selection", { indices: [...s.selectedOptions].map((o) => o.index) }));
      // selectmode="multiple" (Tk) : chaque clic ou Espace bascule l'élément, sans Ctrl.
      const basculer = (op: HTMLOptionElement) => {
        op.selected = !op.selected;
        appeler(id, "selection", { indices: [...s.selectedOptions].map((o) => o.index), actif: op.index });
      };
      s.addEventListener("mousedown", (ev) => {
        if (!s.dataset.bascule || ev.button !== 0 || s.disabled) return;
        const op = (ev.target as Element).closest?.("option") as HTMLOptionElement | null;
        if (!op) return;
        ev.preventDefault();
        s.focus({ preventScroll: true });
        s.dataset.actif = String(op.index);
        basculer(op);
      });
      s.addEventListener("keydown", (ev) => {
        if (!s.dataset.bascule || ev.key !== " " || s.disabled) return;
        const op = s.options[nb(s.dataset.actif, s.selectedIndex)];
        if (!op) return;
        ev.preventDefault();
        basculer(op);
      });
      s.addEventListener("scroll", () => signalerDefilement(w));
      e = s;
      break;
    }
    case "checkbutton":
    case "radiobutton": {
      const l = el("label", "tk-w tk-check");
      const i = el("input");
      i.type = type === "checkbutton" ? "checkbox" : "radio";
      i.addEventListener("change", () => appeler(id, "commande", { coche: i.checked }));
      l.append(i, el("span"));
      e = l;
      break;
    }
    case "scale": {
      const d = el("div", "tk-w tk-scale");
      const v = el("div", "tk-valeur");
      const i = el("input");
      i.type = "range";
      i.addEventListener("input", () => {
        v.textContent = i.value;
        appeler(id, "valeur", { valeur: i.value });
      });
      const lib = el("div", "tk-valeur");
      d.append(lib, v, i);
      e = d;
      break;
    }
    case "spinbox": {
      // Champ + flèches ▲▼ : le Python calcule la valeur suivante (values, increment, wrap, format).
      const d = el("div", "tk-w tk-spin");
      const i = el("input", "tk-entry");
      i.type = "text";
      i.spellcheck = false;
      i.addEventListener("input", () => appeler(id, "valeur", { valeur: i.value }));
      i.addEventListener("keydown", (ev) => {
        if (ev.defaultPrevented || i.disabled || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
        ev.preventDefault();
        appeler(id, "pas", { sens: ev.key === "ArrowUp" ? 1 : -1 });
      });
      const fleches = el("div", "tk-fleches");
      for (const [signe, sens] of [["▲", 1], ["▼", -1]] as const) {
        const b = el("button");
        b.type = "button";
        b.tabIndex = -1;
        b.textContent = signe;
        let minuterie: ReturnType<typeof setTimeout> | undefined;
        const arreter = () => clearTimeout(minuterie);
        const repeter = (delai: number) => {
          appeler(id, "pas", { sens });
          minuterie = setTimeout(() => repeter(60), delai);
        };
        b.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          if (ev.button !== 0 || b.disabled) return;
          arreter();
          repeter(400); // maintenu enfoncé : la valeur défile, comme dans Tk
        });
        b.addEventListener("mouseup", arreter);
        b.addEventListener("mouseleave", arreter);
        fleches.appendChild(b);
      }
      d.append(i, fleches);
      e = d;
      break;
    }
    case "select": {
      // OptionMenu, Combobox en lecture seule, Spinbox à valeurs
      const s = el("select", "tk-w tk-select");
      s.addEventListener("change", () => appeler(id, "commande", { valeur: s.value, index: s.selectedIndex }));
      e = s;
      break;
    }
    case "combobox": {
      // Éditable : champ + liste de suggestions ; « readonly » : vraie liste déroulante.
      const d = el("div", "tk-w tk-combo");
      d.style.display = "flex";
      const i = el("input", "tk-entry");
      i.type = "text";
      i.spellcheck = false;
      const liste = el("datalist");
      liste.id = `tk-liste-${id}`;
      i.setAttribute("list", liste.id);
      i.style.flex = "1";
      i.style.minWidth = "0";
      i.addEventListener("mousedown", () => appeler(id, "ouvrir")); // postcommand, avant l'affichage de la liste
      i.addEventListener("input", (ev) => {
        // Choix dans la liste (pas une frappe) : seul cas où Tk envoie <<ComboboxSelected>>.
        const type = (ev as InputEvent).inputType;
        const choisi = (type === undefined || type === "insertReplacementText") && [...liste.options].some((o) => o.value === i.value);
        appeler(id, choisi ? "commande" : "valeur", { valeur: i.value });
      });
      const s = el("select", "tk-select");
      s.style.flex = "1";
      s.style.minWidth = "0";
      s.style.display = "none";
      s.addEventListener("mousedown", () => appeler(id, "ouvrir"));
      s.addEventListener("change", () => {
        i.value = s.value;
        appeler(id, "commande", { valeur: s.value });
      });
      d.append(i, liste, s);
      e = d;
      break;
    }
    case "progressbar": {
      const p = el("progress", "tk-w tk-progress");
      e = p;
      break;
    }
    case "separator":
      e = el("div", "tk-w tk-separateur");
      break;
    case "scrollbar":
      e = el("div", "tk-w");
      e.style.display = "none"; // les zones défilent nativement
      break;
    case "canvas": {
      const d = el("div", "tk-w tk-canvas");
      const s = document.createElementNS(SVG, "svg");
      d.appendChild(s);
      w.canvas = { svg: s, items: new Map(), fenetres: new Map(), anime: 0, file: [], enCours: false };
      d.addEventListener("scroll", () => signalerDefilement(w));
      e = d;
      contenu = d;
      break;
    }
    case "treeview": {
      const d = el("div", "tk-w tk-tableau");
      d.tabIndex = 0;
      const table = el("table");
      table.append(el("colgroup"), el("thead"), el("tbody"));
      d.appendChild(table);
      brancherArbre(w, d);
      e = d;
      break;
    }
    case "notebook": {
      e = el("div", "tk-w tk-onglets");
      const tabs = el("div", "tk-tabs");
      const page = el("div", "tk-page");
      e.append(tabs, page);
      contenu = page;
      break;
    }
    case "image":
      e = el("div", "tk-w tk-label");
      break;
    default:
      e = el("div", "tk-w tk-frame");
  }
  e.dataset.tkid = String(id);
  w.el = e;
  w.contenu = contenu ?? e;
  if (type === "entry" || type === "text" || type === "spinbox" || type === "combobox") brancherPressePapiers(w);
  widgets.set(id, w);
  parent.enfants.push(w);
  configurer(id, opts);
}

/** Fenêtre ou image intégrée dans un Text (window_create / image_create) : hors du texte. */
function integre(n: Node): boolean {
  return n instanceof HTMLElement && n.dataset.integre !== undefined;
}

/** La sélection du document est-elle dans cette zone (avec ou sans focus) ? */
function selectionDans(t: HTMLElement): boolean {
  const s = window.getSelection();
  return !!(s && s.rangeCount && s.anchorNode && s.focusNode && t.contains(s.anchorNode) && t.contains(s.focusNode));
}

/**
 * OptionMenu : la variable peut valoir un texte hors de la liste (« Choisissez… ») ; Tk l'affiche. Option
 * cachée ajoutée en fin de liste : les indices des vraies options ne bougent pas.
 */
function choisirValeur(s: HTMLSelectElement, v: string) {
  let hors = s.querySelector("option[data-hors-liste]") as HTMLOptionElement | null;
  if ([...s.options].some((o) => o !== hors && o.value === v)) {
    hors?.remove();
    s.value = v;
    return;
  }
  if (!hors) {
    hors = el("option");
    hors.dataset.horsListe = "";
    hors.hidden = true;
    s.appendChild(hors);
  }
  hors.value = hors.textContent = v;
  s.value = v;
}

/** Combobox en lecture seule : l'option cachée d'indice 0 montre une valeur posée hors de la liste (set()). */
function valeurCombo(s: HTMLSelectElement, v: string) {
  const cachee = s.options[0];
  if (cachee) cachee.value = cachee.textContent = [...s.options].slice(1).some((op) => op.value === v) ? "" : v;
  s.value = v;
}

function lireTexte(t: HTMLElement): string {
  // Contenu exact (textContent ne compte pas les <br> qu'un collage peut laisser).
  let s = "";
  const parcourir = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) s += (c as Text).data;
      else if (c.nodeName === "BR") s += "\n";
      else if (!integre(c)) parcourir(c);
    }
  };
  parcourir(t);
  return s;
}

/** Nombre de caractères avant la position (nœud, décalage) dans la zone de texte. */
function decalageDans(t: HTMLElement, noeud: Node, pos: number): number {
  let n = 0;
  let fini = false;
  const parcourir = (x: Node) => {
    for (let i = 0; i < x.childNodes.length && !fini; i++) {
      if (x === noeud && i === pos) {
        fini = true;
        return;
      }
      const c = x.childNodes[i];
      if (c === noeud && c.nodeType === Node.TEXT_NODE) {
        n += pos;
        fini = true;
        return;
      }
      if (c.nodeType === Node.TEXT_NODE) n += (c as Text).data.length;
      else if (c.nodeName === "BR") n += 1;
      else if (!integre(c)) parcourir(c);
    }
    if (x === noeud) fini = true;
  };
  parcourir(t);
  return n;
}

/** Position DOM (nœud, décalage) du n-ième caractère de la zone de texte. */
function pointDans(t: HTMLElement, cible: number): [Node, number] {
  let reste = Math.max(0, cible);
  let trouve: [Node, number] | null = null;
  const parcourir = (x: Node) => {
    for (let i = 0; i < x.childNodes.length && !trouve; i++) {
      const c = x.childNodes[i];
      if (c.nodeType === Node.TEXT_NODE) {
        const l = (c as Text).data.length;
        if (reste <= l) {
          trouve = [c, reste];
          return;
        }
        reste -= l;
      } else if (c.nodeName === "BR") {
        if (reste === 0) {
          trouve = [x, i];
          return;
        }
        reste -= 1;
      } else if (!integre(c)) parcourir(c);
    }
  };
  parcourir(t);
  return trouve ?? [t, t.childNodes.length];
}

/** Sélection courante d'un widget Text [ancre, curseur] en caractères (dernière connue s'il n'a pas le focus). */
function lireSelectionTexte(w: Widget): [number, number] | null {
  const t = w.el;
  const sel = window.getSelection();
  if (sel && selectionDans(t)) {
    w.selTexte = [decalageDans(t, sel.anchorNode!, sel.anchorOffset), decalageDans(t, sel.focusNode!, sel.focusOffset)];
  }
  return w.selTexte ?? null;
}

function placerSelectionTexte(w: Widget, a: number, b: number, force = false) {
  w.selTexte = [a, b];
  if (!force && document.activeElement !== w.el && !selectionDans(w.el)) return;
  const sel = window.getSelection();
  const [na, oa] = pointDans(w.el, a);
  const [nb2, ob] = pointDans(w.el, b);
  try {
    sel?.setBaseAndExtent(na, oa, nb2, ob);
  } catch {
    /* position hors du contenu : ignorée */
  }
}

/** Caractère sous le point (coordonnées de la page), en décalage dans la zone de texte. */
function decalageAuPoint(t: HTMLElement, x: number, y: number): number | undefined {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let noeud: Node | null = null;
  let pos = 0;
  if (typeof d.caretPositionFromPoint === "function") {
    const p = d.caretPositionFromPoint(x, y);
    if (p) [noeud, pos] = [p.offsetNode, p.offset];
  } else if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    if (r) [noeud, pos] = [r.startContainer, r.startOffset];
  }
  if (!noeud || !t.contains(noeud)) return undefined;
  const o = decalageDans(t, noeud, pos);
  // Le curseur se place APRÈS un caractère cliqué sur sa moitié droite : on vise le caractère lui-même.
  if (o > 0) {
    const r = document.createRange();
    const [n1, k1] = pointDans(t, o - 1);
    const [n2, k2] = pointDans(t, o);
    try {
      r.setStart(n1, k1);
      r.setEnd(n2, k2);
      const b = r.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return o - 1;
    } catch {
      /* plage invalide : on garde o */
    }
  }
  return o;
}

/** Fait défiler une zone de texte pour montrer le caractère donné (Text.see). */
function voirDecalage(t: HTMLElement, pos: number) {
  const [n, o] = pointDans(t, pos);
  const r = document.createRange();
  try {
    r.setStart(n, o);
    if (n.nodeType === Node.TEXT_NODE && o < (n as Text).data.length) r.setEnd(n, o + 1);
    else r.collapse(true);
  } catch {
    return;
  }
  const b = r.getBoundingClientRect();
  if (!b.height) {
    if (pos >= lireTexte(t).length - 1) t.scrollTop = t.scrollHeight;
    return;
  }
  const z = t.getBoundingClientRect();
  if (b.top < z.top) t.scrollTop -= z.top - b.top + 2;
  else if (b.bottom > z.bottom) t.scrollTop += b.bottom - z.bottom + 2;
}

/** yscrollcommand : position de défilement envoyée au Python s'il la suit. */
function signalerDefilement(w: Widget) {
  if (!w.opts.suiviDefilement) return;
  const e = w.el;
  const h = e.scrollHeight || 1;
  const l = e.scrollWidth || 1;
  appeler(w.id, "defilement", {
    debut: e.scrollTop / h, fin: Math.min(1, (e.scrollTop + e.clientHeight) / h),
    debutX: e.scrollLeft / l, finX: Math.min(1, (e.scrollLeft + e.clientWidth) / l),
  });
}

/** Champ de saisie d'un widget (Entry, Spinbox, Combobox). */
function champDe(w: Widget): HTMLInputElement | null {
  if (w.el instanceof HTMLInputElement) return w.el;
  return w.el.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=range])");
}

/** Copier, couper, coller, tout sélectionner dans un champ ou un Text (<<Copy>>, <<Paste>>…). */
function actionEdition(w: Widget, valeur: unknown) {
  const [action, secours] = Array.isArray(valeur) ? [texte(valeur[0]), texte(valeur[1])] : [texte(valeur), ""];
  const cible: HTMLElement | null = w.type === "text" ? w.el : champDe(w);
  if (!cible) return;
  const sel = w.type === "text" ? w.selTexte : null;
  cible.focus({ preventScroll: true });
  if (sel) placerSelectionTexte(w, sel[0], sel[1]);
  if (action === "toutSelectionner") {
    if (cible instanceof HTMLInputElement) cible.select();
    else placerSelectionTexte(w, 0, lireTexte(cible).length);
  } else if (action === "coller") {
    const coller = (t: string) => {
      cible.focus({ preventScroll: true });
      if (t) document.execCommand("insertText", false, t);
    };
    const lecture = navigator.clipboard?.readText?.();
    if (lecture) lecture.then(coller, () => coller(secours));
    else coller(secours);
  } else {
    const commande = ({ copier: "copy", couper: "cut", effacer: "delete", annuler: "undo", retablir: "redo" } as Record<string, string>)[action];
    enActionEdition = true; // event_generate("<<Copy>>") : déjà distribué côté Python, pas une 2e fois
    try {
      if (commande) document.execCommand(commande);
    } finally {
      enActionEdition = false;
    }
  }
}

let enActionEdition = false;

/** Copier / couper / coller de l'utilisateur : <<Copy>>, <<Cut>>, <<Paste>> distribués au Python avant l'action. */
function brancherPressePapiers(w: Widget) {
  for (const [dom, nom] of [["copy", "<<Copy>>"], ["cut", "<<Cut>>"], ["paste", "<<Paste>>"]] as const) {
    w.el.addEventListener(dom, (ev) => {
      if (enActionEdition) return;
      const ce = ev as ClipboardEvent;
      let txt = "";
      if (dom === "paste") txt = ce.clipboardData?.getData("text/plain") ?? "";
      else if (w.type === "text") {
        lireSelectionTexte(w);
        txt = String(window.getSelection() ?? "");
      } else {
        const c = champDe(w);
        if (c) txt = c.value.slice(c.selectionStart ?? 0, c.selectionEnd ?? 0);
      }
      if (appeler(w.id, "presse", { nom, texte: txt }) === "break") ce.preventDefault();
    });
  }
}

function appliquerCommun(w: Widget, o: Opts) {
  const s = w.el.style;
  // LabelFrame : police et couleur ne concernent que son titre (pas les widgets qu'il contient).
  const st = w.type === "labelframe" ? (w.el.querySelector("legend") as HTMLElement).style : s;
  if ("fond" in o) s.background = texte(o.fond);
  if ("couleur" in o) st.color = texte(o.couleur);
  if ("police" in o) st.font = texte(o.police);
  if ("bordure" in o || "relief" in o) {
    const ep = nb(o.bordure ?? w.opts.bordure, 0);
    const rel = texte(o.relief ?? w.opts.relief);
    const style: Record<string, string> = { raised: "outset", sunken: "inset", groove: "groove", ridge: "ridge", solid: "solid", flat: "solid" };
    if (rel && rel !== "flat" && ep > 0) s.border = `${ep}px ${style[rel] ?? "solid"} #a0a0a0`;
    else if (rel === "flat" || ep === 0) s.borderStyle = "none";
    if (rel === "solid" && ep > 0) s.border = `${ep}px solid #000`;
  }
  if ("curseur" in o) {
    const c: Record<string, string> = { hand2: "pointer", hand1: "pointer", xterm: "text", watch: "wait", cross: "crosshair", crosshair: "crosshair", arrow: "default", fleur: "move" };
    s.cursor = c[texte(o.curseur)] ?? "";
  }
  if ("padx" in o || "pady" in o) {
    const [px] = paire(o.padx ?? w.opts.padx ?? 0);
    const [py] = paire(o.pady ?? w.opts.pady ?? 0);
    if (o.padx !== undefined || o.pady !== undefined) s.padding = `${py}px ${px}px`;
  }
  if ("dimensions" in o) {
    // largeur / hauteur demandées : en caractères/lignes ou en pixels (le gestionnaire peut étirer)
    const d = o.dimensions as Opts;
    const unite = (v: unknown, u: unknown) => (v === undefined || v === null || nb(v) <= 0 ? "" : u === "car" ? `${nb(v) + 1}ch` : u === "lignes" ? `${nb(v) * 1.3 + 0.4}em` : `${nb(v)}px`);
    w.dimL = unite(d.largeur, d.uniteL);
    w.dimH = unite(d.hauteur, d.uniteH);
    w.opts.dimensions = d;
    appliquerTaille(w);
  }
}

function contenuLibelle(cible: HTMLElement, o: Opts, w: Widget) {
  const t = o.texte ?? w.opts.texte;
  const image = (o.image ?? w.opts.image) as Opts | null | undefined;
  const compose = texte(o.compose ?? w.opts.compose) || "none";
  const morceaux: Node[] = [];
  let img: HTMLImageElement | null = null;
  if (image && image.src) {
    img = el("img");
    img.src = texte(image.src);
    if (image.largeur) img.width = nb(image.largeur);
    if (image.hauteur) img.height = nb(image.hauteur);
    img.draggable = false;
  }
  // Texte vide : une espace insécable garde la hauteur d'une ligne, comme un Label Tk vide.
  const span = document.createTextNode(texte(t) || (img ? "" : "\u00a0"));
  if (img && (compose === "none" || !texte(t))) morceaux.push(img);
  else if (img) {
    if (compose === "left" || compose === "top") morceaux.push(img, span);
    else morceaux.push(span, img);
    cible.style.flexDirection = compose === "top" || compose === "bottom" ? "column" : "row";
  } else morceaux.push(span);
  cible.replaceChildren(...morceaux);
}

function configurer(id: number, o: Opts) {
  const w = widgets.get(id);
  if (!w) return;
  if (w.type === "fenetre") {
    configurerFenetre(w.fen, o);
    Object.assign(w.opts, o);
    return;
  }
  appliquerCommun(w, o);
  const e = w.el;
  const desactive = "etat" in o ? o.etat === "disabled" : undefined;
  switch (w.type) {
    case "label":
    case "message":
    case "image": {
      if ("texte" in o || "image" in o || "compose" in o) contenuLibelle(e, o, w);
      if ("ancre" in o) {
        const [h, v] = ancreFlex(o.ancre);
        e.style.justifyContent = h;
        e.style.alignItems = v;
      }
      if ("justif" in o) e.style.textAlign = texte(o.justif);
      if ("retour" in o || w.type === "message") {
        const r = nb(o.retour ?? w.opts.retour, w.type === "message" ? 300 : 0);
        e.style.whiteSpace = r > 0 ? "pre-wrap" : "pre";
        e.style.maxWidth = r > 0 ? `${r}px` : "";
      }
      if (desactive !== undefined) e.style.color = desactive ? "#a0a0a0" : texte(w.opts.couleur ?? o.couleur);
      break;
    }
    case "button": {
      if ("texte" in o || "image" in o || "compose" in o) contenuLibelle(e, o, w);
      if ("ancre" in o) e.style.justifyContent = ancreFlex(o.ancre)[0];
      if (desactive !== undefined) (e as HTMLButtonElement).disabled = desactive;
      if ("actif" in o) e.style.background = texte(o.actif);
      break;
    }
    case "entry":
    case "spinbox": {
      const i = champDe(w)!;
      if ("valeur" in o && i.value !== texte(o.valeur)) {
        // Comme EntrySetValue de Tk : le curseur garde sa place (bornée), il ne saute pas en fin de champ.
        const v = texte(o.valeur);
        const [d, f] = [i.selectionStart, i.selectionEnd];
        i.value = v;
        if (d !== null && f !== null && document.activeElement === i) i.setSelectionRange(Math.min(d, v.length), Math.min(f, v.length));
      }
      if ("masque" in o) i.type = o.masque ? "password" : "text";
      if ("etat" in o) {
        i.disabled = o.etat === "disabled";
        i.readOnly = o.etat === "readonly";
        e.querySelectorAll("button").forEach((b) => (b.disabled = o.etat === "disabled"));
      }
      if ("justif" in o) i.style.textAlign = texte(o.justif);
      if (i !== e) {
        // Spinbox : le fond et la couleur vont au champ, pas au cadre des flèches.
        if ("fond" in o) [i.style.background, e.style.background] = [texte(o.fond), ""];
        if ("couleur" in o) i.style.color = texte(o.couleur);
      }
      break;
    }
    case "text": {
      // Calculé AVANT de redessiner : ensuite la plage retombe sur la zone elle-même.
      const garder = document.activeElement === e || selectionDans(e);
      if ("contenu" in o) dessinerTexte(e, o.contenu as Opts[]);
      if ("curseur" in o) {
        const c = o.curseur as number[] | number;
        w.selTexte = Array.isArray(c) ? [nb(c[0]), nb(c[1] ?? c[0])] : [nb(c), nb(c)];
      }
      if (("contenu" in o || "curseur" in o) && w.selTexte && garder) placerSelectionTexte(w, w.selTexte[0], w.selTexte[1], true);
      if ("etat" in o) e.contentEditable = o.etat === "disabled" ? "false" : "plaintext-only";
      if ("retourLigne" in o) {
        e.style.whiteSpace = o.retourLigne === "none" ? "pre" : "pre-wrap";
        e.classList.toggle("mots", o.retourLigne === "word");
      }
      if ("defiler" in o) e.scrollTop = o.defiler === "fin" ? e.scrollHeight : 0;
      if ("voir" in o) voirDecalage(e, nb(o.voir));
      break;
    }
    case "listbox": {
      const s = e as HTMLSelectElement;
      if ("hauteurLignes" in o) s.size = Math.max(2, nb(o.hauteurLignes, 10));
      if ("multiple" in o) {
        s.multiple = !!o.multiple;
        s.dataset.bascule = o.multiple === "bascule" ? "1" : "";
      }
      if ("elements" in o) {
        const els = (o.elements as Opts[]) ?? [];
        const sel = new Set([...s.selectedOptions].map((x) => x.index));
        s.replaceChildren(
          ...els.map((it, i) => {
            const op = el("option");
            op.textContent = texte(it.texte) || " ";
            if (it.fond) op.style.background = texte(it.fond);
            if (it.couleur) op.style.color = texte(it.couleur);
            op.selected = sel.has(i);
            return op;
          }),
        );
      }
      if ("selection" in o) {
        const sel = new Set((o.selection as number[]) ?? []);
        [...s.options].forEach((op, i) => (op.selected = sel.has(i)));
      }
      if ("voir" in o && s.options.length) {
        const h = hauteurOption(s);
        const haut = Math.max(0, Math.min(s.options.length - 1, nb(o.voir))) * h;
        if (haut < s.scrollTop) s.scrollTop = haut;
        else if (haut + h > s.scrollTop + s.clientHeight) s.scrollTop = haut + h - s.clientHeight;
      }
      if (desactive !== undefined) s.disabled = desactive;
      break;
    }
    case "checkbutton":
    case "radiobutton": {
      const i = e.querySelector("input") as HTMLInputElement;
      const span = e.querySelector("span") as HTMLElement;
      if ("texte" in o) span.textContent = texte(o.texte);
      if ("coche" in o) i.checked = !!o.coche;
      if ("groupe" in o) i.name = texte(o.groupe);
      if (desactive !== undefined) {
        i.disabled = desactive;
        e.style.color = desactive ? "#a0a0a0" : "";
      }
      if ("indicateur" in o && o.indicateur === false) {
        i.style.display = "none";
        e.classList.add("tk-button");
      }
      break;
    }
    case "scale": {
      const [lib, v, i] = [...e.children] as [HTMLElement, HTMLElement, HTMLInputElement];
      if ("de" in o) i.min = texte(o.de);
      if ("a" in o) i.max = texte(o.a);
      if ("pas" in o) i.step = texte(o.pas) || "any";
      if ("valeur" in o) {
        i.value = texte(o.valeur);
        v.textContent = i.value;
      }
      if ("etiquette" in o) lib.textContent = texte(o.etiquette);
      if ("montrerValeur" in o) v.style.display = o.montrerValeur ? "" : "none";
      if ("orient" in o) {
        const vertical = o.orient === "vertical";
        e.classList.toggle("vertical", vertical);
        i.style.writingMode = vertical ? "vertical-lr" : "";
      }
      if ("longueur" in o || "orient" in o) {
        // length = longueur de la glissière : taille demandée du widget (fill / sticky peuvent l'étirer).
        const vertical = (o.orient ?? w.opts.orient) === "vertical";
        const l = `${nb(o.longueur ?? w.opts.longueur, 100)}px`;
        i.style.width = vertical ? "" : "100%";
        i.style.height = vertical ? "100%" : "";
        [w.dimL, w.dimH] = vertical ? ["", l] : [l, ""];
        appliquerTaille(w);
      }
      if (desactive !== undefined) i.disabled = desactive;
      break;
    }
    case "select": {
      const s = e as HTMLSelectElement;
      if ("valeurs" in o) {
        const actuelle = s.value;
        s.replaceChildren(
          ...((o.valeurs as unknown[]) ?? []).map((v) => {
            const op = el("option");
            op.value = op.textContent = texte(v);
            return op;
          }),
        );
        choisirValeur(s, actuelle);
      }
      if ("valeur" in o) choisirValeur(s, texte(o.valeur));
      if (desactive !== undefined) s.disabled = desactive;
      break;
    }
    case "combobox": {
      const i = e.querySelector("input") as HTMLInputElement;
      const liste = e.querySelector("datalist") as HTMLDataListElement;
      const s = e.querySelector("select") as HTMLSelectElement;
      if ("valeurs" in o) {
        const valeurs = ((o.valeurs as unknown[]) ?? []).map(texte);
        liste.replaceChildren(
          ...valeurs.map((v) => {
            const op = el("option");
            op.value = v;
            return op;
          }),
        );
        s.replaceChildren(
          ...["", ...valeurs].map((v) => {
            const op = el("option");
            op.value = op.textContent = v;
            if (!v) op.hidden = true;
            return op;
          }),
        );
        valeurCombo(s, i.value);
      }
      if ("valeur" in o) {
        i.value = texte(o.valeur);
        valeurCombo(s, i.value);
      }
      if ("etat" in o) {
        const lecture = o.etat === "readonly";
        i.style.display = lecture ? "none" : "";
        s.style.display = lecture ? "" : "none";
        i.disabled = s.disabled = o.etat === "disabled";
      }
      if ("police" in o) i.style.font = s.style.font = texte(o.police);
      if ("fond" in o) [i.style.background, s.style.background, e.style.background] = [texte(o.fond), texte(o.fond), ""];
      if ("couleur" in o) i.style.color = s.style.color = texte(o.couleur);
      if ("justif" in o) i.style.textAlign = texte(o.justif);
      break;
    }
    case "progressbar": {
      const p = e as HTMLProgressElement;
      if ("maximum" in o) p.max = nb(o.maximum, 100);
      if ("valeur" in o || "indetermine" in o) {
        if (o.indetermine ?? w.opts.indetermine) p.removeAttribute("value");
        else p.value = nb(o.valeur ?? w.opts.valeur);
      }
      if ("longueur" in o) {
        if ((o.orient ?? w.opts.orient) === "vertical") p.style.height = `${nb(o.longueur)}px`;
        else p.style.width = `${nb(o.longueur)}px`;
      }
      if ("orient" in o && o.orient === "vertical") p.style.writingMode = "vertical-lr";
      break;
    }
    case "separator": {
      const vertical = (o.orient ?? w.opts.orient) === "vertical";
      e.style.width = vertical ? "1px" : "";
      e.style.height = vertical ? "" : "1px";
      e.style.alignSelf = "stretch";
      break;
    }
    case "labelframe":
      if ("texte" in o) (e.querySelector("legend") as HTMLElement).textContent = texte(o.texte);
      break;
    case "canvas": {
      const c = w.canvas!;
      if ("anime" in o) c.anime = nb(o.anime);
      if ("zone" in o) definirZone(w, o.zone);
      if ("dimensions" in o) {
        const d = o.dimensions as Opts;
        c.svg.setAttribute("width", texte(d.largeur));
        c.svg.setAttribute("height", texte(d.hauteur));
      }
      break;
    }
    case "treeview":
      if ("hauteurLignes" in o) {
        w.opts.hauteurLignes = o.hauteurLignes;
        tailleArbre(w);
      }
      if ("arbre" in o) dessinerArbre(w, o.arbre as Opts);
      break;
    case "notebook":
      if ("onglets" in o) dessinerOnglets(w, o.onglets as Opts);
      break;
  }
  if ("propage" in o) {
    w.propage = !!o.propage;
    demanderDisposition(w);
  }
  if ("suiviDefilement" in o) w.opts.suiviDefilement = o.suiviDefilement;
  Object.assign(w.opts, o);
  if (w.type === "frame" || w.type === "labelframe") tailleCadre(w);
  // Le navigateur recalcule seul les tailles : on ne re-range que si la géométrie change
  // (re-ranger détacherait les éléments et ferait perdre le focus au champ en cours de saisie).
}

/** Un cadre prend la taille de ses enfants, sauf s'il est vide ou si la propagation est coupée. */
/** Un cadre prend la taille de ses enfants, sauf s'il est vide ou si la propagation est coupée. */
function tailleCadre(w: Widget) {
  const d = w.opts.dimensions as Opts | undefined;
  const geres = w.enfants.some((e) => e.geo && !e.detruit && e.geo.gestion !== "place");
  const fixe = !w.propage || !geres;
  const l = d?.largeur !== undefined && d?.largeur !== null ? nb(d.largeur) : 0;
  const h = d?.hauteur !== undefined && d?.hauteur !== null ? nb(d.hauteur) : 0;
  const po = w.geo?.gestion === "place" ? w.geo.opts : null;
  const s = w.el.style;
  // Avec place(), width/height/relwidth/relheight imposent la taille : on n'y touche pas.
  // Largeur : toujours posée (taille demandée = contribution intrinsèque) ; flex « 1 1 auto » l'étire.
  // place() sans width : taille demandée (max-content), sinon la largeur serait bornée par 1 − relx.
  // create_window(width=…) : la taille imposée par l'élément de canvas l'emporte.
  const tc = w.tailleCanvas;
  if (tc?.l) s.width = `${tc.l}px`;
  else if (!(po && (po.width !== undefined || po.relwidth !== undefined))) s.width = fixe && l > 0 ? `${l}px` : po ? "max-content" : "";
  if (tc?.h) {
    s.height = `${tc.h}px`;
    s.minHeight = "";
  } else if (!(po && (po.height !== undefined || po.relheight !== undefined))) {
    s.height = fixe && h > 0 && !w.etire?.y ? `${h}px` : "";
    s.minHeight = fixe && h > 0 && w.etire?.y ? `${h}px` : "";
  }
}

/** Applique la taille demandée d'un widget, sauf sur les axes où son gestionnaire l'étire. */
function appliquerTaille(w: Widget) {
  if (w.type === "frame" || w.type === "labelframe") {
    tailleCadre(w);
    return;
  }
  const s = w.el.style;
  const po = w.geo?.gestion === "place" ? w.geo.opts : null;
  // Largeur demandée toujours posée : c'est la base du flex (« 1 1 auto »), fill / sticky l'agrandissent.
  // Hauteur : sur l'axe transversal, un étirement exige une hauteur automatique (minimum = demandée).
  const tc = w.tailleCanvas;
  if (tc?.l) s.width = `${tc.l}px`;
  else if (!(po && (po.width !== undefined || po.relwidth !== undefined))) s.width = w.dimL ?? (po ? "max-content" : "");
  if (tc?.h) {
    s.height = `${tc.h}px`;
    s.minHeight = "";
  } else if (!(po && (po.height !== undefined || po.relheight !== undefined))) {
    s.height = w.etire?.y ? "" : (w.dimH ?? "");
    s.minHeight = w.etire?.y ? (w.dimH ?? "") : "";
  }
}

function morceauTexte(txt: string, st: Opts | null): Node {
  if (!st) return document.createTextNode(txt);
  const s = el("span");
  s.textContent = txt;
  if (st.couleur) s.style.color = texte(st.couleur);
  if (st.fond) s.style.background = texte(st.fond);
  if (st.police) s.style.font = texte(st.police);
  if (st.souligne) s.style.textDecoration = "underline";
  if (st.barre) s.style.textDecoration = "line-through";
  if (st.cache) s.style.display = "none"; // elide
  return s;
}

/** Fenêtre (window_create) ou image (image_create) intégrée au fil du texte. */
function morceauIntegre(sg: Opts): Node | null {
  const boite = el("span");
  boite.dataset.integre = "";
  boite.contentEditable = "false";
  boite.style.display = "inline-block";
  boite.style.verticalAlign = sg.align === "top" ? "top" : sg.align === "bottom" ? "bottom" : sg.align === "baseline" ? "baseline" : "middle";
  const [px, py] = paire(sg.marge ?? 0);
  boite.style.padding = `${py}px ${px}px`;
  if (sg.widget !== undefined) {
    const k = widgets.get(nb(sg.widget));
    if (!k || k.detruit) return null;
    k.etire = { x: false, y: false };
    libererPlace(k);
    k.el.style.position = "relative";
    appliquerTaille(k);
    boite.appendChild(k.el);
  } else {
    const img = el("img");
    img.src = texte(sg.image);
    img.style.display = "block";
    boite.appendChild(img);
  }
  return boite;
}

/** replaceChildren sans décomposer le tableau en arguments (au-delà de ~120 000 nœuds : « Maximum call stack »). */
function remplacerEnfants(cible: Element, noeuds: Node[]) {
  const f = document.createDocumentFragment();
  for (const n of noeuds) f.appendChild(n);
  cible.replaceChildren(f);
}

function dessinerTexte(t: HTMLElement, segments: Opts[]) {
  // Comme Tk : la vue garde sa position (un Text ne suit jamais tout seul les insertions ; see("end") le fait).
  const haut = t.scrollTop;
  const gauche = t.scrollLeft;
  const sgs = segments ?? [];
  const justif = (st: unknown) => {
    const j = st ? texte((st as Opts).justif) : "";
    return j && j !== "left" ? j : "";
  };
  if (!sgs.some((sg) => justif(sg.style))) {
    remplacerEnfants(t, sgs.map((sg) => (sg.widget !== undefined || sg.image !== undefined ? morceauIntegre(sg) : morceauTexte(texte(sg.texte), (sg.style as Opts) ?? null))).filter(Boolean) as Node[]);
  } else {
    // justify : par ligne logique, selon le tag du premier caractère visible ; la ligne devient un bloc aligné.
    const noeuds: Node[] = [];
    let ligne: Node[] = [];
    let jl = "";
    let vu = false;
    const fermer = () => {
      if (jl) {
        const b = el("span");
        b.style.display = "block";
        b.style.textAlign = jl;
        for (const n of ligne) b.appendChild(n);
        noeuds.push(b);
      } else noeuds.push(...ligne);
      ligne = [];
      jl = "";
      vu = false;
    };
    for (const sg of sgs) {
      if (sg.widget !== undefined || sg.image !== undefined) {
        const n = morceauIntegre(sg);
        if (n) ligne.push(n);
        vu = true;
        continue;
      }
      const st = (sg.style as Opts) ?? null;
      const parts = texte(sg.texte).split("\n");
      parts.forEach((part, i) => {
        if (i > 0) {
          ligne.push(morceauTexte("\n", st));
          fermer();
        }
        if (!part) return;
        if (!vu && !(st && st.cache)) {
          jl = justif(st);
          vu = true;
        }
        ligne.push(morceauTexte(part, st));
      });
    }
    if (ligne.length) fermer();
    remplacerEnfants(t, noeuds);
  }
  t.scrollTop = Math.min(haut, Math.max(0, t.scrollHeight - t.clientHeight));
  t.scrollLeft = gauche;
}

function alignement(a: unknown): string {
  const x = normAncre(a, "w");
  return x.includes("e") ? "right" : x.includes("w") ? "left" : "center";
}

/** Taille demandée d'un Treeview : somme des colonnes × « height » lignes. */
function tailleArbre(w: Widget) {
  const hl = nb(w.opts.hauteurLigne, 22);
  w.dimL = `${nb(w.opts.largeurArbre, 400) + 2}px`;
  w.dimH = `${nb(w.opts.hauteurLignes, 10) * hl + (w.opts.entetes === false ? 0 : 26) + 2}px`;
  appliquerTaille(w);
}

function dessinerArbre(w: Widget, a: Opts) {
  const table = w.el.querySelector("table") as HTMLTableElement;
  const groupe = table.querySelector("colgroup") as HTMLElement;
  const thead = table.tHead as HTMLTableSectionElement;
  const tbody = table.tBodies[0];
  const colonnes = (a.colonnes as Opts[]) ?? [];
  const lignes = (a.lignes as Opts[]) ?? [];
  const selection = new Set((a.selection as string[]) ?? []);
  w.opts.modeArbre = !!a.arbre;
  w.el.dataset.focus = texte(a.focus);
  // Largeurs fixes (table-layout: fixed) ; une colonne de largeur 0 est masquée (astuce courante pour « #0 »).
  const largeurs = colonnes.map((c) => (c.largeur === undefined || c.largeur === null ? 200 : Math.max(0, nb(c.largeur, 200))));
  const visibles = largeurs.map((l) => l > 0);
  const total = largeurs.reduce((x, l) => x + l, 0);
  const etire = colonnes.some((c, i) => visibles[i] && c.etire !== false);
  groupe.replaceChildren(
    ...colonnes.flatMap((_, i) => {
      if (!visibles[i]) return [];
      const col = el("col");
      col.style.width = `${largeurs[i]}px`;
      return [col];
    }),
  );
  table.style.width = etire ? `max(100%, ${total}px)` : `${total}px`;
  const hl = nb(a.hauteurLigne, 22);
  w.el.style.setProperty("--tk-ligne", `${hl}px`);
  thead.replaceChildren();
  if (a.entetes !== false) {
    const tr = el("tr");
    colonnes.forEach((c, i) => {
      const th = el("th");
      th.textContent = texte(c.titre);
      th.dataset.colonne = texte(c.id);
      th.style.textAlign = alignement(c.ancreTitre ?? "center");
      if (!visibles[i]) th.className = "cache";
      tr.appendChild(th);
    });
    thead.appendChild(tr);
  }
  // Lignes réutilisées par identifiant : un double-clic garde sa cible, changer la sélection ne redessine rien.
  const anciennes = w.lignesArbre ?? new Map<string, HTMLTableRowElement>();
  const nouvelles = new Map<string, HTMLTableRowElement>();
  const ordre: HTMLTableRowElement[] = [];
  for (const l of lignes) {
    const iid = texte(l.iid);
    const tr = anciennes.get(iid) ?? el("tr");
    tr.dataset.iid = iid;
    nouvelles.set(iid, tr);
    tr.className = selection.has(iid) ? "sel" : "";
    tr.style.background = texte(l.fond);
    tr.style.color = texte(l.couleur);
    tr.style.font = texte(l.police);
    tr.dataset.niveau = String(nb(l.niveau));
    tr.dataset.enfants = l.aEnfants ? (l.ouvert ? "ouvert" : "ferme") : "";
    const valeurs = (l.cellules as unknown[]) ?? [];
    while (tr.cells.length > valeurs.length) tr.deleteCell(tr.cells.length - 1);
    valeurs.forEach((v, i) => {
      const td = tr.cells[i] ?? tr.insertCell();
      let t = texte(v);
      if (i === 0 && a.arbre) {
        td.style.paddingLeft = `${6 + nb(l.niveau) * 16}px`;
        t = (l.aEnfants ? (l.ouvert ? "▾ " : "▸ ") : "") + t;
      } else td.style.paddingLeft = "";
      if (td.textContent !== t) td.textContent = t;
      td.style.textAlign = alignement(colonnes[i]?.ancre);
      td.className = visibles[i] === false ? "cache" : "";
    });
    ordre.push(tr);
  }
  const actuelles = [...tbody.rows];
  if (actuelles.length !== ordre.length || actuelles.some((r, i) => r !== ordre[i])) remplacerEnfants(tbody, ordre);
  w.lignesArbre = nouvelles;
  w.opts.largeurArbre = total;
  w.opts.hauteurLigne = hl;
  w.opts.entetes = a.entetes !== false;
  tailleArbre(w);
  if (a.voir) nouvelles.get(texte(a.voir))?.scrollIntoView({ block: "nearest" });
}

/** Zone de la flèche ▸ / ▾ d'une ligne (clic = ouvrir / fermer). */
function surFleche(ev: MouseEvent, tr: HTMLElement, w: Widget): boolean {
  const td = (ev.target as HTMLElement).closest("td") as HTMLTableCellElement | null;
  if (!td || td.cellIndex !== 0 || !w.opts.modeArbre || !tr.dataset.enfants) return false;
  return ev.clientX - td.getBoundingClientRect().left < 6 + nb(tr.dataset.niveau) * 16 + 14;
}

/** Souris et clavier d'un Treeview : sélection au clic (comme Tk), flèches, ouverture des branches. */
function brancherArbre(w: Widget, d: HTMLElement) {
  const id = w.id;
  d.addEventListener("mousedown", (ev) => {
    if (ev.defaultPrevented || ev.button !== 0) return;
    const tr = (ev.target as HTMLElement).closest("tr[data-iid]") as HTMLElement | null;
    if (!tr) return;
    if (surFleche(ev, tr, w)) {
      appeler(id, "ouvrir", { iid: tr.dataset.iid });
      return;
    }
    appeler(id, "selection", { iid: tr.dataset.iid, ajouter: ev.ctrlKey || ev.metaKey, etendre: ev.shiftKey });
  });
  d.addEventListener("dblclick", (ev) => {
    const tr = (ev.target as HTMLElement).closest("tr[data-iid]") as HTMLElement | null;
    // Comme ttk::treeview::DoubleClick : bascule toute ligne, même sans enfant (chargement paresseux).
    if (tr && !ev.defaultPrevented && !surFleche(ev, tr, w)) appeler(id, "ouvrir", { iid: tr.dataset.iid });
  });
  d.addEventListener("click", (ev) => {
    const th = (ev.target as HTMLElement).closest("th[data-colonne]") as HTMLElement | null;
    if (th) appeler(id, "entete", { colonne: th.dataset.colonne });
  });
  d.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const lignes = [...d.querySelectorAll("tbody tr")] as HTMLElement[];
    if (!lignes.length) return;
    const actuel = lignes.findIndex((l) => l.dataset.iid === d.dataset.focus);
    if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(ev.key)) {
      ev.preventDefault();
      const page = Math.max(1, Math.floor(d.clientHeight / nb(w.opts.hauteurLigne, 22)) - 1);
      const pas = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page } as Record<string, number>;
      const i = ev.key === "Home" ? 0 : ev.key === "End" ? lignes.length - 1 : Math.min(lignes.length - 1, Math.max(0, actuel < 0 ? 0 : actuel + pas[ev.key]));
      appeler(id, "selection", { iid: lignes[i].dataset.iid, etendre: ev.shiftKey });
      lignes[i].scrollIntoView({ block: "nearest" });
    } else if ((ev.key === "ArrowRight" || ev.key === "ArrowLeft") && actuel >= 0) {
      const l = lignes[actuel];
      if (l.dataset.enfants === (ev.key === "ArrowRight" ? "ferme" : "ouvert")) {
        ev.preventDefault();
        appeler(id, "ouvrir", { iid: l.dataset.iid });
      }
    } else if ((ev.key === "Enter" || ev.key === " ") && actuel >= 0) {
      ev.preventDefault(); // ToggleFocus de Tk : Entrée / Espace basculent la ligne qui a le focus
      appeler(id, "ouvrir", { iid: lignes[actuel].dataset.iid });
    }
  });
}

/** Hauteur d'une ligne de Listbox (les options d'une liste n'ont pas de boîte mesurable). */
function hauteurOption(s: HTMLSelectElement): number {
  return s.options.length ? s.scrollHeight / s.options.length : 17;
}

function dessinerOnglets(w: Widget, o: Opts) {
  const tabs = w.el.querySelector(".tk-tabs") as HTMLElement;
  const onglets = (o.liste as Opts[]) ?? [];
  const actif = nb(o.actif, -1);
  tabs.replaceChildren(
    ...onglets.map((t) => {
      const b = el("button");
      b.type = "button";
      b.textContent = texte(t.texte);
      if (nb(t.id) === actif) b.className = "actif";
      b.disabled = t.etat === "disabled";
      b.addEventListener("click", () => appeler(w.id, "onglet", { id: nb(t.id) }));
      return b;
    }),
  );
  // Tk accepte comme page un descendant du parent du Notebook : on la rattache au Notebook.
  for (const t of onglets) {
    const p = widgets.get(nb(t.id));
    if (!p || p.detruit || p.parent === w) continue;
    if (p.parent) {
      p.parent.enfants = p.parent.enfants.filter((x) => x !== p);
      demanderDisposition(p.parent);
    }
    p.el.remove();
    p.parent = w;
    p.pageExterne = true;
    w.enfants.push(p);
  }
  // Toutes les pages restent empilées dans la même cellule (seule l'active est visible) : le Notebook prend
  // la taille de la plus grande page et la fenêtre ne saute plus à chaque changement d'onglet (Tk).
  const pages = new Set(onglets.map((t) => nb(t.id)));
  for (const e of w.enfants) {
    if (e.detruit) continue;
    if (!pages.has(nb(e.id))) {
      e.geo = null;
      e.el.remove();
      continue;
    }
    e.geo = { gestion: "page", opts: {}, ordre: 0 };
    e.el.style.visibility = nb(e.id) === actif ? "" : "hidden";
  }
  demanderDisposition(w);
}

/* ───────────────────────────── Géométrie ───────────────────────────── */

function geometrie(id: number, gestion: Gestion | null, opts: Opts) {
  const w = widgets.get(id);
  if (!w || !w.parent) return;
  if (w.parent.type === "notebook") return; // les pages sont affichées par le Notebook
  const ancienParent = w.parent;
  const avant = w.geo;
  w.geo = gestion ? { gestion, opts, ordre: w.geo?.gestion === gestion && gestion === "pack" && !opts.nouveau ? w.geo.ordre : ++ordrePack } : null;
  if (gestion === "pack" && (opts.avant !== undefined || opts.apres !== undefined)) {
    const ref = widgets.get(nb(opts.avant ?? opts.apres));
    if (ref?.geo) w.geo!.ordre = ref.geo.ordre + (opts.avant !== undefined ? -0.5 : 0.5);
  }
  // Re-placer / re-ranger un widget déjà en place ne doit détacher aucun frère : un nœud retiré du document
  // entre mousedown et mouseup perd son click (Button, Checkbutton, onglet) et son glissé (Scale).
  if (gestion && avant?.gestion === gestion && ancienParent.contenu.contains(w.el)) {
    if (gestion === "place") {
      disposerPlace(ancienParent, w, new Map([[w, w.el.style.zIndex]]));
      return;
    }
    const sans = (o: Opts) => JSON.stringify({ ...o, nouveau: undefined });
    if (!opts.nouveau && sans(avant.opts) === sans(opts)) return; // pack() / grid() identique : rien à re-ranger
  }
  if (!gestion) w.el.remove();
  demanderDisposition(ancienParent);
  if (ancienParent.type === "frame" || ancienParent.type === "labelframe") tailleCadre(ancienParent);
}

function grilleConfig(id: number, axe: string, index: number, o: Opts) {
  const w = widgets.get(id);
  if (!w) return;
  const m = axe === "row" ? w.lignes : w.colonnes;
  m.set(index, { ...(m.get(index) ?? {}), ...o });
  demanderDisposition(w);
}

function disposer(c: Widget) {
  if (c.canvas) return; // un canvas n'affiche que ses fenêtres intégrées (create_window)
  if (!["fenetre", "frame", "labelframe", "notebook"].includes(c.type) && !c.enfants.length) return;
  const vivants = c.enfants.filter((e) => !e.detruit && e.geo && e.dansCanvas === undefined);
  const pack = vivants.filter((e) => e.geo!.gestion === "pack").sort((a, b) => a.geo!.ordre - b.geo!.ordre);
  const grid = vivants.filter((e) => e.geo!.gestion === "grid");
  const place = vivants.filter((e) => e.geo!.gestion === "place");
  const places = new Set<Element>(place.map((p) => p.el));
  for (const n of [...c.contenu.children]) if (!places.has(n) && ((n as HTMLElement).classList.contains("tk-cavite") || (n as HTMLElement).classList.contains("tk-grille") || (n as HTMLElement).dataset.tkid)) n.remove();
  if (c.type === "notebook") {
    for (const k of vivants) {
      libererPlace(k);
      k.el.style.gridArea = "1 / 1";
      k.el.style.position = "relative";
      k.etire = { x: true, y: true };
      appliquerTaille(k);
      c.contenu.appendChild(k.el);
    }
    return;
  }
  // Empilement comme Tk : ordre de création (ou lift / lower), quel que soit le gestionnaire de géométrie.
  const z = new Map([...vivants].sort((a, b) => a.rang - b.rang).map((k, i) => [k, String(i + 1)]));
  if (grid.length) disposerGrille(c, grid.sort((a, b) => a.rang - b.rang), z);
  else if (pack.length) disposerPack(c, pack, z);
  for (const p of place) disposerPlace(c, p, z);
  // Fenêtre principale vide : 200×200, comme Tk.
  if (c.type === "fenetre" && !c.fen.tailleFixe) {
    const vide = !grid.length && !pack.length;
    c.contenu.style.minWidth = vide ? "200px" : "";
    c.contenu.style.minHeight = vide ? "200px" : "";
  }
  if (c.type === "frame" || c.type === "labelframe") tailleCadre(c);
}

function pad(v: unknown): [number, number] {
  return paire(v ?? 0);
}

function interne(k: Widget) {
  const o = k.geo!.opts;
  const [ix] = pad(o.ipadx);
  const [iy] = pad(o.ipady);
  if (ix || iy) {
    k.el.style.paddingLeft = k.el.style.paddingRight = `${ix + 4}px`;
    k.el.style.paddingTop = k.el.style.paddingBottom = `${iy + 2}px`;
  }
}

/** Retire le placement absolu laissé par place() ou create_window quand le widget change de gestionnaire. */
function libererPlace(k: Widget) {
  const s = k.el.style;
  s.position = s.left = s.top = s.transform = "";
}

function disposerPack(c: Widget, kids: Widget[], z: Map<Widget, string>) {
  let cavite = el("div", "tk-cavite");
  c.contenu.appendChild(cavite);
  kids.forEach((k, i) => {
    const o = k.geo!.opts;
    const side = texte(o.side) || "top";
    const vertical = side === "top" || side === "bottom";
    const expand = !!o.expand && o.expand !== "0" && o.expand !== "false";
    const fill = texte(o.fill) || "none";
    cavite.style.flexDirection = vertical ? "column" : "row";
    const parcelle = el("div", "tk-parcelle");
    parcelle.style.zIndex = z.get(k) ?? "";
    k.el.style.zIndex = "";
    libererPlace(k);
    // Comme Tk : la parcelle garde sa taille demandée ; « expand » ne lui donne que l'espace en plus.
    parcelle.style.flex = expand ? "1 1 auto" : "0 0 auto";
    const [pl, pr] = pad(o.padx);
    const [pt, pb] = pad(o.pady);
    parcelle.style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
    const [h, v] = ancreFlex(o.anchor);
    const fx = fill === "x" || fill === "both";
    const fy = fill === "y" || fill === "both";
    parcelle.style.flexDirection = "row";
    parcelle.style.justifyContent = fx ? "flex-start" : h;
    parcelle.style.alignItems = fy ? "stretch" : v;
    k.el.style.flex = fx ? "1 1 auto" : "0 0 auto";
    k.el.style.alignSelf = "";
    k.etire = { x: fx, y: fy };
    appliquerTaille(k);
    interne(k);
    parcelle.appendChild(k.el);
    const reste = el("div", "tk-cavite");
    const expansionsApres = kids.slice(i + 1).some((x) => !!x.geo!.opts.expand);
    reste.style.flex = expand && !expansionsApres ? "0 0 auto" : "1 1 auto";
    if (side === "top" || side === "left") cavite.append(parcelle, reste);
    else cavite.append(reste, parcelle);
    cavite = reste;
  });
}

function disposerGrille(c: Widget, kids: Widget[], z: Map<Widget, string>) {
  const g = el("div", "tk-grille");
  c.contenu.appendChild(g);
  let nbCol = 0;
  let nbLig = 0;
  for (const k of kids) {
    const o = k.geo!.opts;
    nbCol = Math.max(nbCol, nb(o.column) + Math.max(1, nb(o.columnspan, 1)));
    nbLig = Math.max(nbLig, nb(o.row) + Math.max(1, nb(o.rowspan, 1)));
  }
  // Comme Tk : une ligne / colonne configurée (weight ou minsize non nul) existe même sans widget.
  const configurees = (m: Map<number, Opts>) => Math.max(0, ...[...m].filter(([, o]) => nb(o.weight) > 0 || nb(o.minsize) > 0).map(([i]) => i + 1));
  nbCol = Math.max(nbCol, configurees(c.colonnes));
  nbLig = Math.max(nbLig, configurees(c.lignes));
  const piste = (conf: Opts | undefined) => {
    const poids = nb(conf?.weight);
    const min = nb(conf?.minsize);
    if (poids > 0) return `minmax(${min}px, ${poids}fr)`; // comme Tk : une colonne pondérée peut rétrécir
    return min ? `minmax(${min}px, auto)` : "auto";
  };
  const cols = Array.from({ length: nbCol }, (_, i) => piste(c.colonnes.get(i)));
  const ligs = Array.from({ length: nbLig }, (_, i) => piste(c.lignes.get(i)));
  g.style.gridTemplateColumns = cols.join(" ");
  g.style.gridTemplateRows = ligs.join(" ");
  if (cols.some((t) => t.includes("fr"))) g.style.justifyContent = "stretch";
  if (ligs.some((t) => t.includes("fr"))) g.style.alignContent = "stretch";
  for (const k of kids) {
    const o = k.geo!.opts;
    const cell = el("div", "tk-cellule");
    cell.style.zIndex = z.get(k) ?? "";
    k.el.style.zIndex = "";
    libererPlace(k);
    cell.style.gridColumn = `${nb(o.column) + 1} / span ${Math.max(1, nb(o.columnspan, 1))}`;
    cell.style.gridRow = `${nb(o.row) + 1} / span ${Math.max(1, nb(o.rowspan, 1))}`;
    const [pl, pr] = pad(o.padx);
    const [pt, pb] = pad(o.pady);
    cell.style.padding = `${pt}px ${pr}px ${pb}px ${pl}px`;
    const sticky = texte(o.sticky).toLowerCase();
    const ew = sticky.includes("e") && sticky.includes("w");
    const ns = sticky.includes("n") && sticky.includes("s");
    cell.style.justifyContent = ew ? "flex-start" : sticky.includes("w") ? "flex-start" : sticky.includes("e") ? "flex-end" : "center";
    cell.style.alignItems = ns ? "stretch" : sticky.includes("n") ? "flex-start" : sticky.includes("s") ? "flex-end" : "center";
    k.el.style.flex = ew ? "1 1 auto" : "0 0 auto";
    k.etire = { x: ew, y: ns };
    appliquerTaille(k);
    interne(k);
    cell.appendChild(k.el);
    g.appendChild(cell);
  }
}

function disposerPlace(c: Widget, k: Widget, z: Map<Widget, string>) {
  const o = k.geo!.opts;
  const s = k.el.style;
  s.position = "absolute";
  s.zIndex = z.get(k) ?? "";
  const x = nb(o.x);
  const y = nb(o.y);
  const rx = nb(o.relx);
  const ry = nb(o.rely);
  s.left = `calc(${rx * 100}% + ${x}px)`;
  s.top = `calc(${ry * 100}% + ${y}px)`;
  s.width = o.width !== undefined || o.relwidth !== undefined ? `calc(${nb(o.relwidth) * 100}% + ${nb(o.width)}px)` : (k.dimL ?? "max-content");
  s.height = o.height !== undefined || o.relheight !== undefined ? `calc(${nb(o.relheight) * 100}% + ${nb(o.height)}px)` : (k.dimH ?? "");
  const a = normAncre(o.anchor, "nw");
  const tx = a.includes("e") ? "-100%" : a.includes("w") ? "0" : "-50%";
  const ty = a.includes("s") ? "-100%" : a.includes("n") ? "0" : "-50%";
  s.transform = tx === "0" && ty === "0" ? "" : `translate(${tx}, ${ty})`;
  k.etire = { x: false, y: false };
  c.contenu.style.position = "relative";
  if (k.el.parentElement !== c.contenu) c.contenu.appendChild(k.el);
  if (k.type === "frame" || k.type === "labelframe") tailleCadre(k);
}

/* ───────────────────────────── Canvas ───────────────────────────── */

/** scrollregion : une zone invisible donne l'étendue du défilement ; dessins et fenêtres suivent son origine. */
function definirZone(w: Widget, z: unknown) {
  const c = w.canvas!;
  const zone = Array.isArray(z) && z.length === 4 ? (z.map((v) => nb(v)) as [number, number, number, number]) : null;
  c.zone = zone;
  w.el.style.overflow = zone ? "auto" : "";
  if (!c.espace) {
    c.espace = el("div");
    c.espace.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;visibility:hidden";
    w.el.prepend(c.espace);
  }
  c.espace.style.width = zone ? `${Math.max(0, zone[2] - zone[0])}px` : "0";
  c.espace.style.height = zone ? `${Math.max(0, zone[3] - zone[1])}px` : "0";
  c.svg.style.transform = zone && (zone[0] || zone[1]) ? `translate(${-zone[0]}px, ${-zone[1]}px)` : "";
  for (const wid of c.fenetres.values()) {
    const k = widgets.get(wid);
    if (k?.el.dataset.x !== undefined) {
      k.el.style.left = `${nb(k.el.dataset.x) - (zone?.[0] ?? 0)}px`;
      k.el.style.top = `${nb(k.el.dataset.y) - (zone?.[1] ?? 0)}px`;
    }
  }
}

function svgEl(tag: string): SVGElement {
  return document.createElementNS(SVG, tag) as SVGElement;
}

/** Chemin SVG d'une ligne ou d'un polygone ; « smooth » : spline quadratique de Tk (passe par les milieux). */
function chemin(c: number[], ferme: boolean, lisse: boolean): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < c.length; i += 2) p.push([c[i], c[i + 1]]);
  if (!p.length) return "";
  const milieu = (a: [number, number], b: [number, number]) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`;
  if (!lisse || p.length < 3) return `M ${p.map((q) => `${q[0]} ${q[1]}`).join(" L ")}${ferme ? " Z" : ""}`;
  if (ferme) {
    let d = `M ${milieu(p[0], p[1])}`;
    for (let i = 1; i <= p.length; i++) {
      const q = p[i % p.length];
      d += ` Q ${q[0]} ${q[1]} ${milieu(q, p[(i + 1) % p.length])}`;
    }
    return `${d} Z`;
  }
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i <= p.length - 2; i++) {
    const fin = i === p.length - 2 ? `${p[i + 1][0]} ${p[i + 1][1]}` : milieu(p[i], p[i + 1]);
    d += ` Q ${p[i][0]} ${p[i][1]} ${fin}`;
  }
  return d;
}

let mesureur: CanvasRenderingContext2D | null | undefined;

/** Largeur d'un texte et hauteurs de la police (mise en page des textes du canvas). */
function mesurer(police: string, t: string): { l: number; asc: number; desc: number } {
  if (mesureur === undefined) mesureur = document.createElement("canvas").getContext("2d");
  if (!mesureur) return { l: t.length * 7, asc: 12, desc: 4 };
  mesureur.font = police;
  const m = mesureur.measureText(t || " ");
  return { l: t ? m.width : 0, asc: m.fontBoundingBoxAscent || 12, desc: m.fontBoundingBoxDescent || 4 };
}

/** Lignes d'un texte de canvas ; « width » > 0 : retour à la ligne aux mots (au caractère pour un mot trop long). */
function couperLignes(police: string, brut: string, largeur: number): string[] {
  const sortie: string[] = [];
  for (const ligne of brut.split("\n")) {
    if (largeur <= 0) {
      sortie.push(ligne);
      continue;
    }
    let actuelle = "";
    for (const mot of ligne.split(/(?<=\s)/)) {
      if (actuelle && mesurer(police, (actuelle + mot).trimEnd()).l > largeur) {
        sortie.push(actuelle.trimEnd());
        actuelle = mot;
      } else actuelle += mot;
      while (actuelle.length > 1 && mesurer(police, actuelle.trimEnd()).l > largeur) {
        let k = actuelle.length - 1;
        while (k > 1 && mesurer(police, actuelle.slice(0, k)).l > largeur) k--;
        sortie.push(actuelle.slice(0, k));
        actuelle = actuelle.slice(k);
      }
    }
    sortie.push(actuelle);
  }
  return sortie;
}

function styleItem(e: SVGElement, kind: string, o: Opts) {
  const set = (k: string, v: unknown) => (v === undefined || v === null || v === "" ? e.removeAttribute(k) : e.setAttribute(k, texte(v)));
  const remplissage = o.fill;
  const contour = o.outline;
  if (kind === "line") {
    set("fill", "none");
    set("stroke", remplissage ?? "black");
    set("stroke-width", o.width ?? 1);
    set("stroke-linecap", o.capstyle === "round" ? "round" : o.capstyle === "projecting" ? "square" : "butt");
    set("stroke-linejoin", o.joinstyle === "bevel" ? "bevel" : o.joinstyle === "miter" ? "miter" : "round");
  } else if (kind === "text") {
    set("fill", remplissage ?? "black");
    if (o.font) (e as SVGElement & { style: CSSStyleDeclaration }).style.font = texte(o.font);
  } else if (kind !== "image" && kind !== "window") {
    set("fill", remplissage === undefined ? (kind === "polygon" ? "black" : "none") : remplissage || "none");
    set("stroke", contour === undefined ? (kind === "polygon" ? "none" : "black") : contour || "none");
    set("stroke-width", o.width ?? 1);
  }
  if (kind === "polygon") set("fill-rule", "evenodd"); // comme X11 : les zones recouvertes deux fois sont vides
  if (o.dash) set("stroke-dasharray", Array.isArray(o.dash) ? (o.dash as number[]).join(" ") : o.dash);
  e.style.display = o.state === "hidden" ? "none" : "";
  // Survol : activefill / activeoutline appliqués par la règle CSS :hover.
  const actif = kind === "line" || (kind === "arc" && o.style === "arc") ? null : o.activefill;
  if (actif) e.style.setProperty("--actif", texte(actif));
  e.toggleAttribute("data-actif", !!actif);
  if (o.activeoutline) e.style.setProperty("--actif-contour", texte(o.activeoutline));
  e.toggleAttribute("data-actif-contour", !!o.activeoutline);
}

function dessinerItem(c: CanvasEtat, w: Widget, item: number, kind: string, coords: number[], o: Opts) {
  let e = c.items.get(item);
  const nouveau = !e;
  if (!e) {
    const tag = { line: "g", rectangle: "rect", oval: "ellipse", polygon: "path", text: "text", arc: "path", image: "image", window: "g" }[kind] ?? "g";
    e = kind === "line" ? svgEl("g") : svgEl(tag);
    e.dataset.item = String(item);
    c.items.set(item, e);
  }
  if (kind === "line") {
    e.replaceChildren();
    const ligne = svgEl("path");
    ligne.setAttribute("d", chemin(coords, false, !!o.smooth));
    styleItem(ligne, "line", o);
    e.appendChild(ligne);
    if (o.activefill) e.style.setProperty("--actif", texte(o.activefill));
    e.toggleAttribute("data-actif-ligne", !!o.activefill);
    const fleche = texte(o.arrow);
    const coul = texte(o.fill ?? "black") || "black";
    const ep = nb(o.width, 1);
    const pointe = (x1: number, y1: number, x2: number, y2: number) => {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const l = 8 + ep * 2;
      const lg = 3 + ep * 1.5;
      const p = svgEl("polygon");
      p.setAttribute("points", `${x2},${y2} ${x2 - l * Math.cos(a) + lg * Math.sin(a)},${y2 - l * Math.sin(a) - lg * Math.cos(a)} ${x2 - l * Math.cos(a) - lg * Math.sin(a)},${y2 - l * Math.sin(a) + lg * Math.cos(a)}`);
      p.setAttribute("fill", coul);
      e!.appendChild(p);
    };
    const n = coords.length;
    if (n >= 4 && (fleche === "last" || fleche === "both")) pointe(coords[n - 4], coords[n - 3], coords[n - 2], coords[n - 1]);
    if (n >= 4 && (fleche === "first" || fleche === "both")) pointe(coords[2], coords[3], coords[0], coords[1]);
    e.style.display = o.state === "hidden" ? "none" : "";
  } else if (kind === "rectangle") {
    const [x1, y1, x2, y2] = coords;
    e.setAttribute("x", String(Math.min(x1, x2)));
    e.setAttribute("y", String(Math.min(y1, y2)));
    e.setAttribute("width", String(Math.abs(x2 - x1)));
    e.setAttribute("height", String(Math.abs(y2 - y1)));
    styleItem(e, kind, o);
  } else if (kind === "oval") {
    const [x1, y1, x2, y2] = coords;
    e.setAttribute("cx", String((x1 + x2) / 2));
    e.setAttribute("cy", String((y1 + y2) / 2));
    e.setAttribute("rx", String(Math.abs(x2 - x1) / 2));
    e.setAttribute("ry", String(Math.abs(y2 - y1) / 2));
    styleItem(e, kind, o);
  } else if (kind === "polygon") {
    e.setAttribute("d", chemin(coords, true, !!o.smooth));
    styleItem(e, kind, o);
  } else if (kind === "arc") {
    const [x1, y1, x2, y2] = coords;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    const debut = (nb(o.start) * Math.PI) / 180;
    const etendue = nb(o.extent, 90);
    const fin = debut + (etendue * Math.PI) / 180;
    const px = (a: number) => cx + rx * Math.cos(a);
    const py = (a: number) => cy - ry * Math.sin(a);
    const grand = Math.abs(etendue) > 180 ? 1 : 0;
    const sens = etendue > 0 ? 0 : 1;
    const style = texte(o.style) || "pieslice";
    let d = `M ${px(debut)} ${py(debut)} A ${rx} ${ry} 0 ${grand} ${sens} ${px(fin)} ${py(fin)}`;
    if (Math.abs(etendue) >= 359.99) {
      // Arc complet : un arc SVG d'un point à lui-même ne dessine rien, on trace deux demi-ellipses.
      d = `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} Z`;
    } else if (style === "pieslice") d = `M ${cx} ${cy} L ${px(debut)} ${py(debut)} A ${rx} ${ry} 0 ${grand} ${sens} ${px(fin)} ${py(fin)} Z`;
    else if (style === "chord") d += " Z";
    e.setAttribute("d", d);
    styleItem(e, style === "arc" ? "line" : kind, style === "arc" ? { ...o, fill: o.outline ?? "black" } : o);
  } else if (kind === "text") {
    // Mise en page mesurée : ancre du bloc, justification des lignes, retour à la ligne (width), angle.
    const [x, y] = coords;
    const police = texte(o.font) || '13px "Segoe UI",system-ui,sans-serif';
    const a = normAncre(o.anchor);
    const lignes = couperLignes(police, texte(o.text), nb(o.width));
    const mesures = lignes.map((l) => mesurer(police, l));
    const asc = mesures[0]?.asc ?? 12;
    const hl = asc + (mesures[0]?.desc ?? 4);
    const largeur = Math.max(0, ...mesures.map((m) => m.l));
    const gauche = a.includes("w") ? x : a.includes("e") ? x - largeur : x - largeur / 2;
    const haut = a.includes("n") ? y : a.includes("s") ? y - hl * lignes.length : y - (hl * lignes.length) / 2;
    const j = texte(o.justify) || "left";
    e.removeAttribute("text-anchor");
    e.removeAttribute("dominant-baseline");
    e.replaceChildren(
      ...lignes.map((l, i) => {
        const t = svgEl("tspan");
        const dx = j === "center" ? (largeur - mesures[i].l) / 2 : j === "right" ? largeur - mesures[i].l : 0;
        t.setAttribute("x", String(gauche + dx));
        t.setAttribute("y", String(haut + i * hl + asc));
        t.textContent = l;
        return t;
      }),
    );
    e.style.font = police;
    e.style.whiteSpace = "pre";
    const angle = nb(o.angle);
    if (angle) e.setAttribute("transform", `rotate(${-angle} ${x} ${y})`);
    else e.removeAttribute("transform");
    styleItem(e, kind, o);
    e.style.userSelect = "none";
  } else if (kind === "image") {
    const [x, y] = coords;
    const im = (o.image ?? {}) as Opts;
    const l = nb(im.largeur);
    const h = nb(im.hauteur);
    const a = normAncre(o.anchor);
    e.setAttribute("href", texte(im.src));
    e.setAttribute("width", String(l));
    e.setAttribute("height", String(h));
    e.setAttribute("preserveAspectRatio", "none"); // zoom(40, 20) étiré comme Tk, pas centré en carré
    e.setAttribute("x", String(a.includes("w") ? x : a.includes("e") ? x - l : x - l / 2));
    e.setAttribute("y", String(a.includes("n") ? y : a.includes("s") ? y - h : y - h / 2));
    e.style.display = o.state === "hidden" ? "none" : "";
  } else if (kind === "window") {
    const cible = widgets.get(nb(o.widget));
    const ancien = c.fenetres.get(item);
    if (ancien !== undefined && ancien !== cible?.id) libererFenetreCanvas(c, item);
    if (cible) {
      const cache = o.state === "hidden";
      cible.el.style.visibility = cache ? "hidden" : "";
      cible.el.inert = cache; // ni clic ni focus clavier dans le widget caché
      c.fenetres.set(item, cible.id);
      cible.dansCanvas = w.id;
      const [x, y] = coords;
      const a = normAncre(o.anchor);
      const s = cible.el.style;
      s.position = "absolute";
      cible.el.dataset.x = String(x);
      cible.el.dataset.y = String(y);
      s.left = `${x - (c.zone?.[0] ?? 0)}px`;
      s.top = `${y - (c.zone?.[1] ?? 0)}px`;
      s.transform = `translate(${a.includes("w") ? "0" : a.includes("e") ? "-100%" : "-50%"}, ${a.includes("n") ? "0" : a.includes("s") ? "-100%" : "-50%"})`;
      // width / height de l'élément imposent la taille (0 = taille demandée), même quand le cadre propage.
      const l = o.width !== undefined ? nb(o.width) : 0;
      const h = o.height !== undefined ? nb(o.height) : 0;
      cible.tailleCanvas = { l, h };
      cible.etire = { x: false, y: false };
      if (l > 0) s.width = `${l}px`;
      if (h > 0) s.height = `${h}px`;
      if (cible.type === "frame" || cible.type === "labelframe") tailleCadre(cible);
      else appliquerTaille(cible);
      if (cible.el.parentElement !== w.el) w.el.appendChild(cible.el);
    }
  }
  if (nouveau) c.svg.appendChild(e);
}

/** Élément « window » retiré (delete, ou window= remplacé) : le widget quitte le canvas, visible à nouveau. */
function libererFenetreCanvas(c: CanvasEtat, item: number) {
  const cw = widgets.get(c.fenetres.get(item) ?? -1);
  if (cw) {
    cw.tailleCanvas = undefined;
    cw.dansCanvas = undefined;
    cw.el.style.visibility = "";
    cw.el.inert = false;
    cw.el.remove();
  }
  c.fenetres.delete(item);
}

function operationCanvas(w: Widget, op: unknown[]) {
  const c = w.canvas!;
  const [nom, item] = op as [string, number];
  if (nom === "creer" || nom === "maj") dessinerItem(c, w, item, op[2] as string, (op[3] as number[]) ?? [], (op[4] as Opts) ?? {});
  else if (nom === "suppr") {
    c.items.get(item)?.remove();
    c.items.delete(item);
    libererFenetreCanvas(c, item);
  } else if (nom === "haut") {
    const e = c.items.get(item);
    if (e) c.svg.appendChild(e);
  } else if (nom === "bas") {
    const e = c.items.get(item);
    if (e) c.svg.insertBefore(e, c.svg.firstChild);
  } else if (nom === "avant") {
    const e = c.items.get(item);
    const ref = c.items.get(op[2] as number);
    if (e && ref) c.svg.insertBefore(e, ref);
  } else if (nom === "apres") {
    const e = c.items.get(item);
    const ref = c.items.get(op[2] as number);
    if (e && ref) ref.after(e);
  } else if (nom === "vider") {
    c.svg.replaceChildren();
    c.items.clear();
  } else if (nom === "fond") {
    w.el.style.background = texte(op[2]);
  }
}

/** Numéro du tour du navigateur (change dès que le JavaScript en cours, programme Python compris, a rendu la main). */
let tourNavigateur = 0;
let finDeTourPrevue = false;
function tourActuel(): number {
  if (!finDeTourPrevue) {
    finDeTourPrevue = true;
    queueMicrotask(() => {
      tourNavigateur++;
      finDeTourPrevue = false;
    });
  }
  return tourNavigateur;
}

function dessin(id: number, ops: unknown[][]) {
  const w = widgets.get(id);
  if (!w?.canvas) return;
  const c = w.canvas;
  if (!c.anime && !c.file.length) {
    for (const op of ops) operationCanvas(w, op);
    return;
  }
  // Opérations d'un tour plus récent (rappel ontimer/onkey d'un jeu) alors que la file n'est pas vide : ce qui
  // attend est dessiné d'un coup à l'image suivante, sinon le retard d'affichage croîtrait sans limite. Un dessin
  // envoyé en une fois par le programme reste animé à la vitesse demandée.
  const tour = tourActuel();
  if (c.file.length && c.tourFile !== tour) c.limite = c.file.length;
  c.tourFile = tour;
  c.file.push(...ops);
  if (c.enCours) return;
  c.enCours = true;
  const pas = () => {
    if (w.detruit) return;
    const n = Math.max(1, c.anime || c.file.length, c.limite ?? 0);
    c.limite = 0;
    for (const op of c.file.splice(0, n)) operationCanvas(w, op);
    if (c.file.length) requestAnimationFrame(pas);
    else c.enCours = false;
  };
  requestAnimationFrame(pas);
}

/* ───────────────────────────── Événements ───────────────────────────── */

function cibleDe(t: EventTarget | null): number | null {
  const e = (t as HTMLElement | null)?.closest?.("[data-tkid]") as HTMLElement | null;
  return e ? Number(e.dataset.tkid) : null;
}

const SYMBOLES: Record<string, string> = {
  Enter: "Return", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", " ": "space", Escape: "Escape",
  Backspace: "BackSpace", Tab: "Tab", Delete: "Delete", Shift: "Shift_L", Control: "Control_L", Alt: "Alt_L", Meta: "Meta_L",
  Home: "Home", End: "End", PageUp: "Prior", PageDown: "Next", Insert: "Insert", CapsLock: "Caps_Lock",
  "+": "plus", "-": "minus", "*": "asterisk", "/": "slash", ".": "period", ",": "comma", "=": "equal", "(": "parenleft",
  ")": "parenright", "%": "percent", "!": "exclam", "?": "question", ":": "colon", ";": "semicolon", "'": "apostrophe",
  '"': "quotedbl", "#": "numbersign", "$": "dollar", "&": "ampersand", "@": "at", "_": "underscore", "<": "less", ">": "greater",
  "[": "bracketleft", "]": "bracketright", "{": "braceleft", "}": "braceright", "^": "asciicircum", "~": "asciitilde", "|": "bar", "\\": "backslash",
};

function donneesSouris(e: MouseEvent, cible: number): Opts {
  const w = widgets.get(cible);
  const r = (w?.type === "fenetre" ? w.contenu : w?.el)?.getBoundingClientRect();
  const item = (e.target as Element | null)?.closest?.("[data-item]") as HTMLElement | null;
  const autreItem = (e.relatedTarget as Element | null)?.closest?.("[data-item]") as HTMLElement | null;
  const ligne = (e.target as Element | null)?.closest?.("tr[data-iid]") as HTMLElement | null;
  return {
    x: Math.round(e.clientX - (r?.left ?? 0)), y: Math.round(e.clientY - (r?.top ?? 0)), xRacine: e.clientX, yRacine: e.clientY,
    bouton: e.button + 1, boutons: e.buttons, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey,
    clics: e.type === "mousedown" || e.type === "mouseup" ? e.detail || 1 : 1, // double / triple clic (comme Tk)
    item: item ? Number(item.dataset.item) : undefined,
    autreItem: autreItem ? Number(autreItem.dataset.item) : undefined,
    ligne: ligne?.dataset.iid,
    // Text : caractère sous la souris (marque « current », tag_bind).
    decalage: w?.type === "text" ? decalageAuPoint(w.el, e.clientX, e.clientY) : undefined,
  };
}

/** Raccourcis d'édition laissés au navigateur dans un champ (Tk les gère aussi dans ses classes Entry / Text). */
function raccourciEdition(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return (e.ctrlKey || e.metaKey) && !e.altKey && /^[acvxzy]$/i.test(e.key) && !!t.closest?.("input,textarea,[contenteditable=plaintext-only]");
}

/** Frappe bloquée pendant qu'une liaison attendait : rejouée dans le champ si la liaison n'a pas répondu « break ». */
function rejouerTouche(e: KeyboardEvent, final: unknown) {
  if (final === "break" || e.type !== "keydown" || e.ctrlKey || e.metaKey || e.altKey || raccourciEdition(e)) return;
  const champ = (e.target as HTMLElement | null)?.closest?.("input,textarea,[contenteditable=plaintext-only],[contenteditable=true]") as HTMLElement | null;
  if (!champ || !champ.isConnected || (champ as HTMLInputElement).disabled || (champ as HTMLInputElement).readOnly) return;
  const texte = champ.isContentEditable || champ instanceof HTMLTextAreaElement;
  champ.focus({ preventScroll: true });
  if (e.key.length === 1) document.execCommand("insertText", false, e.key);
  else if (e.key === "Enter" && texte) document.execCommand("insertText", false, "\n");
  else if (e.key === "Tab" && texte) document.execCommand("insertText", false, "\t");
  else if (e.key === "Backspace") document.execCommand("delete");
  else if (e.key === "Delete") document.execCommand("forwardDelete");
}

const ecouteurs = new WeakMap<HTMLElement, Map<string, (e: Event) => void>>();

/** Branche sur la fenêtre les types d'événements DOM dont le Python a besoin (ses liaisons « bind »). */
function ecouter(fenId: number, types: string[]) {
  const f = fenetres.get(fenId);
  if (!f) return;
  const voulus = new Set(types);
  let m = ecouteurs.get(f.cadre);
  if (!m) ecouteurs.set(f.cadre, (m = new Map()));
  for (const [t, h] of m) {
    if (!voulus.has(t)) {
      f.cadre.removeEventListener(t, h, true);
      m.delete(t);
    }
  }
  for (const t of voulus) {
    if (m.has(t)) continue;
    const h = (e: Event) => {
      if (enDisposition && (t === "focusin" || t === "focusout")) return; // re-rangement, pas un vrai changement de focus
      let cible = cibleDe(e.target) ?? fenId;
      if (saisie && saisie.fen === f && (t === "mouseup" || (t === "mousemove" && (e as MouseEvent).buttons))) cible = saisie.cible;
      let d: Opts;
      if (e instanceof KeyboardEvent) {
        if (e.isComposing) return;
        d = { touche: SYMBOLES[e.key] ?? e.key, car: e.key.length === 1 ? e.key : e.key === "Enter" ? "\r" : e.key === "Backspace" ? "\b" : e.key === "Tab" ? "\t" : e.key === "Escape" ? "\x1b" : "", code: e.keyCode, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
      } else if (e instanceof WheelEvent) {
        // Comme Tk sous Windows : ±120 par cran (au moins), quel que soit le pas du navigateur.
        const brut = e.deltaMode === 1 ? e.deltaY * 120 : e.deltaY * 1.2;
        d = { ...donneesSouris(e, cible), delta: -Math.sign(e.deltaY) * Math.max(120, Math.round(Math.abs(brut))) };
      } else if (e instanceof MouseEvent) {
        d = donneesSouris(e, cible);
        if (t === "mouseover" || t === "mouseout") d.autre = cibleDe(e.relatedTarget) ?? 0;
      } else d = {};
      const focusAvant = document.activeElement;
      const r = appeler(cible, t, d, e instanceof KeyboardEvent ? (final) => rejouerTouche(e, final) : undefined);
      if (e instanceof KeyboardEvent && t === "keydown" && document.activeElement !== focusAvant && (e.key === "Enter" || e.key === "Tab" || e.key.length === 1)) {
        // La liaison a déplacé le focus (focus_set) : Tk n'applique pas la touche au nouveau widget ; un caractère
        // va au champ d'origine (liaison de classe), sauf « break ».
        e.preventDefault();
        const c = focusAvant;
        if (r !== "break" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement) && c.isConnected && !c.disabled && !c.readOnly) {
          const a = c.selectionStart ?? c.value.length;
          c.setRangeText(e.key, a, c.selectionEnd ?? a, "end");
          c.dispatchEvent(new Event("input", { bubbles: true }));
        }
      } else if (r === EN_ATTENTE && e instanceof KeyboardEvent) {
        // La liaison attend (update(), sleep, wait_window) : son « break » viendra trop tard. On bloque la touche
        // tout de suite (raccourci du navigateur, caractère) et on rejoue la frappe si la réponse n'est pas « break ».
        if (!raccourciEdition(e)) e.preventDefault();
      } else if (r === "break" || r === "prevent") e.preventDefault();
      else if (r === "traite" && e instanceof KeyboardEvent && (e.ctrlKey || e.altKey || e.metaKey || /^F\d{1,2}$/.test(e.key)) && !raccourciEdition(e)) {
        // Raccourci géré par le programme (Ctrl+S, F5…) : le navigateur ne doit pas l'exécuter aussi.
        e.preventDefault();
      }
      if (t === "contextmenu") e.preventDefault();
    };
    m.set(t, h);
    f.cadre.addEventListener(t, h, true);
  }
}

function observerTaille(id: number, actif: boolean) {
  const w = widgets.get(id);
  if (!w) return;
  if (!actif) {
    w.resize?.disconnect();
    w.resize = undefined;
    return;
  }
  if (w.resize) return;
  let derniere = "";
  w.resize = new ResizeObserver(() => {
    const cible = w.type === "fenetre" ? w.contenu : w.el;
    const t = `${cible.clientWidth}x${cible.clientHeight}`;
    if (t === derniere) return;
    derniere = t;
    appeler(id, "configure", { largeur: cible.clientWidth, hauteur: cible.clientHeight });
  });
  w.resize.observe(w.type === "fenetre" ? w.contenu : w.el);
}

/* ───────────────────────────── Lecture / écriture ───────────────────────────── */

function lire(id: number, quoi: string, arg?: unknown): unknown {
  if (planifie) disposerTout();
  if (quoi === "selectionGlobale") {
    // selection_get() : texte sélectionné dans un champ ou un Text des fenêtres.
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.closest(".tk-fen") && a.selectionStart !== a.selectionEnd) return a.value.slice(a.selectionStart ?? 0, a.selectionEnd ?? 0);
    const sel = window.getSelection();
    return sel && !sel.isCollapsed && sel.anchorNode && (sel.anchorNode.parentElement?.closest(".tk-fen") ?? null) ? sel.toString() : null;
  }
  const w = widgets.get(id);
  if (!w) return null;
  const e = w.type === "fenetre" ? w.contenu : w.el;
  const rel = (r: DOMRect) => {
    const b = w.el.getBoundingClientRect();
    return [Math.round(r.left - b.left), Math.round(r.top - b.top), Math.round(r.width), Math.round(r.height)];
  };
  switch (quoi) {
    case "valeur":
      if (w.type === "text") return lireTexte(w.el);
      if (w.type === "select") return (w.el as HTMLSelectElement).value;
      if (w.type === "scale") return (w.el.querySelector("input") as HTMLInputElement).value;
      return champDe(w)?.value ?? "";
    case "selection":
      return w.type === "listbox" ? [...(w.el as HTMLSelectElement).selectedOptions].map((o) => o.index) : [];
    case "curseur":
      return champDe(w)?.selectionStart ?? 0;
    case "selectionTexte": {
      const c = champDe(w);
      return c && c.selectionStart !== null ? [c.selectionStart, c.selectionEnd ?? c.selectionStart] : null;
    }
    case "selTexte":
      return w.type === "text" ? lireSelectionTexte(w) : null;
    case "decalageA": {
      const [x, y] = paire(arg);
      const b = w.el.getBoundingClientRect();
      return decalageAuPoint(w.el, b.left + x, b.top + y) ?? null;
    }
    case "vue": {
      const h = e.scrollHeight || 1;
      return [e.scrollTop / h, Math.min(1, (e.scrollTop + e.clientHeight) / h)];
    }
    case "vueX": {
      const l = e.scrollWidth || 1;
      return [e.scrollLeft / l, Math.min(1, (e.scrollLeft + e.clientWidth) / l)];
    }
    case "decalage":
      return [e.scrollLeft, e.scrollTop];
    case "boite": {
      // Boîte réelle d'un élément de canvas (textes : mesurés par le navigateur).
      const it = w.canvas?.items.get(nb(arg)) as SVGGraphicsElement | undefined;
      if (!it?.getBBox) return null;
      try {
        const b = it.getBBox();
        return b.width || b.height ? [b.x, b.y, b.x + b.width, b.y + b.height] : null;
      } catch {
        return null;
      }
    }
    case "ligneA": {
      const y = w.el.getBoundingClientRect().top + nb(arg);
      for (const tr of w.el.querySelectorAll("tbody tr")) {
        const b = tr.getBoundingClientRect();
        if (y >= b.top && y < b.bottom) return (tr as HTMLElement).dataset.iid ?? "";
      }
      return "";
    }
    case "colonneA": {
      // Index (dans les colonnes affichées, #0 compris) de la colonne sous l'abscisse.
      const x = w.el.getBoundingClientRect().left + nb(arg);
      const rangee = (w.el.querySelector("thead tr") ?? w.el.querySelector("tbody tr")) as HTMLTableRowElement | null;
      if (!rangee) return -1;
      for (const c of rangee.cells) {
        const b = c.getBoundingClientRect();
        if (b.width && x >= b.left && x < b.right) return c.cellIndex;
      }
      return -1;
    }
    case "regionA": {
      const [x, y] = paire(arg);
      const b = w.el.getBoundingClientRect();
      const tete = w.el.querySelector("thead") as HTMLElement | null;
      if (tete && tete.offsetHeight && y < tete.getBoundingClientRect().bottom - b.top) return "heading";
      const cible = document.elementFromPoint(b.left + x, b.top + y) as HTMLElement | null;
      const tr = cible?.closest("tr[data-iid]") as HTMLElement | null;
      if (!tr || !w.el.contains(tr)) return "nothing";
      const td = cible?.closest("td") as HTMLTableCellElement | null;
      return td && td.cellIndex === 0 && w.opts.modeArbre ? "tree" : "cell";
    }
    case "boiteLigne": {
      const [iid, col] = Array.isArray(arg) ? arg : [arg, undefined];
      const tr = w.lignesArbre?.get(texte(iid));
      if (!tr || !w.el.contains(tr)) return null;
      const r = tr.getBoundingClientRect();
      const z = w.el.getBoundingClientRect();
      if (!r.height || r.bottom <= z.top || r.top >= z.bottom) return null; // hors de la zone visible
      const c = col === undefined || col === null ? null : tr.cells[nb(col)];
      return rel(c ? c.getBoundingClientRect() : r);
    }
    case "boiteCar": {
      // Text.bbox / dlineinfo : boîte du caractère, relative au widget (null s'il n'est pas visible).
      if (w.type !== "text") return null;
      const p = nb(arg);
      const r = document.createRange();
      try {
        r.setStart(...pointDans(w.el, p));
        r.setEnd(...pointDans(w.el, p + 1));
      } catch {
        return null;
      }
      const b = r.getBoundingClientRect();
      const z = w.el.getBoundingClientRect();
      return !b.height || b.bottom < z.top || b.top > z.bottom ? null : rel(b);
    }
    case "proche": {
      const s = w.el as HTMLSelectElement;
      if (!s.options.length) return -1;
      const i = Math.floor((nb(arg) - 1 + s.scrollTop) / hauteurOption(s));
      return Math.max(0, Math.min(s.options.length - 1, i));
    }
    case "boiteElement": {
      const s = w.el as HTMLSelectElement;
      const i = nb(arg);
      if (i < 0 || i >= s.options.length) return null;
      const h = hauteurOption(s);
      return [1, Math.round(1 + i * h - s.scrollTop), s.clientWidth, Math.round(h)];
    }
    case "taille": {
      const r = e.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)];
    }
    case "position": {
      const r = w.fen.cadre.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top)];
    }
    case "focus":
      return cibleDe(document.activeElement) ?? 0;
  }
  return null;
}

const CHAMP_INTERNE = new Set(["entry", "spinbox", "combobox", "select", "text", "listbox", "treeview"]);

function ecrire(id: number, quoi: string, valeur: unknown) {
  const w = widgets.get(id);
  if (!w) return;
  if (quoi === "focus") {
    if (planifie) disposerTout(); // le widget doit être dans la page pour recevoir le focus
    // Le focus va au widget lui-même (Tk) : on ne cherche un champ intérieur que pour les widgets composites
    // dont il fait partie. Racine, Frame, Canvas… : le cadre de la fenêtre (le Python route les touches).
    const champ = (w.el.matches("input,select,textarea,[contenteditable],.tk-tableau")
      ? w.el
      : CHAMP_INTERNE.has(w.type)
        ? w.el.querySelector("input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea,[contenteditable]")
        : null) as HTMLElement | null;
    const cible = champ ?? w.fen.cadre;
    w.fen.focusDemande = cible; // honoré aussi à la première image (fenêtre encore en construction)
    const memo = w.type === "text" && w.selTexte ? [...w.selTexte] : null;
    cible.focus({ preventScroll: true });
    if (memo && cible === w.el) placerSelectionTexte(w, memo[0], memo[1], true); // focus ne déplace pas « insert »
    if (valeur === "tout" && champ instanceof HTMLInputElement) champ.select();
  } else if (quoi === "premierPlan") premierPlan(w.fen);
  else if (quoi === "pile") {
    // lift / lower d'un widget parmi ses frères (tkraise d'une page empilée dans la même cellule).
    const [sens, refId] = Array.isArray(valeur) ? valeur : [valeur, null];
    const ref = refId !== null && refId !== undefined ? widgets.get(nb(refId)) : undefined;
    w.rang = ref ? ref.rang + (sens === "haut" ? 0.5 : -0.5) : sens === "haut" ? ++rangMax : --rangMin;
    if (w.parent) demanderDisposition(w.parent);
  }
  else if (quoi === "curseur" || quoi === "selectionTexte") {
    const c = champDe(w);
    const [a, b] = quoi === "curseur" ? [nb(valeur), nb(valeur)] : paire(valeur);
    try {
      c?.setSelectionRange(Math.min(a, b), Math.max(a, b));
    } catch {
      /* type de champ sans sélection */
    }
  } else if (quoi === "selTexte" && w.type === "text") {
    const [a, b] = paire(valeur);
    placerSelectionTexte(w, a, b);
  } else if (quoi === "action") actionEdition(w, valeur);
  else if (quoi === "voir" && w.type === "text") voirDecalage(w.el, nb(valeur));
  else if (quoi === "defiler") w.el.scrollTop = Math.max(0, Math.min(1, nb(valeur))) * w.el.scrollHeight;
  else if (quoi === "defilerX") w.el.scrollLeft = Math.max(0, Math.min(1, nb(valeur))) * w.el.scrollWidth;
}

function detruire(id: number) {
  const w = widgets.get(id);
  if (!w) return;
  const recursif = (x: Widget) => {
    x.detruit = true;
    x.resize?.disconnect();
    widgets.delete(x.id);
    for (const e of x.enfants) if (!e.pageExterne) recursif(e);
  };
  recursif(w);
  if (w.type === "fenetre") {
    w.fen.cadre.remove();
    fenetres.delete(w.id);
    fermerDeroulant();
    signalerNombre();
    return;
  }
  w.el.remove();
  if (w.parent) {
    w.parent.enfants = w.parent.enfants.filter((e) => e !== w);
    demanderDisposition(w.parent);
  }
}

/* ───────────────────────────── API exposée au Python ───────────────────────────── */

/** Compte les appels Python → JS en cours (voir dansPython) : chaque fonction exposée au Python est enveloppée. */
function garder<T extends Record<string, unknown>>(o: T, sauf: string[]): T {
  for (const [k, f] of Object.entries(o)) {
    if (typeof f !== "function" || sauf.includes(k)) continue;
    (o as Record<string, unknown>)[k] = (...a: unknown[]) => {
      dansPython++;
      try {
        return (f as (...x: unknown[]) => unknown)(...a);
      } finally {
        dansPython--;
      }
    };
  }
  return o;
}

export const moteurFenetres = garder({
  definirRappel(f: Rappel, jspi?: boolean, sonde?: ProxyPy) {
    rappel = f;
    // Nouveau tkinter (Pyodide rechargé après une panne) : les rappels endormis de l'ancien ne se réveilleront pas.
    rappelsEndormis = 0;
    fileTk.length = 0;
    suspensible = !!jspi && typeof f.callPromising === "function";
    sondePython = sonde ?? null;
  },
  /** after_cancel / destruction : la minuterie peut déjà attendre dans la file (rappel endormi). */
  annulerMinuterie(id: number) {
    window.clearTimeout(id);
    const i = fileTk.findIndex((f) => (f as { minuterie?: number }).minuterie === id);
    if (i >= 0) fileTk.splice(i, 1);
  },
  /** Un rappel Python entre (+1) ou sort (-1) d'un time.sleep() : voir rappelsEndormis. */
  occupe(delta: number) {
    rappelsEndormis = Math.max(0, rappelsEndormis + delta);
    if (rappelsEndormis === 0 && fileTk.length && !vidageProgramme) {
      vidageProgramme = true;
      window.setTimeout(viderFileTk, 0);
    }
  },
  /** Résultat d'un rappel Python (lu juste après un appel promettant). */
  retour(v: unknown) {
    retourSync = v;
  },
  /** Minuterie (after) : la fonction Python est appelée en mode promettant si possible, puis libérée. */
  differer(fn: ProxyPy, ms: number): number {
    const tirer = () => {
      const liberer = () => {
        try {
          fn.destroy?.();
        } catch {
          /* déjà libérée */
        }
      };
      try {
        if (suspensible && fn.callPromising && dansPython === 0 && sondePython?.() !== true) {
          let p: Promise<unknown>;
          dansPython++;
          try {
            p = fn.callPromising();
          } finally {
            dansPython--;
          }
          p.catch((e) => console.error("[fenêtres]", e)).finally(liberer);
        } else {
          fn();
          liberer();
        }
      } catch (e) {
        console.error("[fenêtres]", e);
        liberer();
      }
    };
    const id: number = window.setTimeout(() => {
      if (doitAttendre()) fileTk.push(Object.assign(() => tirer(), { minuterie: id }));
      else tirer();
    }, Math.max(0, ms));
    return id;
  },
  creerFenetre,
  creer,
  configurer,
  geometrie,
  grilleConfig,
  detruire,
  lire,
  ecrire,
  ecouter,
  observerTaille,
  dessin,
  menuContextuel(menuId: number, items: Opts[], x: number, y: number) {
    ouvrirDeroulant(menuId, items, x, y);
  },
  /** Description fraîche d'un menu (à l'ouverture : postcommand, coches des variables). */
  descMenu(menuId: number, items: Opts[]) {
    descMenus.set(menuId, items);
    memoriserMenus(items);
  },
  /** Couleur CSS normalisée par le navigateur (« #rrggbb » ou « rgba(…) ») : noms de couleurs du Python. */
  rgb(c: string): string {
    if (mesureur === undefined) mesureur = document.createElement("canvas").getContext("2d");
    if (!mesureur) return "";
    mesureur.fillStyle = "#010203";
    mesureur.fillStyle = c;
    const v = String(mesureur.fillStyle);
    return v === "#010203" && c.toLowerCase() !== "#010203" ? "" : v;
  },
  ecran(): number[] {
    return [window.innerWidth, window.innerHeight];
  },
  alerte(titre: string, message: string) {
    window.alert(titre ? `${titre}\n\n${message}` : message);
  },
  confirmer(titre: string, message: string): boolean {
    return window.confirm(titre ? `${titre}\n\n${message}` : message);
  },
  demander(titre: string, message: string, defaut: string): string | null {
    return window.prompt(titre ? `${titre}\n\n${message}` : message, defaut ?? "");
  },
}, ["definirRappel", "retour"]);

/** Ferme toutes les fenêtres des programmes (bouton « Fermer les fenêtres » de la console). */
export function fermerToutesFenetres(): void {
  for (const id of [...fenetres.keys()]) appeler(id, "fermer", { force: true });
  for (const id of [...fenetres.keys()]) detruire(id);
}

/** Nombre de fenêtres ouvertes, pour l'interface de la console. */
export function abonnerFenetres(f: (n: number) => void): () => void {
  ecouteursFenetres.add(f);
  return () => ecouteursFenetres.delete(f);
}

export function nombreFenetres(): number {
  return fenetres.size;
}
