const RE_URL = /\bhttps?:\/\/[^\s<>"'`\]}]+/gi;
export const MAX_LIENS_PAR_MESSAGE = 5;

/** Extrait les URL http(s) d'un texte, sans doublon, ponctuation finale retirée. */
export function detecterLiens(texte: string): string[] {
  const vus = new Set<string>();
  const resultat: string[] = [];
  for (const brut of texte.match(RE_URL) ?? []) {
    let u = brut;
    // Ponctuation finale et parenthèses fermantes non appariées (lien Wikipédia « (homonymie) » conservé).
    for (;;) {
      const avant = u;
      u = u.replace(/[.,;:!?»"\]]+$/g, "");
      const ouvrantes = (u.match(/\(/g) ?? []).length;
      const fermantes = (u.match(/\)/g) ?? []).length;
      if (fermantes > ouvrantes && u.endsWith(")")) u = u.slice(0, -1);
      if (u === avant) break;
    }
    try {
      const url = new URL(u);
      url.hash = "";
      const cle = url.toString();
      if (!vus.has(cle)) {
        vus.add(cle);
        resultat.push(cle);
      }
    } catch {
      /* ignoré */
    }
    if (resultat.length >= MAX_LIENS_PAR_MESSAGE) break;
  }
  return resultat;
}
