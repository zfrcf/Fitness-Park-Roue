/**
 * Sortie ordonnée d'un programme Python de la console (pur, testé) : textes (sortie standard ou
 * d'erreur) et images (figures matplotlib) dans l'ordre exact où le programme les a produits.
 */

/** Morceau de sortie : texte (stdout, ou stderr si `erreur`) ou image (data: URL d'une figure). */
export type Morceau = { texte: string; erreur?: boolean } | { image: string; figure?: number };

/** Mémoire gardée par sortie (un programme qui affiche sans fin) : texte par flux et nombre de morceaux. */
export const MAX_TEXTE = 200_000;
export const MAX_MORCEAUX = 1_000;
export const MARQUE_MASQUE = "[… début de la sortie masqué …]\n";

/** Comme un terminal qui défile : au-delà du double de la limite, seule la fin est gardée (coût amorti constant). */
function plafonnerTexte(t: string): string {
  if (t.length <= 2 * MAX_TEXTE) return t;
  const fin = t.slice(-MAX_TEXTE);
  const ligne = fin.indexOf("\n");
  return MARQUE_MASQUE + (ligne >= 0 && ligne < 1000 ? fin.slice(ligne + 1) : fin);
}

/**
 * Ajoute un morceau à la liste (modifiée et renvoyée) : un texte du même flux que le précédent le
 * prolonge ; une nouvelle image de la même figure, sans rien d'affiché entre les deux (animation
 * avec plt.pause), remplace la précédente au lieu de s'empiler. La mémoire est bornée (MAX_TEXTE,
 * MAX_MORCEAUX) : le début d'une sortie sans fin est masqué.
 */
export function ajouterMorceau(liste: Morceau[], m: Morceau): Morceau[] {
  const dernier = liste[liste.length - 1];
  if ("texte" in m) {
    if (!m.texte) return liste;
    if (dernier && "texte" in dernier && Boolean(dernier.erreur) === Boolean(m.erreur)) {
      liste[liste.length - 1] = { ...dernier, texte: plafonnerTexte(dernier.texte + m.texte) };
      return liste;
    }
    liste.push(m.erreur ? { texte: plafonnerTexte(m.texte), erreur: true } : { texte: plafonnerTexte(m.texte) });
  } else if (dernier && "image" in dernier && m.figure !== undefined && dernier.figure === m.figure) {
    liste[liste.length - 1] = { ...m };
    return liste;
  } else {
    liste.push({ ...m });
  }
  if (liste.length > 2 * MAX_MORCEAUX) liste.splice(0, liste.length - MAX_MORCEAUX, { texte: MARQUE_MASQUE });
  return liste;
}

/**
 * Regroupe les morceaux reçus en rafale (boucle de print) : `vider` reçoit au plus une liste par image
 * au lieu d'une mise à jour d'état par écriture. `abandonner()` oublie ce qui attend (le résultat
 * complet de l'exécution le remplace).
 */
export function tamponMorceaux(vider: (ms: Morceau[]) => void, delai = 16): { ajouter: (m: Morceau) => void; abandonner: () => void } {
  let attente: Morceau[] = [];
  let minuterie: ReturnType<typeof setTimeout> | null = null;
  return {
    ajouter(m) {
      ajouterMorceau(attente, m);
      minuterie ??= setTimeout(() => {
        minuterie = null;
        const l = attente;
        attente = [];
        if (l.length) vider(l);
      }, delai);
    },
    abandonner() {
      attente = [];
    },
  };
}

/** Copie de la liste avec les morceaux ajoutés dans l'ordre (pour un état React). */
export function avecMorceaux(liste: Morceau[], ms: Morceau[]): Morceau[] {
  const copie = [...liste];
  for (const m of ms) ajouterMorceau(copie, m);
  return copie;
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
 * morceaux (programme qui alterne sans fin), seuls les derniers sont affichés, comme un terminal
 * qui défile (`tronque` : le début est masqué).
 */
export function grouperMorceaux(liste: Morceau[], max = 400): { groupes: GroupeSortie[]; tronque: boolean } {
  const groupes: GroupeSortie[] = [];
  for (const m of liste.length > max ? liste.slice(-max) : liste) {
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
