/**
 * Interprétation des séquences de terminal dans la sortie de la console Python (pur, testé) :
 * couleurs ANSI (SGR : 30-37, 90-97, 38;5;n, 38;2;r;g;b, 39, 1 gras, 22, 0), retour chariot `\r`
 * (la ligne est réécrite, comme les barres de progression), retour arrière `\b` et effacement de
 * ligne (`ESC[K`). Les autres séquences (déplacements du curseur, titres…) sont ignorées.
 */

export interface SegmentAnsi {
  texte: string;
  /** Couleur CSS du texte (absente = couleur par défaut). */
  couleur?: string;
  gras?: boolean;
}

/** Une ligne affichée : suite de segments (sans « \n »). */
export type LigneAnsi = SegmentAnsi[];

/* Les 16 couleurs de base, choisies lisibles sur fond clair comme sur fond sombre
   (« noir » et « blanc » sont rendus en gris pour rester visibles dans les deux thèmes). */
const PALETTE = [
  "#6b7280", "#dc2626", "#16a34a", "#ca8a04", "#2563eb", "#c026d3", "#0891b2", "#9ca3af",
  "#4b5563", "#ef4444", "#22c55e", "#eab308", "#3b82f6", "#d946ef", "#06b6d4", "#a1a1aa",
];

/** Couleur de la palette 256 couleurs (38;5;n). */
function couleur256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 16) return PALETTE[n];
  if (n >= 232) {
    const g = 8 + (n - 232) * 10;
    return `rgb(${g},${g},${g})`;
  }
  const i = n - 16;
  const niveau = (v: number) => (v === 0 ? 0 : 55 + v * 40);
  return `rgb(${niveau(Math.floor(i / 36))},${niveau(Math.floor(i / 6) % 6)},${niveau(i % 6)})`;
}

interface Style {
  couleur?: string;
  gras?: boolean;
}

/** Applique une séquence SGR (« ESC[…m ») au style courant. */
function appliquerSgr(style: Style, parametres: string): Style {
  const p = parametres === "" ? [0] : parametres.split(/[;:]/).map((x) => (x === "" ? 0 : Number(x)));
  let s: Style = { ...style };
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === 0) s = {};
    else if (n === 1) s.gras = true;
    else if (n === 22) s.gras = undefined;
    else if (n >= 30 && n <= 37) s.couleur = PALETTE[n - 30];
    else if (n >= 90 && n <= 97) s.couleur = PALETTE[n - 90 + 8];
    else if (n === 39) s.couleur = undefined;
    else if (n === 38 || n === 48) {
      // Couleur étendue : 5;n (256 couleurs) ou 2;r;g;b (vraies couleurs). Le fond (48) est ignoré.
      let c: string | undefined;
      if (p[i + 1] === 5) {
        c = couleur256(p[i + 2]);
        i += 2;
      } else if (p[i + 1] === 2) {
        const [r, g, b] = [p[i + 2], p[i + 3], p[i + 4]].map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
        c = `rgb(${r},${g},${b})`;
        i += 4;
      }
      if (n === 38 && c) s.couleur = c;
    }
    // Autres attributs (italique, souligné, fond…) : ignorés.
  }
  return s;
}

const memeStyle = (a: Style, b: Style) => a.couleur === b.couleur && Boolean(a.gras) === Boolean(b.gras);

/** Convertit une ligne de cellules (un caractère + un style chacune) en segments fusionnés. */
function segmentsDeLigne(cellules: { c: string; s: Style }[]): LigneAnsi {
  const out: LigneAnsi = [];
  for (const { c, s } of cellules) {
    const dernier = out[out.length - 1];
    if (dernier && memeStyle(dernier, s)) dernier.texte += c;
    else out.push({ texte: c, ...(s.couleur ? { couleur: s.couleur } : {}), ...(s.gras ? { gras: true } : {}) });
  }
  return out;
}

/**
 * Découpe le texte en lignes de segments colorés, comme un terminal : « \r » ramène le curseur en
 * début de ligne (les caractères suivants écrasent les anciens), « \b » recule d'un caractère,
 * « ESC[K » efface la fin de la ligne. Autant de lignes que `texte.split("\n")`.
 */
export function lignesAnsi(texte: string): LigneAnsi[] {
  const lignes: LigneAnsi[] = [];
  let style: Style = {};
  let ligne: { c: string; s: Style }[] = [];
  let curseur = 0;
  const ecrire = (c: string) => {
    if (curseur < ligne.length) ligne[curseur] = { c, s: style };
    else {
      while (ligne.length < curseur) ligne.push({ c: " ", s: {} });
      ligne.push({ c, s: style });
    }
    curseur++;
  };
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (c === "\n") {
      lignes.push(segmentsDeLigne(ligne));
      ligne = [];
      curseur = 0;
    } else if (c === "\r") {
      curseur = 0;
    } else if (c === "\b") {
      curseur = Math.max(0, curseur - 1);
    } else if (c === "\x1b") {
      const suivant = texte[i + 1];
      if (suivant === "[") {
        // CSI : paramètres puis une lettre finale.
        let j = i + 2;
        while (j < texte.length && /[0-9;:?<=>]/.test(texte[j])) j++;
        const fin = texte[j];
        const parametres = texte.slice(i + 2, j);
        if (fin === "m") style = appliquerSgr(style, parametres);
        else if (fin === "K") {
          const mode = parametres === "" ? 0 : Number(parametres);
          if (mode === 0) ligne = ligne.slice(0, curseur);
          else if (mode === 1) ligne = ligne.map((x, k) => (k <= curseur ? { c: " ", s: {} } : x));
          else if (mode === 2) ligne = [];
        } else if (fin === "G") curseur = Math.max(0, (Number(parametres) || 1) - 1);
        i = fin === undefined ? texte.length : j;
      } else if (suivant === "]") {
        // OSC (titre de fenêtre, lien…) : jusqu'à BEL ou ESC \.
        let j = i + 2;
        while (j < texte.length && texte[j] !== "\x07" && !(texte[j] === "\x1b" && texte[j + 1] === "\\")) j++;
        i = texte[j] === "\x1b" ? j + 1 : j;
      } else if (suivant !== undefined) {
        i++; // séquence de deux caractères (ESC 7, ESC 8…) : ignorée
      }
    } else if (c === "\x07" || c === "\x00") {
      // sonnerie, caractère nul : ignorés
    } else {
      ecrire(c);
    }
  }
  lignes.push(segmentsDeLigne(ligne));
  return lignes;
}

/** Même interprétation, à plat : segments successifs, les fins de ligne restant dans le texte. */
export function segmentsAnsi(texte: string): SegmentAnsi[] {
  const out: SegmentAnsi[] = [];
  lignesAnsi(texte).forEach((ligne, i) => {
    if (i > 0) {
      // La fin de ligne rejoint le segment précédent (elle n'a pas de couleur visible).
      if (out.length) out[out.length - 1].texte += "\n";
      else out.push({ texte: "\n" });
    }
    for (const s of ligne) {
      const dernier = out[out.length - 1];
      if (dernier && memeStyle(dernier, s)) dernier.texte += s.texte;
      else out.push({ ...s });
    }
  });
  return out;
}

/** Texte brut d'une ligne. */
export function texteLigne(ligne: LigneAnsi): string {
  return ligne.map((s) => s.texte).join("");
}

/**
 * Limite les lignes affichées (après interprétation des « \r ») : au plus `maxLignes` lignes et
 * `maxCar` caractères. Renvoie les lignes gardées et l'avertissement à afficher, s'il y a lieu.
 */
export function tronquerLignes(lignes: LigneAnsi[], maxLignes: number, maxCar: number): { lignes: LigneAnsi[]; avertissement: string | null } {
  const gardees: LigneAnsi[] = [];
  let car = 0;
  for (let i = 0; i < lignes.length; i++) {
    if (i >= maxLignes) return { lignes: gardees, avertissement: `[… ${lignes.length - maxLignes} lignes de plus]` };
    const longueur = texteLigne(lignes[i]).length;
    if (car + longueur > maxCar) {
      let reste = maxCar - car;
      const coupee: LigneAnsi = [];
      for (const s of lignes[i]) {
        if (reste <= 0) break;
        coupee.push({ ...s, texte: s.texte.slice(0, reste) });
        reste -= s.texte.length;
      }
      if (coupee.length) gardees.push(coupee);
      return { lignes: gardees, avertissement: "[… sortie tronquée]" };
    }
    car += longueur + 1;
    gardees.push(lignes[i]);
  }
  return { lignes: gardees, avertissement: null };
}
