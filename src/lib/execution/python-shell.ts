/**
 * Aide à l'usage « terminal » de la console Python (Pyodide) : la console exécute du Python, pas un
 * shell, et ne compile pas de projets. On traduit `pip install …` vers micropip quand c'est un vrai
 * paquet Python, et on explique clairement les commandes système (ls, cd…), les outils de
 * compilation (gradle, make…) et les paquets qui ne tournent pas dans le navigateur.
 */

/** Outils de compilation / build : ni des paquets Python, ni exécutables dans le navigateur. */
const OUTILS_BUILD = new Set([
  "gradle", "gradlew", "mvn", "maven", "make", "cmake", "ninja", "gcc", "g++", "clang",
  "cargo", "rustc", "go", "dotnet", "msbuild", "javac", "java", "kotlin", "kotlinc",
  "npm", "npx", "node", "yarn", "pnpm", "bun", "deno", "docker", "podman",
]);

/** Paquets qui n'ont aucun sens dans Pyodide (outils natifs, construction d'exécutables, systèmes). */
const PAQUETS_IMPOSSIBLES = new Set([
  "pyinstaller", "cx_freeze", "cx-freeze", "py2exe", "py2app", "nuitka",
  "tensorflow", "torch", "pytorch", "playwright", "selenium", "psycopg2",
  "pyaudio", "opencv-python",
]);

/** Commandes système fréquemment tapées par réflexe dans la console. */
const COMMANDES_SHELL = new Set([
  "ls", "cd", "pwd", "cat", "rm", "mkdir", "cp", "mv", "touch", "clear", "echo",
  "apt", "apt-get", "sudo", "yum", "brew", "chmod", "chown", "curl", "wget",
  "bash", "sh", "zsh", "export", "source", "git", "ping", "ssh", "nano", "vim",
]);

const CONSEIL_BUILD =
  "Pour compiler et tester un projet (Gradle, Node, Rust, Go, C…), utilise le bouton « Construire et tester » sous les fichiers d'une réponse — pas cette console, qui n'exécute que du Python.";

export interface PipResultat {
  /** Code Python transformé (les lignes `pip install` deviennent des appels micropip). */
  code: string;
  /** Paquets demandés, utilisables par micropip. */
  paquets: string[];
}

const RE_PIP = /^(\s*)!?\s*pip[23]?\s+install\s+(.+?)\s*$/;

function echapper(p: string): string {
  return `'${p.replace(/'/g, "\\'")}'`;
}

function ligneMessage(indent: string, texte: string): string {
  return `${indent}print(${echapper(texte).replace(/\n/g, " ")})`;
}

/** Remplace les lignes `pip install …` par un appel micropip, en écartant ce qui n'est pas installable. */
export function transformerPip(code: string): PipResultat {
  const paquets: string[] = [];
  const lignes = code.split("\n").map((ligne) => {
    const m = RE_PIP.exec(ligne);
    if (!m) return ligne;
    const [indent, reste] = [m[1], m[2]];
    if (/(^|\s)-r(\s|$)/.test(reste)) {
      return ligneMessage(indent, "Dans le navigateur, « pip install -r » n'est pas géré : installez les paquets un par un avec pip install nom_du_paquet.");
    }
    const demandes = reste.split(/\s+/).filter((t) => t && !t.startsWith("-"));
    const ok: string[] = [];
    const sortie: string[] = [];
    for (const d of demandes) {
      const nom = d.split(/[=<>!~]/)[0].toLowerCase();
      if (OUTILS_BUILD.has(nom)) sortie.push(ligneMessage(indent, `« ${nom} » n'est pas un paquet Python : c'est un outil de compilation. ${CONSEIL_BUILD}`));
      else if (PAQUETS_IMPOSSIBLES.has(nom)) sortie.push(ligneMessage(indent, `« ${nom} » ne peut pas s'installer ni s'exécuter dans le navigateur (outil natif / trop lourd). Utilisez-le sur votre ordinateur.`));
      else ok.push(d);
    }
    paquets.push(...ok);
    if (ok.length) sortie.push(`${indent}import micropip as __mp; await __mp.install([${ok.map(echapper).join(", ")}]); print("Installé : ${ok.join(", ")}")`);
    return sortie.join("\n") || `${indent}pass`;
  });
  return { code: lignes.join("\n"), paquets };
}

/**
 * Message d'aide quand une erreur vient visiblement d'une commande shell ou d'un outil de build
 * tapé dans la console Python. Renvoie null sinon. Quand il renvoie un texte, on remplace le
 * traceback brut par ce message (plus clair).
 */
export function indiceShell(code: string, erreur?: string): string | null {
  if (erreur && !/SyntaxError|invalid syntax|NameError/i.test(erreur)) return null;
  const premiere = code.trim().split("\n")[0]?.trim() ?? "";
  const mot = premiere.split(/\s+/)[0]?.replace(/^!/, "");
  if (!mot) return null;
  if (OUTILS_BUILD.has(mot)) return `« ${mot} » est un outil de compilation, pas du Python. ${CONSEIL_BUILD}`;
  if (COMMANDES_SHELL.has(mot)) return `« ${mot} » est une commande système (shell), mais ceci est une console Python, pas un terminal. Pour installer un paquet Python : pip install nom_du_paquet. Pour exécuter du code, écris du Python (ex. print("bonjour")).`;
  return null;
}

/**
 * Transforme une erreur micropip (paquet introuvable, pas de version compatible navigateur) en
 * message clair nommant le(s) paquet(s), au lieu d'un long traceback.
 */
export function messageMicropip(erreur: string, paquets: string[]): string | null {
  if (!paquets.length) return null;
  if (/Unsupported content type|Can't find a pure Python|Can'?t fetch metadata|No matching distribution|Couldn'?t find a pure Python|CompatibilityNotFound/i.test(erreur)) {
    const liste = paquets.join(", ");
    return `Installation impossible : « ${liste} » n'est pas disponible pour le navigateur. Soit ce n'est pas un paquet Python (ex. un outil de build), soit il n'a pas de version compatible WebAssembly. Les paquets Python purs et les plus courants (numpy, pandas, requests…) fonctionnent.`;
  }
  return null;
}
