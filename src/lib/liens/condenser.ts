/**
 * Pages longues : découpage en tranches, résumé de chaque tranche, puis fusion,
 * pour tenir dans le budget de contexte sans perdre l'essentiel.
 */
import { estimerTokens } from "@/lib/chat/contexte";

export type Resumeur = (texte: string, consigne: string, maxTokens: number) => Promise<string>;

export const INSTRUCTION_PAGE =
  "Tu condenses un extrait de page web pour qu'un assistant puisse répondre à des questions dessus. " +
  "Conserve les faits, chiffres, noms, dates, définitions, étapes et conclusions, dans l'ordre du texte, en français. " +
  "Aucune introduction ni commentaire. N'invente rien.";

export interface ResultatCondensation {
  contenu: string;
  condense: boolean;
  /** Repli : coupé faute de pouvoir résumer. */
  tronque: boolean;
}

/** Nombre maximal de tranches confiées au modèle par page (quotas gratuits obligent). */
export const MAX_TRANCHES_LLM = 3;

/**
 * Réduction extractive, sans modèle : pour les pages énormes (Wikipédia, documentation…),
 * on garde le début en entier, puis les titres et la première phrase de chaque paragraphe.
 */
export function reduireExtractif(texte: string, budgetTokens: number): string {
  const blocs = texte.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const budgetCar = Math.floor(budgetTokens * 3.2);
  const budgetDebut = Math.floor(budgetCar * 0.3);
  const sortie: string[] = [];
  let total = 0;
  let i = 0;
  for (; i < blocs.length && total + blocs[i].length <= budgetDebut; i++) {
    sortie.push(blocs[i]);
    total += blocs[i].length + 2;
  }
  for (; i < blocs.length; i++) {
    const b = blocs[i];
    let morceau: string;
    if (/^#{1,6}\s/.test(b)) morceau = b.slice(0, 200);
    else if (/^(-|\*|\d+\.)\s/.test(b)) morceau = b.split("\n").slice(0, 4).map((l) => l.slice(0, 160)).join("\n");
    else if (b.startsWith("```") || b.startsWith("|")) continue; // code et tableaux omis
    else {
      const m = /^[^.!?\n]{20,300}[.!?]/.exec(b);
      morceau = (m ? m[0] : b.slice(0, 200)) + (b.length > (m ? m[0].length : 200) ? " […]" : "");
    }
    if (total + morceau.length > budgetCar) {
      sortie.push("[… suite de la page omise …]");
      break;
    }
    sortie.push(morceau);
    total += morceau.length + 2;
  }
  return sortie.join("\n\n");
}

function decouper(texte: string, maxCar: number): string[] {
  const tranches: string[] = [];
  let reste = texte;
  while (reste.length > maxCar) {
    // Coupe de préférence à un saut de paragraphe, sinon à une fin de phrase.
    let coupe = reste.lastIndexOf("\n\n", maxCar);
    if (coupe < maxCar * 0.5) coupe = reste.lastIndexOf(". ", maxCar);
    if (coupe < maxCar * 0.5) coupe = maxCar;
    tranches.push(reste.slice(0, coupe).trim());
    reste = reste.slice(coupe).trim();
  }
  if (reste) tranches.push(reste);
  return tranches;
}

export async function condenserPage(
  contenu: string,
  budgetTokens: number,
  resumer: Resumeur,
  trancheTokens = 3500,
): Promise<ResultatCondensation> {
  if (estimerTokens(contenu) <= budgetTokens) return { contenu, condense: false, tronque: false };
  const maxCarTranche = Math.floor(trancheTokens * 3.2);
  // Page énorme : réduction extractive d'abord, pour limiter le nombre d'appels au modèle.
  let texte = contenu;
  const plafondLLM = trancheTokens * MAX_TRANCHES_LLM;
  if (estimerTokens(texte) > plafondLLM) texte = reduireExtractif(texte, plafondLLM);
  if (estimerTokens(texte) <= budgetTokens) return { contenu: texte, condense: true, tronque: false };
  try {
    // Jusqu'à 2 passes : chaque passe résume des tranches ; on s'arrête dès que ça tient.
    for (let passe = 0; passe < 2 && estimerTokens(texte) > budgetTokens; passe++) {
      const tranches = decouper(texte, maxCarTranche);
      const cible = Math.max(150, Math.floor(budgetTokens / tranches.length));
      const resumes: string[] = [];
      for (const [i, t] of tranches.entries()) {
        const consigne = tranches.length > 1 ? `${INSTRUCTION_PAGE} (partie ${i + 1} sur ${tranches.length})` : INSTRUCTION_PAGE;
        resumes.push((await resumer(t, consigne, Math.min(2000, cible * 2))).trim());
      }
      texte = resumes.join("\n\n");
    }
    if (estimerTokens(texte) > budgetTokens) texte = texte.slice(0, Math.floor(budgetTokens * 3.2)) + "\n\n[… condensé tronqué …]";
    return { contenu: texte, condense: true, tronque: false };
  } catch {
    return { contenu: contenu.slice(0, Math.floor(budgetTokens * 3.2)) + "\n\n[… page tronquée : impossible de la résumer pour l'instant …]", condense: false, tronque: true };
  }
}
