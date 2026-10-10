/** Langages exécutables dans le navigateur de l'utilisateur (sans serveur). */
export type LangueExecutable = "python";

const PYTHON = new Set(["py", "python", "python3", "py3"]);

/** Renvoie le langage exécutable d'un bloc de code, ou null s'il n'y en a pas. */
export function langueExecutable(langue?: string): LangueExecutable | null {
  if (!langue) return null;
  return PYTHON.has(langue.toLowerCase()) ? "python" : null;
}

/** Tronque une sortie de console trop longue pour l'affichage. */
export function tronquerSortie(texte: string, maxLignes = 400, maxCar = 40_000): string {
  let t = texte.length > maxCar ? texte.slice(0, maxCar) + "\n[… sortie tronquée]" : texte;
  const lignes = t.split("\n");
  if (lignes.length > maxLignes) t = lignes.slice(0, maxLignes).join("\n") + `\n[… ${lignes.length - maxLignes} lignes de plus]`;
  return t;
}
