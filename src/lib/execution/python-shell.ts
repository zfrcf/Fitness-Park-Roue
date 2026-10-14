/**
 * Aide à l'usage « terminal » de la console Python (Pyodide) : la console exécute du Python, pas un
 * shell, et ne compile pas de projets. Toutes les commandes pip sont traduites vers le module pip de
 * la console (`pip-console.ts`, via micropip), et on explique clairement les commandes système
 * (ls, cd…) et les outils de compilation (gradle, make…).
 */

/** Outils de compilation / build : ni des paquets Python, ni exécutables dans le navigateur. */
const OUTILS_BUILD = new Set([
  "gradle", "gradlew", "mvn", "maven", "make", "cmake", "ninja", "gcc", "g++", "clang",
  "cargo", "rustc", "go", "dotnet", "msbuild", "javac", "java", "kotlin", "kotlinc",
  "npm", "npx", "node", "yarn", "pnpm", "bun", "deno", "docker", "podman",
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
  /** Code Python transformé : chaque commande pip devient un appel au module `atelier_pip`. */
  code: string;
  /** Vrai si au moins une commande pip a été trouvée (il faut alors charger micropip). */
  pip: boolean;
}

/** Sous-commandes de pip : distinguent `pip install x` de code Python comme `pip = 3`. */
const SOUS_COMMANDES_PIP = new Set([
  "install", "uninstall", "remove", "list", "freeze", "show", "check", "help", "download", "wheel",
  "cache", "config", "debug", "hash", "search", "index", "inspect", "completion", "lock",
]);

// [indentation][! ou %][python -m | python3 -m | py -m]pip[3[.12]][reste]
const RE_PIP = /^(\s*)([!%]\s*)?((?:python3?(?:\.\d+)?|py)\s+-m\s+)?pip(?:3(?:\.\d+)?)?(?=\s|$)(.*)$/;

/** Reconnaît une ligne de commande pip (toutes les formes usuelles), sinon null. */
export function ligneCommandePip(ligne: string): { indent: string; args: string } | null {
  const m = RE_PIP.exec(ligne);
  if (!m) return null;
  const [, indent, prefixe, module, reste] = m;
  const args = reste.trim();
  const premier = args.split(/\s+/)[0] ?? "";
  // Sans « ! », « % » ni « python -m », on exige une vraie sous-commande ou option pour ne pas
  // détourner du Python (« pip = 3 », « pip -= 1 », « pip.x »).
  const explicite = Boolean(prefixe || module);
  if (!explicite && args && !SOUS_COMMANDES_PIP.has(premier.toLowerCase()) && !/^--?[a-zA-Z]/.test(premier)) return null;
  return { indent, args };
}

/**
 * Délimiteur de chaîne triple (""" ou ''') encore ouvert à la fin de la ligne : une ligne
 * « pip install … » écrite DANS un texte (docstring, README…) ne doit pas être réécrite.
 */
function chaineTripleOuverte(ligne: string, ouverte: string | null): string | null {
  let i = 0;
  while (i < ligne.length) {
    if (ouverte) {
      const j = ligne.indexOf(ouverte, i);
      if (j < 0) return ouverte;
      i = j + 3;
      ouverte = null;
      continue;
    }
    const c = ligne[i];
    if (c === "#") return null;
    if (ligne.startsWith('"""', i) || ligne.startsWith("'''", i)) {
      ouverte = ligne.slice(i, i + 3);
      i += 3;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < ligne.length && ligne[k] !== c) k += ligne[k] === "\\" ? 2 : 1;
      i = k + 1;
      continue;
    }
    i++;
  }
  return ouverte;
}

// [indentation][! ou %](python | python3 | python3.12 | py | %run)[reste]
const RE_PYTHON = /^(\s*)(?:([!%])\s*)?(python3?(?:\.\d+)?|py|run)(?=\s|$)(.*)$/;

/**
 * Reconnaît « python fichier.py args », « python -c "…" », « python -m module », « %run fichier.py ».
 * Sans « ! »/« % », il faut un fichier .py ou une option : « python = 3 » reste du Python.
 */
export function ligneCommandePython(ligne: string): { indent: string; args: string } | null {
  const m = RE_PYTHON.exec(ligne);
  if (!m) return null;
  const [, indent, prefixe, commande, reste] = m;
  const args = reste.trim();
  if (commande === "run" && prefixe !== "%") return null;
  const premier = args.split(/\s+/)[0] ?? "";
  if (!prefixe && commande !== "run" && args && !/\.pyw?$/i.test(premier.replace(/^["']|["']$/g, "")) && !/^-[a-zA-Z-]/.test(premier)) return null;
  return { indent, args };
}

export interface CommandesResultat extends PipResultat {
  /** Vrai si une ligne lance un programme (« python fichier.py »…). */
  python: boolean;
}

/**
 * Remplace les lignes de commande de la console par des appels Python : pip (micropip) et lancement
 * de programmes (`atelier_run.lancer`). Le reste du code est laissé intact.
 */
export function transformerCommandes(code: string): CommandesResultat {
  let pip = false;
  let python = false;
  let ouverte: string | null = null;
  const lignes = code.split("\n").map((ligne) => {
    const dansTexte = ouverte !== null;
    ouverte = chaineTripleOuverte(ligne, ouverte);
    if (dansTexte) return ligne;
    const p = ligneCommandePip(ligne);
    if (p) {
      pip = true;
      return `${p.indent}await __import__("atelier_pip").pip(${JSON.stringify(p.args)})`;
    }
    const l = ligneCommandePython(ligne);
    if (l) {
      python = true;
      return `${l.indent}await __import__("atelier_run").lancer(${JSON.stringify(l.args)})`;
    }
    return ligne;
  });
  return { code: lignes.join("\n"), pip, python };
}

/** Commandes pip seulement (compatibilité). */
export function transformerPip(code: string): PipResultat {
  const r = transformerCommandes(code);
  return { code: r.code, pip: r.pip };
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
