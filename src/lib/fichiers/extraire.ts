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
  const parties = t.split(/\s+/);
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
  const l = ligne.trim().replace(/^#{1,6}\s*/, "").replace(/^[-*]\s+/, "").replace(/:$/, "");
  const m = /^(?:\*\*|`)?(?:fichier|file)?\s*:?\s*(?:\*\*|`)?\s*([^\s*`]+)\s*(?:\*\*|`)?\s*(?:\(.*\))?$/i.exec(l);
  if (!m) return null;
  return nettoyerChemin(m[1]);
}

export function extraireFichiers(markdown: string): FichierGenere[] {
  const lignes = markdown.split("\n");
  const fichiers = new Map<string, FichierGenere>();
  let i = 0;
  while (i < lignes.length) {
    const ouverture = /^\s*(`{3,}|~{3,})(.*)$/.exec(lignes[i]);
    if (!ouverture) {
      i++;
      continue;
    }
    const cloture = ouverture[1];
    const { langue, chemin: cheminInfo } = cheminDepuisInfo(ouverture[2]);
    let j = i + 1;
    const corps: string[] = [];
    while (j < lignes.length && !lignes[j].trim().startsWith(cloture)) {
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
      fichiers.set(chemin, { chemin, langue, contenu: corps.join("\n").replace(/\s+$/, "") + "\n" });
    }
    i = j + 1;
  }
  return [...fichiers.values()];
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
