/**
 * Sortie ordonnée d'un programme Python de la console (pur, testé) : textes (sortie standard ou
 * d'erreur) et images (figures matplotlib) dans l'ordre exact où le programme les a produits.
 */

/** Morceau de sortie : texte (stdout, ou stderr si `erreur`) ou image (data: URL d'une figure). */
export type Morceau = { texte: string; erreur?: boolean } | { image: string; figure?: number };

/**
 * Ajoute un morceau à la liste (modifiée et renvoyée) : un texte du même flux que le précédent le
 * prolonge ; une nouvelle image de la même figure, sans rien d'affiché entre les deux (animation
 * avec plt.pause), remplace la précédente au lieu de s'empiler.
 */
export function ajouterMorceau(liste: Morceau[], m: Morceau): Morceau[] {
  const dernier = liste[liste.length - 1];
  if ("texte" in m) {
    if (!m.texte) return liste;
    if (dernier && "texte" in dernier && Boolean(dernier.erreur) === Boolean(m.erreur)) {
      liste[liste.length - 1] = { ...dernier, texte: dernier.texte + m.texte };
      return liste;
    }
    liste.push(m.erreur ? { texte: m.texte, erreur: true } : { texte: m.texte });
    return liste;
  }
  if (dernier && "image" in dernier && m.figure !== undefined && dernier.figure === m.figure) {
    liste[liste.length - 1] = { ...m };
    return liste;
  }
  liste.push({ ...m });
  return liste;
}

/** Copie de la liste avec le morceau ajouté (pour un état React). */
export function avecMorceau(liste: Morceau[], m: Morceau): Morceau[] {
  return ajouterMorceau([...liste], m);
}

/** Tout le texte d'un flux (sortie standard, ou d'erreur si `erreur`), dans l'ordre. */
export function texteDuFlux(liste: Morceau[], erreur = false): string {
  return liste.map((m) => ("texte" in m && Boolean(m.erreur) === erreur ? m.texte : "")).join("");
}

/** Les images, dans l'ordre. */
export function imagesDe(liste: Morceau[]): string[] {
  return liste.flatMap((m) => ("image" in m ? [m.image] : []));
}

/** Dernier texte affiché (tous flux confondus), pour savoir s'il faut aller à la ligne. */
export function dernierTexte(liste: Morceau[]): string {
  for (let i = liste.length - 1; i >= 0; i--) {
    const m = liste[i];
    if ("texte" in m) return m.texte;
  }
  return "";
}

/** Groupe affiché d'une seule pièce : textes consécutifs (un même bloc <pre>) ou une image. */
export type GroupeSortie = { textes: { texte: string; erreur?: boolean }[] } | { image: string };

/**
 * Regroupe les morceaux pour l'affichage : les textes qui se suivent (sortie et erreurs mêlées)
 * forment un seul bloc, comme dans un terminal ; chaque image coupe le flux. Au-delà de `max`
 * morceaux (programme qui alterne sans fin), la suite n'est pas affichée (`tronque`).
 */
export function grouperMorceaux(liste: Morceau[], max = 400): { groupes: GroupeSortie[]; tronque: boolean } {
  const groupes: GroupeSortie[] = [];
  for (const m of liste.slice(0, max)) {
    if ("image" in m) {
      groupes.push({ image: m.image });
      continue;
    }
    const dernier = groupes[groupes.length - 1];
    if (dernier && "textes" in dernier) dernier.textes.push(m);
    else groupes.push({ textes: [m] });
  }
  return { groupes, tronque: liste.length > max };
}
