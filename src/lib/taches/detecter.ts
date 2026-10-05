/**
 * Repère une demande de travail long et autonome dans un message, pour proposer de la lancer
 * en tâche de fond (« travaille jusqu'à ce que le jar compile », « corrige en boucle »…).
 * Conservateur : mieux vaut ne rien proposer que de proposer à tort.
 */
const MOTIFS = [
  /\bjusqu'?(?:a|à|au)\b/i, // jusqu'à, jusqu'au
  /\ben boucle\b/i,
  /\btant que\b.*\b(?:compil|marche|fonctionn|pass|vert|r[ée]ussi|ok)/i,
  /\b(?:corrige|r[ée]p[èe]te|recommence|relance|essaie|essaye|boucle)\b.*\bjusqu/i,
  /\btravaille\b.*\b(?:nuit|tout seul|en autonomie|sans moi|jusqu)/i,
  /\bcompile\b.*\bjusqu/i,
  /\bne t'?arr[êe]te pas\b/i,
];

export function detecterTacheLongue(texte: string): boolean {
  const t = (texte ?? "").slice(0, 2000);
  if (t.trim().length < 8) return false;
  return MOTIFS.some((re) => re.test(t));
}
