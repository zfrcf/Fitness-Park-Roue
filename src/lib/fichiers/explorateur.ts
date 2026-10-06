/**
 * Logique (sans React) de l'explorateur de fichiers façon VS Code : arborescence avec dossiers
 * compactés, lignes modifiées entre deux versions, découpage de la coloration syntaxique par ligne.
 */

export interface NoeudDossier {
  type: "dossier";
  /** Libellé affiché : « src/main/java » quand des dossiers à enfant unique sont compactés. */
  nom: string;
  /** Chemin complet du dossier (clé stable pour l'état replié/déplié). */
  chemin: string;
  enfants: Noeud[];
}

export interface NoeudFichier {
  type: "fichier";
  nom: string;
  chemin: string;
}

export type Noeud = NoeudDossier | NoeudFichier;

/** Ordre de VS Code : dossiers d'abord, puis fichiers, chacun par ordre alphabétique naturel. */
function trier(noeuds: Noeud[]): Noeud[] {
  return noeuds.sort((a, b) => (a.type !== b.type ? (a.type === "dossier" ? -1 : 1) : a.nom.localeCompare(b.nom, "fr", { numeric: true, sensitivity: "base" })));
}

/**
 * Arborescence à partir d'une liste de chemins. Comme VS Code (« compact folders »), une suite de
 * dossiers qui ne contiennent chacun qu'un seul sous-dossier est affichée sur une ligne :
 * src/main/java/com/exemple → « src/main/java/com/exemple ».
 */
export function construireArbre(chemins: string[]): Noeud[] {
  interface Brut {
    dossiers: Map<string, Brut>;
    fichiers: string[];
  }
  const racine: Brut = { dossiers: new Map(), fichiers: [] };
  for (const chemin of chemins) {
    const parties = chemin.split("/").filter(Boolean);
    let n = racine;
    for (const p of parties.slice(0, -1)) {
      if (!n.dossiers.has(p)) n.dossiers.set(p, { dossiers: new Map(), fichiers: [] });
      n = n.dossiers.get(p)!;
    }
    if (parties.length) n.fichiers.push(chemin);
  }
  const convertir = (b: Brut, prefixe: string): Noeud[] => {
    const out: Noeud[] = [];
    for (const [nom, sous] of b.dossiers) {
      let libelle = nom;
      let chemin = prefixe ? `${prefixe}/${nom}` : nom;
      let courant = sous;
      while (courant.fichiers.length === 0 && courant.dossiers.size === 1) {
        const [suivant, enfant] = [...courant.dossiers][0];
        libelle += `/${suivant}`;
        chemin += `/${suivant}`;
        courant = enfant;
      }
      out.push({ type: "dossier", nom: libelle, chemin, enfants: convertir(courant, chemin) });
    }
    for (const f of b.fichiers) out.push({ type: "fichier", nom: f.split("/").pop() ?? f, chemin: f });
    return trier(out);
  };
  return convertir(racine, "");
}

/** Dossiers ancêtres d'un chemin de fichier (pour les déplier quand il est ouvert). */
export function dossiersParents(chemin: string): string[] {
  const parties = chemin.split("/");
  return parties.slice(0, -1).map((_, i) => parties.slice(0, i + 1).join("/"));
}

/**
 * Numéros de ligne (à partir de 1) de `nouveau` ajoutés ou modifiés par rapport à `ancien`
 * (plus longue sous-suite commune sur les lignes, comme la gouttière de VS Code).
 * Au-delà d'une taille raisonnable, comparaison ligne à ligne (approximation suffisante).
 */
export function lignesModifiees(ancien: string | undefined, nouveau: string): Set<number> {
  const b = nouveau.split("\n");
  if (ancien === undefined) return new Set(b.map((_, i) => i + 1));
  const a = ancien.split("\n");
  const out = new Set<number>();
  if (a.length * b.length > 4_000_000) {
    b.forEach((l, i) => {
      if (a[i] !== l) out.add(i + 1);
    });
    return out;
  }
  // Table LCS compacte (Uint16 suffit : < 65 536 lignes communes vu la borne ci-dessus).
  const n = a.length;
  const m = b.length;
  const t = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * (m + 1) + j] = a[i] === b[j] ? t[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) {
      i++;
    } else {
      out.add(j + 1);
      j++;
    }
  }
  return out;
}

/**
 * Découpe le HTML produit par highlight.js en une chaîne par ligne de source, en refermant puis
 * rouvrant les <span> qui chevauchent un saut de ligne (commentaires multilignes, chaînes…).
 */
export function decouperHtmlParLigne(html: string): string[] {
  const lignes: string[] = [];
  const ouverts: string[] = [];
  let courant = "";
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) {
      ouverts.push(m[1]);
      courant += m[1];
    } else if (m[2]) {
      ouverts.pop();
      courant += m[2];
    } else if (m[3]) {
      lignes.push(courant + "</span>".repeat(ouverts.length));
      courant = ouverts.join("");
    } else {
      courant += m[4];
    }
  }
  lignes.push(courant + "</span>".repeat(ouverts.length));
  return lignes;
}

/** Langage highlight.js d'après le nom du fichier (undefined : texte brut). */
export function langageDuFichier(chemin: string): string | undefined {
  const nom = chemin.split("/").pop()?.toLowerCase() ?? "";
  if (nom === "dockerfile") return "dockerfile";
  if (nom === "makefile") return "makefile";
  const ext = nom.includes(".") ? nom.split(".").pop()! : "";
  const table: Record<string, string> = {
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    gradle: "groovy",
    groovy: "groovy",
    properties: "properties",
    json: "json",
    mcmeta: "json",
    json5: "json",
    xml: "xml",
    html: "xml",
    svg: "xml",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    cfg: "ini",
    md: "markdown",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    sh: "bash",
    bash: "bash",
    css: "css",
    sql: "sql",
    lua: "lua",
    c: "c",
    h: "c",
    cpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    mcfunction: "bash",
  };
  return table[ext];
}

/** Ouvre un fichier dans l'explorateur depuis n'importe quel composant (liste de fichiers d'un message). */
export function ouvrirDansExplorateur(chemin: string) {
  window.dispatchEvent(new CustomEvent("atelier:ouvrir-fichier", { detail: chemin }));
}
