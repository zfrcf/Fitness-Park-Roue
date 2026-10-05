/**
 * Compilation d'un projet via GitHub Actions :
 *  1) le projet est poussé (commit orphelin) sur une branche compilation/<id>, avec le workflow ;
 *  2) le workflow « compilation » tourne ; on suit son état par l'API ;
 *  3) le jar est récupéré depuis l'artefact « jar », le journal depuis « journal ».
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FichierGenere } from "@/lib/fichiers/extraire";
import { depotCompilation, github } from "./api";

export const MAX_FICHIERS = 400;
export const MAX_OCTETS = 3 * 1024 * 1024;
const RE_CHEMIN_SUR = /^(?!\.{1,2}(\/|$))(?!\/)(?!.*\/\.\.(\/|$))[\w@.+ -][\w@.+\/ -]*$/;
/** Chemins que la chaîne fournit elle-même : jamais envoyés, retirés sans refuser le projet. */
export const RE_CHEMIN_RESERVE = /^\.github\/|^vercel\.json$|(^|\/)gradlew(\.bat)?$|(^|\/)gradle-wrapper\.(jar|properties)$/;

/** Retire les fichiers réservés (workflow, wrapper Gradle) d'une liste. */
export function retirerReserves(fichiers: FichierGenere[]): FichierGenere[] {
  return fichiers.filter((f) => !RE_CHEMIN_RESERVE.test(f.chemin));
}

/**
 * Valide le projet APRÈS retrait des fichiers réservés : ceux-ci (`.github/…`, gradlew,
 * gradle-wrapper) sont fournis par la chaîne, donc ignorés silencieusement plutôt que de
 * refuser tout le projet. On ne valide que les fichiers réellement envoyés.
 */
export function validerFichiers(fichiersBruts: FichierGenere[]): string[] {
  const fichiers = retirerReserves(fichiersBruts);
  const erreurs: string[] = [];
  if (!fichiers.length) erreurs.push("aucun fichier à compiler");
  if (fichiers.length > MAX_FICHIERS) erreurs.push(`trop de fichiers (${fichiers.length} > ${MAX_FICHIERS})`);
  let total = 0;
  const vus = new Set<string>();
  for (const f of fichiers) {
    total += Buffer.byteLength(f.contenu, "utf8");
    // Segments vides (//), « . », « .. » et dossier .git sont refusés en plus du filtre général. (#44)
    const segments = f.chemin.split("/");
    const segmentInvalide = segments.some((s) => s === "" || s === "." || s === "..") || /(^|\/)\.git(\/|$)/i.test(f.chemin);
    if (!RE_CHEMIN_SUR.test(f.chemin) || f.chemin.includes("\\") || f.chemin.length > 240 || segmentInvalide) erreurs.push(`chemin refusé : ${f.chemin}`);
    if (vus.has(f.chemin)) erreurs.push(`chemin en double : ${f.chemin}`);
    vus.add(f.chemin);
  }
  if (total > MAX_OCTETS) erreurs.push(`projet trop volumineux (${Math.round(total / 1024)} Ko > ${MAX_OCTETS / 1024} Ko)`);
  if (!fichiers.some((f) => /^(build\.gradle(\.kts)?)$/.test(f.chemin))) erreurs.push("build.gradle (ou build.gradle.kts) manquant à la racine");
  return erreurs;
}

let workflowCache: string | undefined;
export function contenuWorkflow(): string {
  if (!workflowCache) workflowCache = readFileSync(path.join(process.cwd(), ".github/workflows/compiler.yml"), "utf8");
  return workflowCache;
}

export function nomBranche(id: string) {
  return `compilation/${id}`;
}

interface Tree {
  sha: string;
}
interface Commit {
  sha: string;
}

/** Crée la branche compilation/<id> avec un commit orphelin contenant le projet et le workflow. */
export async function creerBranche(id: string, fichiers: FichierGenere[], nom: string): Promise<{ branche: string; sha: string; url: string }> {
  const { proprietaire, nom: depot } = depotCompilation();
  const base = `/repos/${proprietaire}/${depot}`;
  // On retire les fichiers réservés produits par le modèle (sinon collision avec le workflow ajouté ci-dessous).
  const tous = [
    ...retirerReserves(fichiers),
    // Empêche Vercel de déployer la branche de compilation (sinon déploiement preview en échec, quota consommé).
    { chemin: "vercel.json", contenu: JSON.stringify({ git: { deploymentEnabled: false } }) + "\n" },
    { chemin: ".github/workflows/compiler.yml", contenu: contenuWorkflow() },
  ];
  // Contenu en ligne dans l'arbre : un seul appel, au lieu d'un POST /git/blobs par fichier (sinon
  // la limite secondaire de GitHub — ~80 requêtes créatrices/min — bloque les gros projets). (#21)
  const arbre = tous.map((fi) => ({ path: fi.chemin, mode: "100644" as const, type: "blob" as const, content: fi.contenu }));
  const tree = await github<Tree>(`${base}/git/trees`, { method: "POST", body: JSON.stringify({ tree: arbre }) });
  const commit = await github<Commit>(`${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Compilation ${id} : ${nom}`,
      tree: tree.sha,
      author: { name: "Chat IA", email: "chat-ia@users.noreply.github.com", date: new Date().toISOString() },
    }),
  });
  const branche = nomBranche(id);
  await github(`${base}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branche}`, sha: commit.sha }) });
  return { branche, sha: commit.sha, url: `https://github.com/${proprietaire}/${depot}/tree/${branche}` };
}

export async function supprimerBranche(id: string): Promise<void> {
  const { proprietaire, nom } = depotCompilation();
  await github(`/repos/${proprietaire}/${nom}/git/refs/heads/${nomBranche(id)}`, { method: "DELETE" }).catch(() => {});
}

export type StatutRun = "en_attente" | "en_cours" | "reussie" | "echouee";

export interface Run {
  id: number;
  statut: StatutRun;
  url: string;
  conclusion: string | null;
}

export function mapperRun(r: { id: number; status: string; conclusion: string | null; html_url: string }): Run {
  let statut: StatutRun;
  if (r.status === "completed") statut = r.conclusion === "success" ? "reussie" : "echouee";
  else if (r.status === "queued" || r.status === "waiting" || r.status === "pending" || r.status === "requested") statut = "en_attente";
  else statut = "en_cours";
  return { id: r.id, statut, url: r.html_url, conclusion: r.conclusion };
}

export async function trouverRun(id: string): Promise<Run | null> {
  const { proprietaire, nom } = depotCompilation();
  const j = await github<{ workflow_runs: Array<{ id: number; status: string; conclusion: string | null; html_url: string }> }>(
    `/repos/${proprietaire}/${nom}/actions/runs?branch=${encodeURIComponent(nomBranche(id))}&event=push&per_page=1`,
  );
  const r = j.workflow_runs[0];
  return r ? mapperRun(r) : null;
}

export interface Artefact {
  id: number;
  name: string;
  expired: boolean;
}

export async function artefacts(runId: number): Promise<Artefact[]> {
  const { proprietaire, nom } = depotCompilation();
  const j = await github<{ artifacts: Artefact[] }>(`/repos/${proprietaire}/${nom}/actions/runs/${runId}/artifacts`);
  return j.artifacts;
}

/** Télécharge un artefact (zip) et en extrait les fichiers. */
export async function extraireArtefact(artefactId: number): Promise<Array<{ nom: string; contenu: Buffer }>> {
  const { proprietaire, nom } = depotCompilation();
  const r = await github<Response>(`/repos/${proprietaire}/${nom}/actions/artifacts/${artefactId}/zip`, { brut: true, signal: AbortSignal.timeout(120_000) });
  const octets = Buffer.from(await r.arrayBuffer());
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(octets);
  const fichiers: Array<{ nom: string; contenu: Buffer }> = [];
  for (const [nomFichier, entree] of Object.entries(zip.files)) {
    if (entree.dir) continue;
    fichiers.push({ nom: nomFichier, contenu: await entree.async("nodebuffer") });
  }
  return fichiers;
}

/** Extrait l'essentiel d'un journal Gradle : erreurs de compilation et cause de l'échec. */
export function resumerJournal(journal: string, maxCar = 6000): string {
  const lignes = journal.split("\n");
  const retenues: string[] = [];
  const RE = /error:|FAILED|What went wrong|Could not |Exception|BUILD FAILED|Unresolved|cannot find symbol|incompatible types|does not exist|is not abstract|> Task .* FAILED|Caused by/i;
  for (let i = 0; i < lignes.length; i++) {
    if (RE.test(lignes[i])) {
      for (let k = Math.max(0, i - 1); k <= Math.min(lignes.length - 1, i + 3); k++) {
        const l = lignes[k].replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
        if (l && !retenues.includes(l)) retenues.push(l);
      }
    }
  }
  let texte = retenues.join("\n");
  if (!texte.trim()) texte = lignes.slice(-60).join("\n");
  if (texte.length > maxCar) texte = texte.slice(0, maxCar) + "\n[… journal tronqué …]";
  return texte;
}
