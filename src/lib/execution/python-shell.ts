/**
 * Aide à l'usage « terminal » de la console Python (Pyodide) : la console exécute du Python, pas un
 * shell. On traduit `pip install …` vers micropip, et on explique clairement les commandes système
 * (ls, cd…) ou les paquets qui ne peuvent pas tourner dans le navigateur.
 */

/** Paquets qui n'ont aucun sens dans Pyodide (outils natifs, construction d'exécutables, systèmes). */
const PAQUETS_IMPOSSIBLES = new Set([
  "pyinstaller",
  "cx_freeze",
  "cx-freeze",
  "py2exe",
  "py2app",
  "nuitka",
  "tensorflow",
  "torch",
  "pytorch",
  "playwright",
  "selenium",
  "psycopg2",
  "pyaudio",
  "opencv-python",
]);

/** Commandes système fréquemment tapées par réflexe dans la console. */
const COMMANDES_SHELL = new Set([
  "ls", "cd", "pwd", "cat", "rm", "mkdir", "cp", "mv", "touch", "clear", "echo",
  "apt", "apt-get", "sudo", "yum", "brew", "npm", "npx", "node", "yarn", "pnpm",
  "git", "chmod", "chown", "curl", "wget", "bash", "sh", "zsh", "export", "source",
  "gcc", "g++", "make", "java", "javac", "gradle", "mvn", "docker",
]);

export interface PipResultat {
  /** Code Python transformé (les lignes `pip install` deviennent des appels micropip). */
  code: string;
  /** Paquets demandés, utilisables par micropip. */
  paquets: string[];
  /** Paquets demandés mais impossibles dans le navigateur. */
  impossibles: string[];
}

const RE_PIP = /^(\s*)!?\s*pip[23]?\s+install\s+(.+?)\s*$/;

function echapper(p: string): string {
  return `'${p.replace(/'/g, "\\'")}'`;
}

/**
 * Remplace les lignes `pip install …` par un appel micropip. Ignore les options (-U…), signale
 * `-r requirements.txt` (non géré) et sépare les paquets impossibles dans le navigateur.
 */
export function transformerPip(code: string): PipResultat {
  const paquets: string[] = [];
  const impossibles: string[] = [];
  const lignes = code.split("\n").map((ligne) => {
    const m = RE_PIP.exec(ligne);
    if (!m) return ligne;
    const [indent, reste] = [m[1], m[2]];
    if (/(^|\s)-r(\s|$)/.test(reste)) {
      return `${indent}print("Dans le navigateur, « pip install -r » n'est pas géré : installez les paquets un par un avec pip install nom_du_paquet.")`;
    }
    const demandes = reste
      .split(/\s+/)
      .filter((t) => t && !t.startsWith("-"));
    const ok: string[] = [];
    for (const d of demandes) {
      const nom = d.split(/[=<>!~]/)[0].toLowerCase();
      if (PAQUETS_IMPOSSIBLES.has(nom)) impossibles.push(nom);
      else ok.push(d);
    }
    paquets.push(...ok);
    const lignesOut: string[] = [];
    for (const imp of demandes.filter((d) => PAQUETS_IMPOSSIBLES.has(d.split(/[=<>!~]/)[0].toLowerCase())))
      lignesOut.push(`${indent}print("« ${imp} » ne peut pas s'installer ni s'exécuter dans le navigateur (outil natif / trop lourd). Utilisez-le sur votre ordinateur.")`);
    if (ok.length) lignesOut.push(`${indent}import micropip as __mp; await __mp.install([${ok.map(echapper).join(", ")}]); print("Installé : ${ok.join(", ")}")`);
    return lignesOut.join("\n") || `${indent}pass`;
  });
  return { code: lignes.join("\n"), paquets, impossibles };
}

/**
 * Message d'aide quand une erreur vient visiblement d'une commande shell tapée dans la console
 * Python (ex. `ls`, `cd`). Renvoie null si ce n'est pas le cas.
 */
export function indiceShell(code: string, erreur?: string): string | null {
  if (erreur && !/SyntaxError|invalid syntax|NameError/i.test(erreur)) return null;
  const premiere = code.trim().split("\n")[0]?.trim() ?? "";
  const mot = premiere.split(/\s+/)[0]?.replace(/^!/, "");
  if (!mot || !COMMANDES_SHELL.has(mot)) return null;
  return `« ${mot} » est une commande système (shell), mais ceci est une console Python, pas un terminal. Pour installer un paquet Python, tapez : pip install nom_du_paquet. Pour exécuter du code, écrivez du Python (ex. print("bonjour")).`;
}
