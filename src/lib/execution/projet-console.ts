/**
 * Fichiers du projet de la conversation ouverte, mis à disposition de la console Python : ils sont
 * copiés dans son dossier courant (/home/pyodide) pour que `pip install -r requirements.txt`,
 * `open("data.csv")` ou `import mon_module` les trouvent. La fenêtre de chat publie, la console lit.
 */
export interface FichierConsole {
  chemin: string;
  contenu: string;
}

let fichiers: FichierConsole[] = [];
const abonnes = new Set<() => void>();

export function publierProjetConsole(liste: FichierConsole[]): void {
  fichiers = liste;
  for (const f of abonnes) f();
}

export function projetConsole(): FichierConsole[] {
  return fichiers;
}

/** Pour `useSyncExternalStore` (nombre de fichiers affiché dans la console). */
export function abonnerProjetConsole(f: () => void): () => void {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Chemin relatif sûr dans le dossier de la console (pas de « .. », pas d'absolu), ou null. */
export function cheminConsole(chemin: string): string | null {
  const parties = chemin.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (!parties.length || parties.some((p) => p === "..")) return null;
  return parties.join("/");
}
