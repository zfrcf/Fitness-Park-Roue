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
type Rappel = (cible: number, type: string, donnees: Opts) => unknown;
type Gestion = "pack" | "grid" | "place";

interface CanvasEtat {
  svg: SVGSVGElement;
  items: Map<number, SVGElement>;
  fenetres: Map<number, number>; // item « window » → id du widget intégré
  anime: number; // opérations par image (0 = immédiat) : animation de turtle
  file: unknown[][];
  enCours: boolean;
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
}

const SVG = "http://www.w3.org/2000/svg";
const widgets = new Map<number, Widget>();
const fenetres = new Map<number, Fenetre>();
let rappel: Rappel | null = null;
let couche: HTMLElement | null = null;
let zMax = 70;
let ordrePack = 0;
let cascade = 0;
const sales = new Set<Widget>();
let planifie = false;
const ecouteursFenetres = new Set<(n: number) => void>();

function appeler(cible: number, type: string, donnees: Opts = {}): unknown {
  try {
    return rappel?.(cible, type, donnees);
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
.tk-corps{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;overflow:hidden}
.tk-cavite{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}
.tk-parcelle{display:flex;min-width:0;min-height:0}
.tk-grille{display:grid;flex:1 1 auto;min-width:0;min-height:0;align-content:start;justify-content:start}
.tk-cellule{display:flex;min-width:0;min-height:0}
.tk-w{position:relative;flex:0 0 auto;min-width:0;min-height:0}
.tk-frame{display:flex;flex-direction:column}
.tk-labelframe{display:flex;flex-direction:column;border:1px solid #c8c8c8;border-radius:3px;margin:0;padding:4px 6px 6px}
.tk-labelframe>legend{padding:0 4px;font-size:inherit}
.tk-label{display:flex;align-items:center;justify-content:center;white-space:pre;padding:1px 2px;line-height:1.25}
.tk-label img{display:block}
.tk-button{font:inherit;color:inherit;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:pre;border:1px solid #adadad;background:#e1e1e1;padding:3px 10px;border-radius:2px;cursor:pointer;line-height:1.2}
.tk-button:hover:not(:disabled){background:#e5f1fb;border-color:#0078d7}
.tk-button:active:not(:disabled){background:#cce4f7}
.tk-button:disabled{color:#a0a0a0;cursor:default}
.tk-entry{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 4px;border-radius:1px;outline:none;min-width:0}
.tk-entry:focus{border-color:#0078d7}
.tk-entry:disabled,.tk-entry[readonly]{background:#f0f0f0;color:#6d6d6d}
.tk-text{font:13px Consolas,"Courier New",monospace;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 4px;white-space:pre-wrap;overflow:auto;outline:none;overflow-wrap:anywhere}
.tk-listbox{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;outline:none;overflow:auto}
.tk-listbox option{padding:0 4px}
.tk-listbox option:checked{background:#0078d7 linear-gradient(#0078d7,#0078d7);color:#fff}
.tk-check{display:inline-flex;align-items:center;gap:5px;white-space:pre;padding:1px 2px;cursor:default}
.tk-check input{margin:0}
.tk-scale{display:flex;flex-direction:column;align-items:stretch;padding:1px 2px}
.tk-scale.vertical{flex-direction:row}
.tk-scale input{min-width:0}
.tk-scale .tk-valeur{text-align:center;font-size:12px}
.tk-canvas{overflow:hidden;background:#f0f0f0}
.tk-canvas svg{position:absolute;inset:0;overflow:visible}
.tk-canvas>.tk-w{position:absolute}
.tk-select{font:inherit;color:#000;background:#fff;border:1px solid #7a7a7a;padding:2px 2px;border-radius:2px;min-width:0}
.tk-progress{height:18px;accent-color:#06b025}
.tk-separateur{background:#c8c8c8}
.tk-tableau{background:#fff;border:1px solid #9a9a9a;overflow:auto;font:inherit}
.tk-tableau table{border-collapse:collapse;width:100%;color:#000}
.tk-tableau th{position:sticky;top:0;background:#f3f3f3;border-right:1px solid #ddd;border-bottom:1px solid #ccc;font-weight:400;padding:3px 6px;text-align:left;white-space:nowrap;cursor:default}
.tk-tableau td{padding:2px 6px;white-space:nowrap;border-bottom:1px solid #f1f1f1}
.tk-tableau tr.sel td{background:#0078d7;color:#fff}
.tk-tableau tr:hover:not(.sel) td{background:#e5f3ff}
.tk-onglets{display:flex;flex-direction:column}
.tk-onglets>.tk-tabs{display:flex;gap:0;border-bottom:1px solid #c8c8c8;flex:none}
.tk-onglets>.tk-tabs>button{font:inherit;color:inherit;border:1px solid transparent;border-bottom:0;background:transparent;padding:4px 10px;margin-bottom:-1px;cursor:default}
.tk-onglets>.tk-tabs>button.actif{background:#fff;border-color:#c8c8c8;border-radius:3px 3px 0 0}
.tk-onglets>.tk-page{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;background:#fff;border:1px solid #c8c8c8;border-top:0}
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
  couche = document.createElement("div");
  couche.className = "tk-couche";
  document.body.appendChild(couche);
  return couche;
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
function ancreFlex(ancre: unknown): [string, string] {
  const a = texte(ancre) || "center";
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

function disposerTout() {
  planifie = false;
  const liste = [...sales];
  sales.clear();
  for (const w of liste) if (!w.detruit) disposer(w);
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
    fen: undefined as unknown as Fenetre, opts: {}, propage: true, lignes: new Map(), colonnes: new Map(),
  };
  const f: Fenetre = { id, cadre, barre, titre, menu, widget: w, ecoutes: new Set(), tailleFixe: false };
  w.fen = f;
  widgets.set(id, w);
  fenetres.set(id, f);
  premierPlan(f);
  deplacable(f);
  cadre.addEventListener("pointerdown", () => premierPlan(f), true);
  cadre.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest("input,textarea,select,[contenteditable],button")) cadre.focus({ preventScroll: true });
  });
  requestAnimationFrame(() => {
    recadrer(f, true);
    if (!document.activeElement || document.activeElement === document.body || !document.activeElement.closest(".tk-fen")) cadre.focus({ preventScroll: true });
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
    const coche = it.type === "check" || it.type === "radio" ? (it.coche ? "✓ " : " ") : "";
    libelle.textContent = coche + texte(it.label);
    const acc = el("span");
    acc.style.color = "#666";
    acc.textContent = it.type === "cascade" ? "›" : texte(it.accelerateur);
    b.append(libelle, acc);
    b.disabled = it.etat === "disabled";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.type === "cascade") {
        const r = b.getBoundingClientRect();
        ouvrirDeroulant(nb(it.menu), (it.items as Opts[]) ?? [], r.right, r.top, true);
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

function dessinerMenu(f: Fenetre, barre: Opts[] | null) {
  f.menu.replaceChildren();
  f.menu.classList.toggle("actif", !!barre?.length);
  for (const cascadeItem of barre ?? []) {
    const b = el("button");
    b.type = "button";
    b.textContent = texte(cascadeItem.label);
    b.addEventListener("click", () => {
      if (cascadeItem.type !== "cascade") {
        appeler(nb(cascadeItem.menu), "menu", { index: nb(cascadeItem.index) });
        return;
      }
      const r = b.getBoundingClientRect();
      ouvrirDeroulant(nb(cascadeItem.menu), (cascadeItem.items as Opts[]) ?? [], r.left, r.bottom);
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
    fen: parent.fen, opts: {}, propage: true, lignes: new Map(), colonnes: new Map(),
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
      t.addEventListener("input", () => appeler(id, "valeur", { valeur: lireTexte(t) }));
      e = t;
      break;
    }
    case "listbox": {
      const s = el("select", "tk-w tk-listbox");
      s.size = 10;
      s.addEventListener("change", () => appeler(id, "selection", { indices: [...s.selectedOptions].map((o) => o.index) }));
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
      const i = el("input", "tk-w tk-entry");
      i.type = "number";
      i.addEventListener("input", () => appeler(id, "valeur", { valeur: i.value }));
      i.addEventListener("change", () => appeler(id, "commande", { valeur: i.value }));
      e = i;
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
      const d = el("div", "tk-w");
      d.style.display = "flex";
      const i = el("input", "tk-entry");
      i.type = "text";
      const liste = el("datalist");
      liste.id = `tk-liste-${id}`;
      i.setAttribute("list", liste.id);
      i.style.flex = "1";
      i.style.minWidth = "0";
      i.addEventListener("input", () => {
        const choisi = [...liste.options].some((o) => o.value === i.value);
        appeler(id, choisi ? "commande" : "valeur", { valeur: i.value });
      });
      const s = el("select", "tk-select");
      s.style.flex = "1";
      s.style.minWidth = "0";
      s.style.display = "none";
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
      e = d;
      contenu = d;
      break;
    }
    case "treeview":
      e = el("div", "tk-w tk-tableau");
      e.appendChild(el("table"));
      break;
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
  widgets.set(id, w);
  parent.enfants.push(w);
  configurer(id, opts);
}

function lireTexte(t: HTMLElement): string {
  // innerText ajoute un « \n » final pour une zone vide ou terminée par un saut de ligne.
  return t.innerText.replace(/\n$/, "");
}

function appliquerCommun(w: Widget, o: Opts) {
  const s = w.el.style;
  if ("fond" in o) s.background = texte(o.fond);
  if ("couleur" in o) s.color = texte(o.couleur);
  if ("police" in o) s.font = texte(o.police);
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
    // largeur / hauteur : en caractères/lignes (« ch »/« lh ») ou en pixels
    const d = o.dimensions as Opts;
    const unite = (v: unknown, u: unknown) => (v === undefined || v === null || nb(v) <= 0 ? "" : u === "car" ? `${nb(v) + 1}ch` : u === "lignes" ? `${nb(v) * 1.3 + 0.4}em` : `${nb(v)}px`);
    s.width = unite(d.largeur, d.uniteL);
    s.height = unite(d.hauteur, d.uniteH);
    if (w.type === "frame" || w.type === "labelframe" || w.type === "canvas") {
      s.minWidth = "";
      s.minHeight = "";
    }
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
  const span = document.createTextNode(texte(t));
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
      if (desactive !== undefined) (e as HTMLButtonElement).disabled = desactive;
      if ("actif" in o) e.style.background = texte(o.actif);
      break;
    }
    case "entry":
    case "spinbox": {
      const i = e as HTMLInputElement;
      if ("valeur" in o) i.value = texte(o.valeur);
      if ("masque" in o) i.type = o.masque ? "password" : w.type === "spinbox" ? "number" : "text";
      if ("etat" in o) {
        i.disabled = o.etat === "disabled";
        i.readOnly = o.etat === "readonly";
      }
      if ("justif" in o) i.style.textAlign = texte(o.justif);
      if ("de" in o) i.min = texte(o.de);
      if ("a" in o) i.max = texte(o.a);
      if ("pas" in o) i.step = texte(o.pas);
      break;
    }
    case "text": {
      if ("contenu" in o) dessinerTexte(e, o.contenu as Opts[]);
      if ("etat" in o) e.contentEditable = o.etat === "disabled" ? "false" : "plaintext-only";
      if ("retourLigne" in o) e.style.whiteSpace = o.retourLigne === "none" ? "pre" : "pre-wrap";
      if ("defiler" in o) e.scrollTop = o.defiler === "fin" ? e.scrollHeight : 0;
      break;
    }
    case "listbox": {
      const s = e as HTMLSelectElement;
      if ("hauteurLignes" in o) s.size = Math.max(2, nb(o.hauteurLignes, 10));
      if ("multiple" in o) s.multiple = !!o.multiple;
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
      if ("voir" in o) s.options[nb(o.voir)]?.scrollIntoView({ block: "nearest" });
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
      if ("longueur" in o) {
        const vertical = w.opts.orient === "vertical" || o.orient === "vertical";
        if (vertical) i.style.height = `${nb(o.longueur, 100)}px`;
        else i.style.width = `${nb(o.longueur, 100)}px`;
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
        s.value = actuelle;
      }
      if ("valeur" in o) s.value = texte(o.valeur);
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
        s.value = i.value;
      }
      if ("valeur" in o) {
        i.value = texte(o.valeur);
        s.value = i.value;
      }
      if ("etat" in o) {
        const lecture = o.etat === "readonly";
        i.style.display = lecture ? "none" : "";
        s.style.display = lecture ? "" : "none";
        i.disabled = s.disabled = o.etat === "disabled";
      }
      if ("police" in o) i.style.font = s.style.font = texte(o.police);
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
      if ("dimensions" in o) {
        const d = o.dimensions as Opts;
        c.svg.setAttribute("width", texte(d.largeur));
        c.svg.setAttribute("height", texte(d.hauteur));
      }
      break;
    }
    case "treeview":
      if ("arbre" in o) dessinerArbre(w, o.arbre as Opts);
      if ("hauteurLignes" in o) e.style.height = `${nb(o.hauteurLignes, 10) * 22 + 28}px`;
      break;
    case "notebook":
      if ("onglets" in o) dessinerOnglets(w, o.onglets as Opts);
      break;
  }
  if ("propage" in o) {
    w.propage = !!o.propage;
    demanderDisposition(w);
  }
  Object.assign(w.opts, o);
  if (w.type === "frame" || w.type === "labelframe") tailleCadre(w);
  demanderDisposition(w.parent);
}

/** Un cadre prend la taille de ses enfants, sauf s'il est vide ou si la propagation est coupée. */
function tailleCadre(w: Widget) {
  const d = w.opts.dimensions as Opts | undefined;
  const geres = w.enfants.some((e) => e.geo && !e.detruit && e.geo.gestion !== "place");
  const fixe = !w.propage || !geres;
  const l = d?.largeur !== undefined ? nb(d.largeur) : 0;
  const h = d?.hauteur !== undefined ? nb(d.hauteur) : 0;
  w.el.style.width = fixe && l > 0 ? `${l}px` : "";
  w.el.style.height = fixe && h > 0 ? `${h}px` : "";
}

function dessinerTexte(t: HTMLElement, segments: Opts[]) {
  const fin = t.scrollTop + t.clientHeight >= t.scrollHeight - 4;
  t.replaceChildren(
    ...(segments ?? []).map((sg) => {
      if (!sg.style) return document.createTextNode(texte(sg.texte));
      const s = el("span");
      s.textContent = texte(sg.texte);
      const st = sg.style as Opts;
      if (st.couleur) s.style.color = texte(st.couleur);
      if (st.fond) s.style.background = texte(st.fond);
      if (st.police) s.style.font = texte(st.police);
      if (st.souligne) s.style.textDecoration = "underline";
      if (st.barre) s.style.textDecoration = "line-through";
      if (st.justif) s.style.textAlign = texte(st.justif);
      return s;
    }),
  );
  if (fin) t.scrollTop = t.scrollHeight;
}

function dessinerArbre(w: Widget, a: Opts) {
  const table = w.el.querySelector("table") as HTMLTableElement;
  const colonnes = (a.colonnes as Opts[]) ?? [];
  const lignes = (a.lignes as Opts[]) ?? [];
  const selection = new Set((a.selection as string[]) ?? []);
  const thead = el("thead");
  const tr = el("tr");
  if (a.entetes !== false) {
    for (const c of colonnes) {
      const th = el("th");
      th.textContent = texte(c.titre);
      if (c.largeur) th.style.width = `${nb(c.largeur)}px`;
      th.style.textAlign = c.ancre === "center" ? "center" : c.ancre === "e" ? "right" : "left";
      th.addEventListener("click", () => appeler(w.id, "entete", { colonne: texte(c.id) }));
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }
  const tbody = el("tbody");
  for (const l of lignes) {
    const ligne = el("tr");
    ligne.dataset.iid = texte(l.iid);
    if (selection.has(texte(l.iid))) ligne.className = "sel";
    if (l.fond) ligne.style.background = texte(l.fond);
    if (l.couleur) ligne.style.color = texte(l.couleur);
    const valeurs = (l.cellules as unknown[]) ?? [];
    valeurs.forEach((v, i) => {
      const td = el("td");
      const c = colonnes[i];
      if (i === 0 && a.arbre) {
        td.style.paddingLeft = `${6 + nb(l.niveau) * 16}px`;
        const fleche = l.aEnfants ? (l.ouvert ? "▾ " : "▸ ") : "";
        td.textContent = fleche + texte(v);
        if (l.aEnfants)
          td.addEventListener("click", (e) => {
            if ((e as MouseEvent).offsetX < 6 + nb(l.niveau) * 16 + 14) appeler(w.id, "ouvrir", { iid: texte(l.iid) });
          });
      } else td.textContent = texte(v);
      if (c?.ancre) td.style.textAlign = c.ancre === "center" ? "center" : c.ancre === "e" ? "right" : "left";
      ligne.appendChild(td);
    });
    ligne.addEventListener("click", (e) => {
      const multi = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey;
      appeler(w.id, "selection", { iid: texte(l.iid), ajouter: multi });
    });
    tbody.appendChild(ligne);
  }
  table.replaceChildren(thead, tbody);
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
  for (const e of w.enfants) {
    if (e.detruit) continue;
    const visible = nb(e.id) === actif;
    e.geo = visible ? { gestion: "pack", opts: { fill: "both", expand: 1 }, ordre: 0 } : null;
    if (!visible) e.el.remove();
  }
  demanderDisposition(w);
}

/* ───────────────────────────── Géométrie ───────────────────────────── */

function geometrie(id: number, gestion: Gestion | null, opts: Opts) {
  const w = widgets.get(id);
  if (!w || !w.parent) return;
  if (w.parent.type === "notebook") return; // les pages sont affichées par le Notebook
  const ancienParent = w.parent;
  w.geo = gestion ? { gestion, opts, ordre: w.geo?.gestion === gestion && gestion === "pack" && !opts.nouveau ? w.geo.ordre : ++ordrePack } : null;
  if (gestion === "pack" && (opts.avant !== undefined || opts.apres !== undefined)) {
    const ref = widgets.get(nb(opts.avant ?? opts.apres));
    if (ref?.geo) w.geo!.ordre = ref.geo.ordre + (opts.avant !== undefined ? -0.5 : 0.5);
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
  for (const n of [...c.contenu.children]) if ((n as HTMLElement).classList.contains("tk-cavite") || (n as HTMLElement).classList.contains("tk-grille") || (n as HTMLElement).dataset.tkid) n.remove();
  if (grid.length) disposerGrille(c, grid);
  else if (pack.length) disposerPack(c, pack);
  for (const p of place) disposerPlace(c, p);
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

function disposerPack(c: Widget, kids: Widget[]) {
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

function disposerGrille(c: Widget, kids: Widget[]) {
  const g = el("div", "tk-grille");
  c.contenu.appendChild(g);
  let nbCol = 0;
  let nbLig = 0;
  for (const k of kids) {
    const o = k.geo!.opts;
    nbCol = Math.max(nbCol, nb(o.column) + Math.max(1, nb(o.columnspan, 1)));
    nbLig = Math.max(nbLig, nb(o.row) + Math.max(1, nb(o.rowspan, 1)));
  }
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
    interne(k);
    cell.appendChild(k.el);
    g.appendChild(cell);
  }
}

function disposerPlace(c: Widget, k: Widget) {
  const o = k.geo!.opts;
  const s = k.el.style;
  s.position = "absolute";
  const x = nb(o.x);
  const y = nb(o.y);
  const rx = nb(o.relx);
  const ry = nb(o.rely);
  s.left = `calc(${rx * 100}% + ${x}px)`;
  s.top = `calc(${ry * 100}% + ${y}px)`;
  if (o.width !== undefined || o.relwidth !== undefined) s.width = `calc(${nb(o.relwidth) * 100}% + ${nb(o.width)}px)`;
  if (o.height !== undefined || o.relheight !== undefined) s.height = `calc(${nb(o.relheight) * 100}% + ${nb(o.height)}px)`;
  const a = texte(o.anchor) || "nw";
  const tx = a.includes("e") ? "-100%" : a.includes("w") ? "0" : "-50%";
  const ty = a.includes("s") ? "-100%" : a.includes("n") ? "0" : "-50%";
  s.transform = tx === "0" && ty === "0" ? "" : `translate(${tx}, ${ty})`;
  c.contenu.style.position = "relative";
  c.contenu.appendChild(k.el);
}

/* ───────────────────────────── Canvas ───────────────────────────── */

function svgEl(tag: string): SVGElement {
  return document.createElementNS(SVG, tag) as SVGElement;
}

function points(coords: number[]): string {
  const p: string[] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) p.push(`${coords[i]},${coords[i + 1]}`);
  return p.join(" ");
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
  if (o.dash) set("stroke-dasharray", Array.isArray(o.dash) ? (o.dash as number[]).join(" ") : o.dash);
  e.style.display = o.state === "hidden" ? "none" : "";
}

function dessinerItem(c: CanvasEtat, w: Widget, item: number, kind: string, coords: number[], o: Opts) {
  let e = c.items.get(item);
  const nouveau = !e;
  if (!e) {
    const tag = { line: "polyline", rectangle: "rect", oval: "ellipse", polygon: "polygon", text: "text", arc: "path", image: "image", window: "g" }[kind] ?? "g";
    e = kind === "line" ? svgEl("g") : svgEl(tag);
    e.dataset.item = String(item);
    c.items.set(item, e);
  }
  if (kind === "line") {
    e.replaceChildren();
    const ligne = svgEl("polyline");
    ligne.setAttribute("points", points(coords));
    styleItem(ligne, "line", o);
    e.appendChild(ligne);
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
    e.setAttribute("points", points(coords));
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
    if (style === "pieslice") d = `M ${cx} ${cy} L ${px(debut)} ${py(debut)} A ${rx} ${ry} 0 ${grand} ${sens} ${px(fin)} ${py(fin)} Z`;
    else if (style === "chord") d += " Z";
    e.setAttribute("d", d);
    styleItem(e, style === "arc" ? "line" : kind, style === "arc" ? { ...o, fill: o.outline ?? "black" } : o);
  } else if (kind === "text") {
    const [x, y] = coords;
    const a = texte(o.anchor) || "center";
    e.setAttribute("text-anchor", a.includes("w") ? "start" : a.includes("e") ? "end" : "middle");
    const lignes = texte(o.text).split("\n");
    const base = a.includes("n") ? "hanging" : a.includes("s") ? "text-after-edge" : "central";
    e.setAttribute("dominant-baseline", base);
    e.replaceChildren(
      ...lignes.map((l, i) => {
        const t = svgEl("tspan");
        t.setAttribute("x", String(x));
        t.setAttribute("dy", i === 0 ? (a.includes("s") ? `${-(lignes.length - 1) * 1.2}em` : a.includes("n") ? "0" : `${-((lignes.length - 1) * 1.2) / 2}em`) : "1.2em");
        t.textContent = l;
        return t;
      }),
    );
    e.setAttribute("x", String(x));
    e.setAttribute("y", String(y));
    e.style.font = texte(o.font) || '13px "Segoe UI",system-ui,sans-serif';
    styleItem(e, kind, o);
    e.style.userSelect = "none";
  } else if (kind === "image") {
    const [x, y] = coords;
    const im = (o.image ?? {}) as Opts;
    const l = nb(im.largeur);
    const h = nb(im.hauteur);
    const a = texte(o.anchor) || "center";
    e.setAttribute("href", texte(im.src));
    e.setAttribute("width", String(l));
    e.setAttribute("height", String(h));
    e.setAttribute("x", String(a.includes("w") ? x : a.includes("e") ? x - l : x - l / 2));
    e.setAttribute("y", String(a.includes("n") ? y : a.includes("s") ? y - h : y - h / 2));
    e.style.display = o.state === "hidden" ? "none" : "";
  } else if (kind === "window") {
    const cible = widgets.get(nb(o.widget));
    if (cible) {
      c.fenetres.set(item, cible.id);
      cible.dansCanvas = w.id;
      const [x, y] = coords;
      const a = texte(o.anchor) || "center";
      const s = cible.el.style;
      s.position = "absolute";
      s.left = `${x}px`;
      s.top = `${y}px`;
      s.transform = `translate(${a.includes("w") ? "0" : a.includes("e") ? "-100%" : "-50%"}, ${a.includes("n") ? "0" : a.includes("s") ? "-100%" : "-50%"})`;
      if (o.width !== undefined) s.width = `${nb(o.width)}px`;
      if (o.height !== undefined) s.height = `${nb(o.height)}px`;
      w.el.appendChild(cible.el);
    }
  }
  if (nouveau) c.svg.appendChild(e);
}

function operationCanvas(w: Widget, op: unknown[]) {
  const c = w.canvas!;
  const [nom, item] = op as [string, number];
  if (nom === "creer" || nom === "maj") dessinerItem(c, w, item, op[2] as string, (op[3] as number[]) ?? [], (op[4] as Opts) ?? {});
  else if (nom === "suppr") {
    c.items.get(item)?.remove();
    c.items.delete(item);
    const wid = c.fenetres.get(item);
    if (wid !== undefined) {
      widgets.get(wid)?.el.remove();
      c.fenetres.delete(item);
    }
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
  } else if (nom === "vider") {
    c.svg.replaceChildren();
    c.items.clear();
  } else if (nom === "fond") {
    w.el.style.background = texte(op[2]);
  }
}

function dessin(id: number, ops: unknown[][]) {
  const w = widgets.get(id);
  if (!w?.canvas) return;
  const c = w.canvas;
  if (!c.anime && !c.file.length) {
    for (const op of ops) operationCanvas(w, op);
    return;
  }
  c.file.push(...ops);
  if (c.enCours) return;
  c.enCours = true;
  const pas = () => {
    if (w.detruit) return;
    const n = Math.max(1, c.anime || c.file.length);
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
    item: item ? Number(item.dataset.item) : undefined,
    autreItem: autreItem ? Number(autreItem.dataset.item) : undefined,
    ligne: ligne?.dataset.iid,
  };
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
      const cible = cibleDe(e.target) ?? fenId;
      let d: Opts;
      if (e instanceof KeyboardEvent) {
        if (e.isComposing) return;
        d = { touche: SYMBOLES[e.key] ?? e.key, car: e.key.length === 1 ? e.key : e.key === "Enter" ? "\r" : e.key === "Backspace" ? "\b" : e.key === "Tab" ? "\t" : e.key === "Escape" ? "\x1b" : "", code: e.keyCode, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
      } else if (e instanceof WheelEvent) {
        d = { ...donneesSouris(e, cible), delta: Math.round(-e.deltaY) || (e.deltaY > 0 ? -120 : 120) };
      } else if (e instanceof MouseEvent) {
        d = donneesSouris(e, cible);
        if (t === "mouseover" || t === "mouseout") d.autre = cibleDe(e.relatedTarget) ?? 0;
      } else d = {};
      const r = appeler(cible, t, d);
      if (r === "break" || (t === "wheel" && r === "prevent") || (t === "keydown" && r === "prevent")) e.preventDefault();
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

function lire(id: number, quoi: string): unknown {
  if (planifie) disposerTout();
  const w = widgets.get(id);
  if (!w) return null;
  const e = w.type === "fenetre" ? w.contenu : w.el;
  switch (quoi) {
    case "valeur":
      if (w.type === "text") return lireTexte(w.el);
      if (w.type === "combobox") return (w.el.querySelector("input") as HTMLInputElement).value;
      if (w.type === "select") return (w.el as HTMLSelectElement).value;
      if (w.type === "scale") return (w.el.querySelector("input") as HTMLInputElement).value;
      return (w.el as HTMLInputElement).value ?? "";
    case "selection":
      return w.type === "listbox" ? [...(w.el as HTMLSelectElement).selectedOptions].map((o) => o.index) : [];
    case "curseur":
      return w.type === "entry" ? ((w.el as HTMLInputElement).selectionStart ?? 0) : 0;
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

function ecrire(id: number, quoi: string, valeur: unknown) {
  const w = widgets.get(id);
  if (!w) return;
  if (quoi === "focus") {
    const champ = (w.el.matches("input,select,[contenteditable]") ? w.el : w.el.querySelector("input,select")) as HTMLElement | null;
    (champ ?? w.fen.cadre).focus({ preventScroll: true });
    if (valeur === "tout" && champ instanceof HTMLInputElement) champ.select();
  } else if (quoi === "premierPlan") premierPlan(w.fen);
  else if (quoi === "curseur" && w.el instanceof HTMLInputElement) {
    const n = nb(valeur);
    w.el.setSelectionRange(n, n);
  } else if (quoi === "selectionTexte" && w.el instanceof HTMLInputElement) {
    const [a, b] = paire(valeur);
    w.el.setSelectionRange(a, b);
  }
}

function detruire(id: number) {
  const w = widgets.get(id);
  if (!w) return;
  const recursif = (x: Widget) => {
    x.detruit = true;
    x.resize?.disconnect();
    widgets.delete(x.id);
    for (const e of x.enfants) recursif(e);
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

export const moteurFenetres = {
  definirRappel(f: Rappel) {
    rappel = f;
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
};

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
