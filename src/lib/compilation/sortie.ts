/**
 * Fichiers produits par le script de construction (.atelier-sortie/) : quel nom de téléchargement
 * leur donner, et comment les regrouper en archive quand il y en a plusieurs.
 */
export const DOSSIER_SORTIE = ".atelier-sortie";
export const FICHIER_RESULTAT = "ATELIER-RESULTAT.txt";
/** Chemin du script dans le projet envoyé (GitHub) ou dans l'espace (local). */
export const CHEMIN_SCRIPT = ".atelier/construire.sh";

export interface FichierProduit {
  nom: string;
  contenu: Uint8Array;
}

/** Fichiers téléchargeables : tout sauf le fichier de résultat. */
export function produitsUtiles<T extends { nom: string }>(fichiers: T[]): T[] {
  return fichiers.filter((f) => f.nom !== FICHIER_RESULTAT && !f.nom.endsWith(`/${FICHIER_RESULTAT}`));
}

/**
 * Nom du téléchargement : le fichier lui-même s'il est seul (un .jar, un exécutable), sinon une
 * archive `<projet>.zip`, et null s'il n'y a rien à télécharger (script Python vérifié, site).
 * Avec plusieurs .jar (Gradle), le premier « principal » est retenu, comme avant.
 */
export function nomProduit(noms: string[], projet: string): string | null {
  const utiles = produitsUtiles(noms.map((nom) => ({ nom }))).map((f) => f.nom);
  if (!utiles.length) return null;
  const jars = utiles.filter((n) => !n.includes("/") && n.endsWith(".jar") && !/-(sources|dev|javadoc|plain)\.jar$/.test(n)).sort();
  if (jars.length) return jars[0];
  if (utiles.length === 1 && !utiles[0].includes("/")) return utiles[0];
  return `${projet.replace(/[^\w.-]+/g, "_") || "resultat"}.zip`;
}

export async function zipper(fichiers: FichierProduit[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of fichiers) zip.file(f.nom, f.contenu, { unixPermissions: 0o755 });
  return zip.generateAsync({ type: "uint8array", platform: "UNIX", compression: "DEFLATE" });
}

/** Le fichier demandé, ou une archive de tous les produits utiles si le nom est celui d'un .zip absent. */
export async function fichierATelecharger(fichiers: FichierProduit[], nom: string): Promise<FichierProduit | null> {
  const exact = fichiers.find((f) => f.nom === nom);
  if (exact) return exact;
  const utiles = produitsUtiles(fichiers);
  if (nom.endsWith(".zip") && utiles.length) return { nom, contenu: await zipper(utiles) };
  return utiles.find((f) => f.nom.endsWith(".jar")) ?? null;
}

export function typeMime(nom: string): string {
  if (nom.endsWith(".jar")) return "application/java-archive";
  if (nom.endsWith(".zip")) return "application/zip";
  if (/\.(txt|md|log)$/.test(nom)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
