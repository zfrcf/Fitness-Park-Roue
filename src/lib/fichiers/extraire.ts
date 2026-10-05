/**
 * Extraction des fichiers contenus dans une réponse Markdown.
 * Conventions reconnues (ligne d'ouverture du bloc de code ou ligne juste avant) :
 *   ```java src/main/java/com/exemple/Mod.java
 *   ```json title="pack.mcmeta"      ```yaml:config/app.yml
 *   **src/x.java** / `src/x.java` / ### src/x.java / Fichier : src/x.java   (ligne précédant le bloc)
 */
export interface FichierGenere {
  chemin: string;
  langue?: string;
  contenu: string;
}

const RE_CHEMIN = /^[\w@.-][\w@./-]*\.[A-Za-z0-9]{1,12}$|^(?:[\w@.-]+\/)+[\w@.-]+$|^(?:Dockerfile|Makefile|LICENSE|gradlew|\.gitignore|\.env\.example)$/;

function nettoyerChemin(brut: string): string | null {
  let c = brut.trim().replace(/^["'`«]+|["'`»]+$/g, "").replace(/\\/g, "/");
  c = c.replace(/^(fichier|file)\s*:\s*/i, "").trim();
  if (c.startsWith("/")) return null; // chemin absolu refusé
  c = c.replace(/^\.\//, "");
  if (!c || c.length > 200 || c.includes("..")) return null;
  if (/\s/.test(c)) return null;
  return RE_CHEMIN.test(c) ? c : null;
}

/** Interprète la ligne d'ouverture d'un bloc : « java src/x.java », « json title="x" », « yaml:config/x.yml ». */
export function cheminDepuisInfo(info: string): { langue?: string; chemin?: string } {
  const t = info.trim();
  if (!t) return {};
  const titre = /(?:title|filename|file|path)=["']([^"']+)["']/i.exec(t);
  if (titre) return { langue: t.split(/[\s:]/)[0] || undefined, chemin: nettoyerChemin(titre[1]) ?? undefined };
  const deuxPoints = /^([\w+#-]+):(\S+)$/.exec(t);
  if (deuxPoints) return { langue: deuxPoints[1], chemin: nettoyerChemin(deuxPoints[2]) ?? undefined };
  // On ignore une annotation entre parenthèses (« ```groovy build.gradle (corrigé) »). (#38)
  const parties = t.split(/\s+/).filter((p) => !/^\(.*\)$/.test(p));
  if (parties.length >= 2) {
    const chemin = nettoyerChemin(parties[parties.length - 1]);
    if (chemin) return { langue: parties[0], chemin };
  }
  // Cas « ```src/x.java » (le chemin seul en guise de langue)
  if (parties.length === 1) {
    const chemin = nettoyerChemin(parties[0]);
    if (chemin && chemin.includes("/")) return { chemin };
    if (chemin && /\.[a-z0-9]+$/i.test(chemin) && !/^(js|ts|py|sh|md|json|yaml|yml|xml|html|css|java|kt|c|cpp|cs|go|rs|rb|php|sql|toml|ini|txt|tsx|jsx|mjs|cjs)$/i.test(chemin)) return { chemin };
  }
  return { langue: parties[0] };
}

/** Repère un nom de fichier dans la ligne non vide précédant un bloc. */
function cheminDepuisLigne(ligne: string): string | null {
  const l = ligne
    .trim()
    .replace(/^#{1,6}\s*/, "") // titre markdown
    .replace(/^[-*]\s+/, "") // puce
    .replace(/^\d+[.)]\s*/, "") // énumération « 1. », « 2) » (#38)
    .replace(/:$/, "");
  // Marqueurs **…**, `…` (éventuellement combinés : « **Fichier : `x`** ») et annotation « (corrigé) ». (#38)
  const m = /^[*`\s]*(?:fichier|file)?\s*:?\s*[*`\s]*([^\s*`]+)[*`\s]*(?:\(.*\))?$/i.exec(l);
  if (!m) return null;
  return nettoyerChemin(m[1]);
}

interface BlocFichier extends FichierGenere {
  /** Indices de ligne du bloc (ouverture et clôture incluses). */
  debut: number;
  fin: number;
  /** Bloc de modification partielle (```modif chemin) plutôt qu'un fichier entier. */
  modification: boolean;
}

/** Langues qui désignent un bloc de modification partielle d'un fichier existant. */
const RE_LANGUE_MODIF = /^(modif|modification|edit|patch)$/i;

/** Une modification partielle : des paires « chercher → remplacer » appliquées à un fichier du projet. */
export interface ModificationFichier {
  chemin: string;
  remplacements: Array<{ chercher: string; remplacer: string }>;
}

const RE_DEBUT_CHERCHER = /^<{4,}\s*(?:CHERCHER|SEARCH|ANCIEN|OLD)\s*$/i;
const RE_SEPARATEUR = /^={4,}\s*$/;
const RE_FIN_REMPLACER = /^>{4,}\s*(?:REMPLACER|REPLACE|NOUVEAU|NEW)\s*$/i;

/** Lit les paires CHERCHER / REMPLACER d'un bloc de modification. */
export function lirePairesModification(corps: string): Array<{ chercher: string; remplacer: string }> {
  const paires: Array<{ chercher: string; remplacer: string }> = [];
  let etat: "hors" | "chercher" | "remplacer" = "hors";
  let chercher: string[] = [];
  let remplacer: string[] = [];
  for (const ligne of corps.split("\n")) {
    if (etat === "hors") {
      if (RE_DEBUT_CHERCHER.test(ligne)) {
        etat = "chercher";
        chercher = [];
        remplacer = [];
      }
    } else if (etat === "chercher") {
      if (RE_SEPARATEUR.test(ligne)) etat = "remplacer";
      else chercher.push(ligne);
    } else if (RE_FIN_REMPLACER.test(ligne)) {
      paires.push({ chercher: chercher.join("\n"), remplacer: remplacer.join("\n") });
      etat = "hors";
    } else remplacer.push(ligne);
  }
  return paires;
}

/** Parcourt les blocs de code et renvoie ceux qui désignent un fichier. */
function analyserBlocs(lignes: string[]): BlocFichier[] {
  const blocs: BlocFichier[] = [];
  let i = 0;
  while (i < lignes.length) {
    const ouverture = /^\s*(`{3,}|~{3,})(.*)$/.exec(lignes[i]);
    if (!ouverture) {
      i++;
      continue;
    }
    const cloture = ouverture[1];
    const { langue, chemin: cheminInfo } = cheminDepuisInfo(ouverture[2]);
    // La clôture est une ligne de fences NUE (rien après) du même caractère et d'au moins la même
    // longueur : une fence interne avec langue (```bash dans un README) n'est pas prise pour une
    // clôture, et une fence externe plus longue (````) englobe les fences internes ```. (#38)
    const estCloture = (ligne: string): boolean => {
      const m = /^\s*(`{3,}|~{3,})\s*$/.exec(ligne);
      return !!m && m[1][0] === cloture[0] && m[1].length >= cloture.length;
    };
    let j = i + 1;
    const corps: string[] = [];
    while (j < lignes.length && !estCloture(lignes[j])) {
      corps.push(lignes[j]);
      j++;
    }
    let chemin = cheminInfo ?? null;
    if (!chemin) {
      // Ligne précédente non vide.
      let k = i - 1;
      while (k >= 0 && !lignes[k].trim()) k--;
      if (k >= 0) chemin = cheminDepuisLigne(lignes[k]);
    }
    if (!chemin && corps.length) {
      // Première ligne du bloc : commentaire avec un chemin (// src/x.java, # config.yml, <!-- index.html -->)
      const m = /^\s*(?:\/\/|#|--|<!--|\/\*)\s*(?:fichier|file)?\s*:?\s*([^\s]+?)\s*(?:-->|\*\/)?\s*$/i.exec(corps[0]);
      if (m) {
        const c = nettoyerChemin(m[1]);
        if (c && c.includes("/")) {
          chemin = c;
          corps.shift();
        }
      }
    }
    if (chemin && corps.length > 0) {
      const modification = !!langue && RE_LANGUE_MODIF.test(langue);
      blocs.push({ chemin, langue, contenu: corps.join("\n").replace(/\s+$/, "") + "\n", debut: i, fin: Math.min(j, lignes.length - 1), modification });
    }
    i = j + 1;
  }
  return blocs;
}

export function extraireFichiers(markdown: string): FichierGenere[] {
  const fichiers = new Map<string, FichierGenere>();
  for (const b of analyserBlocs(markdown.split("\n"))) {
    if (b.modification) continue;
    fichiers.set(b.chemin, { chemin: b.chemin, langue: b.langue, contenu: b.contenu });
  }
  return [...fichiers.values()];
}

/**
 * Modifications partielles d'une réponse (blocs ```modif chemin), dans l'ordre. Un bloc sans
 * paire valide est renvoyé avec une liste vide : l'appelant le signale comme mal formé.
 */
export function extraireModifications(markdown: string): ModificationFichier[] {
  const out: ModificationFichier[] = [];
  for (const b of analyserBlocs(markdown.split("\n"))) {
    if (!b.modification) continue;
    out.push({ chemin: b.chemin, remplacements: lirePairesModification(b.contenu) });
  }
  return out;
}

/**
 * Remplace les blocs de code des fichiers désignés par un texte court (fourni par `remplacant`,
 * null pour conserver le bloc). Sert à ne pas renvoyer deux fois le même fichier au modèle.
 */
export function remplacerBlocsFichiers(markdown: string, remplacant: (chemin: string, modification: boolean) => string | null): string {
  const lignes = markdown.split("\n");
  const blocs = analyserBlocs(lignes);
  if (!blocs.length) return markdown;
  const sortie: string[] = [];
  let i = 0;
  for (const b of blocs) {
    const r = remplacant(b.chemin, b.modification);
    if (r === null) continue;
    sortie.push(...lignes.slice(i, b.debut), r);
    i = b.fin + 1;
  }
  sortie.push(...lignes.slice(i));
  return sortie.join("\n");
}

/** Un projet Gradle (mod Minecraft, application Java/Kotlin) est reconnaissable à ses fichiers de build. */
export function estProjetGradle(fichiers: FichierGenere[]): boolean {
  return fichiers.some((f) => /^(build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/.test(f.chemin));
}

export function nomArchive(fichiers: FichierGenere[], defaut = "fichiers"): string {
  const fmj = fichiers.find((f) => /fabric\.mod\.json$/.test(f.chemin));
  if (fmj) {
    try {
      const j = JSON.parse(fmj.contenu) as { id?: string };
      if (j.id) return j.id;
    } catch {
      /* ignoré */
    }
  }
  const toml = fichiers.find((f) => /neoforge\.mods\.toml$|mods\.toml$/.test(f.chemin));
  if (toml) {
    const m = /modId\s*=\s*"([^"]+)"/.exec(toml.contenu);
    if (m) return m[1];
  }
  const pkg = fichiers.find((f) => f.chemin === "package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg.contenu) as { name?: string };
      if (j.name) return j.name.replace(/[^\w.-]+/g, "-");
    } catch {
      /* ignoré */
    }
  }
  return defaut;
}
