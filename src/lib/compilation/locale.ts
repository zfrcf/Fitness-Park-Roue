/**
 * Compilation LOCALE (mode atelier) : le script de construction universel (script-construction.ts)
 * sur l'ordinateur de l'utilisateur — `gradle build` avec le JDK et Gradle installés par l'atelier
 * (ATELIER_JAVA_HOME, ATELIER_GRADLE), Node de l'application elle-même, Python du venv de l'atelier
 * (ATELIER_PYTHON), et les compilateurs présents sur la machine pour les autres langages.
 *
 * - Un espace de travail par conversation (compilations/espaces/<conversation>) : les fichiers du
 *   projet y sont synchronisés à chaque compilation, ce qui garde les caches de Gradle et de Loom
 *   (recompilations rapides). Les compilations d'un même espace passent l'une après l'autre.
 * - Les fichiers produits (.atelier-sortie/) sont copiés dans compilations/jars/<id>/ : chaque
 *   compilation garde les siens.
 * - L'état est écrit en base au fil de l'eau ; le suivi (rafraichirCompilation) se contente de le
 *   relire, et marque en erreur une compilation orpheline après un redémarrage de l'application.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { majCompilation, type Compilation } from "@/lib/db/compilations";
import { SCRIPT_CONSTRUCTION } from "./script-construction";
import { CHEMIN_SCRIPT, DOSSIER_SORTIE, nomProduit } from "./sortie";

/** Dossiers jamais synchronisés ni supprimés dans un espace (sorties, caches, dépendances installées). */
const IGNORES = new Set([
  ".gradle", "build", "run", "out", ".atelier", ".kotlin",
  "node_modules", "target", "dist", "bin", "obj", "__pycache__", ".venv", ".pytest_cache",
  DOSSIER_SORTIE, ".atelier-deps", ".atelier-build",
]);
const DELAI_MAX_MS = 30 * 60_000;
const LIGNES_MAX = 4000;

export function dossierCompilations(): string {
  return process.env.ATELIER_COMPILATIONS_DIR || path.join(os.homedir(), ".local", "share", "atelier", "compilations");
}

export function brancheLocale(id: string): string {
  return `local/${id}`;
}

export function estLocale(c: Pick<Compilation, "branche">): boolean {
  return c.branche.startsWith("local/");
}

export function dossierEspace(conversationId: string): string {
  const lisible = conversationId.replace(/[^\w-]+/g, "-").slice(0, 40) || "conversation";
  const empreinte = createHash("sha256").update(conversationId).digest("hex").slice(0, 8);
  return path.join(dossierCompilations(), "espaces", `${lisible}-${empreinte}`);
}

export function cheminJarLocal(c: Pick<Compilation, "id" | "jarNom">): string | null {
  if (!c.jarNom || /[\\/]/.test(c.jarNom)) return null;
  return path.join(dossierProduits(c.id), c.jarNom);
}

declare global {
  var __compilationsLocales: { enCours: Map<string, ChildProcess>; enFile: Set<string>; files: Map<string, Promise<void>> } | undefined;
}
const registre = (globalThis.__compilationsLocales ??= { enCours: new Map(), enFile: new Set(), files: new Map() });

/** La compilation est-elle connue de ce processus (en file ou en cours) ? */
export function compilationVivante(id: string): boolean {
  return registre.enFile.has(id) || registre.enCours.has(id);
}

/** Écrit les fichiers du projet dans l'espace et retire ceux qui n'en font plus partie. */
export async function synchroniserEspace(dossier: string, fichiers: Array<{ chemin: string; contenu: string }>): Promise<void> {
  const racine = path.resolve(dossier);
  await fs.mkdir(racine, { recursive: true });
  const voulus = new Set<string>();
  for (const f of fichiers) {
    const cible = path.resolve(racine, f.chemin);
    // Les chemins ont déjà été validés (validerFichiers) ; on revérifie le confinement par prudence.
    if (!cible.startsWith(racine + path.sep)) throw new Error(`chemin hors de l'espace : ${f.chemin}`);
    voulus.add(path.relative(racine, cible));
    await fs.mkdir(path.dirname(cible), { recursive: true });
    let actuel: string | null = null;
    try {
      actuel = await fs.readFile(cible, "utf8");
    } catch {
      actuel = null;
    }
    // On ne réécrit pas un fichier identique : Gradle garde alors sa compilation incrémentale.
    if (actuel !== f.contenu) await fs.writeFile(cible, f.contenu, "utf8");
  }
  const parcourir = async (rel: string): Promise<void> => {
    const entrees = await fs.readdir(path.join(racine, rel), { withFileTypes: true });
    for (const e of entrees) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (!rel && IGNORES.has(e.name)) continue;
      if (e.isDirectory()) {
        await parcourir(r);
        if ((await fs.readdir(path.join(racine, r))).length === 0) await fs.rmdir(path.join(racine, r));
      } else if (!voulus.has(r)) {
        await fs.rm(path.join(racine, r), { force: true });
      }
    }
  };
  await parcourir("");
}

/** Chemins relatifs (avec « / ») de tous les fichiers d'un dossier. */
export async function listerFichiers(dossier: string, rel = ""): Promise<string[]> {
  let entrees;
  try {
    entrees = await fs.readdir(path.join(dossier, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entrees) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listerFichiers(dossier, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

export function dossierProduits(id: string): string {
  return path.join(dossierCompilations(), "jars", id);
}

export interface OptionsExecution {
  gradle?: string;
  javaHome?: string;
  delaiMaxMs?: number;
  resumer: (journal: string) => string;
}

/**
 * Met la compilation en file pour son espace et la lance dès que le précédent build de cet
 * espace est terminé. Ne bloque pas : l'état évolue en base.
 */
export function lancerCompilationLocale(c: Compilation, fichiers: Array<{ chemin: string; contenu: string }>, options: OptionsExecution): Promise<void> {
  const espace = dossierEspace(c.conversationId);
  registre.enFile.add(c.id);
  const precedente = registre.files.get(espace) ?? Promise.resolve();
  const suivante = precedente
    .catch(() => {})
    .then(() => executer(c, espace, fichiers, options))
    .catch(async (e: unknown) => {
      await majCompilation(c.id, { statut: "erreur", erreur: e instanceof Error ? e.message : "échec de la compilation locale" }).catch(() => null);
    })
    .finally(() => {
      registre.enFile.delete(c.id);
      registre.enCours.delete(c.id);
      if (registre.files.get(espace) === suivante) registre.files.delete(espace);
    });
  registre.files.set(espace, suivante);
  return suivante;
}

async function executer(c: Compilation, espace: string, fichiers: Array<{ chemin: string; contenu: string }>, o: OptionsExecution): Promise<void> {
  await synchroniserEspace(espace, fichiers);
  await majCompilation(c.id, { statut: "en_cours", brancheUrl: null });
  const env: NodeJS.ProcessEnv = { ...process.env };
  const javaHome = o.javaHome ?? process.env.ATELIER_JAVA_HOME;
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${env.PATH ?? ""}`;
  }
  if (o.gradle) env.ATELIER_GRADLE = o.gradle;
  // Node : celui qui fait tourner l'application (toujours présent, même sans Node installé).
  env.ATELIER_NODE_BIN = path.dirname(process.execPath);
  delete env.ATELIER_CI;
  const script = path.join(espace, CHEMIN_SCRIPT);
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.writeFile(script, SCRIPT_CONSTRUCTION, { mode: 0o755 });
  const lignes: string[] = [];
  const ajouter = (morceau: Buffer) => {
    for (const l of morceau.toString("utf8").split(/\r?\n/)) {
      if (!l) continue;
      lignes.push(l);
      if (lignes.length > LIGNES_MAX) lignes.splice(0, lignes.length - LIGNES_MAX);
    }
  };
  const code = await new Promise<number>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn("bash", [script], { cwd: espace, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      lignes.push(`Impossible de lancer la construction (bash) : ${e instanceof Error ? e.message : e}`);
      resolve(127);
      return;
    }
    registre.enFile.delete(c.id);
    registre.enCours.set(c.id, proc);
    const minuteur = setTimeout(() => {
      lignes.push(`[atelier] compilation arrêtée après ${Math.round((o.delaiMaxMs ?? DELAI_MAX_MS) / 60_000)} min`);
      proc.kill("SIGKILL");
    }, o.delaiMaxMs ?? DELAI_MAX_MS);
    proc.stdout?.on("data", ajouter);
    proc.stderr?.on("data", ajouter);
    proc.on("error", (e) => {
      lignes.push(`Impossible de lancer la construction (bash) : ${e.message}.`);
    });
    proc.on("close", (code) => {
      clearTimeout(minuteur);
      resolve(code ?? 1);
    });
  });
  const journal = lignes.join("\n");
  if (code === 3 || code === 4) {
    // Outil absent ou projet non reconnu : ce n'est pas une erreur du code, inutile de « corriger ».
    const raison = lignes.find((l) => /OUTIL ABSENT|NON RECONNU/.test(l)) ?? "construction impossible sur cette machine";
    // Sans journal : le moteur des tâches s'arrête au lieu de « corriger » un code qui n'y est pour rien.
    await majCompilation(c.id, { statut: "erreur", journal: null, erreur: raison });
    return;
  }
  if (code !== 0) {
    await majCompilation(c.id, { statut: "echouee", journal: o.resumer(journal) || journal.slice(-6000), erreur: null });
    return;
  }
  const sortie = path.join(espace, DOSSIER_SORTIE);
  const produits = await listerFichiers(sortie);
  const destination = dossierProduits(c.id);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(sortie, destination, { recursive: true }).catch(() => fs.mkdir(destination, { recursive: true }));
  const jarNom = nomProduit(produits, c.nom ?? "projet");
  await majCompilation(c.id, { statut: "reussie", jarNom, journal: lignes.slice(-15).join("\n"), erreur: null });
}

/** Suivi : une compilation « en cours » inconnue de ce processus a été interrompue par un redémarrage. */
export async function rafraichirLocale(c: Compilation): Promise<Compilation> {
  if ((c.statut === "en_attente" || c.statut === "en_cours") && !compilationVivante(c.id)) {
    return (await majCompilation(c.id, { statut: "erreur", erreur: "Compilation interrompue (application redémarrée) : relancez-la." })) ?? c;
  }
  return c;
}
