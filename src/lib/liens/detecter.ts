const RE_URL = /\bhttps?:\/\/[^\s<>"'`\]}]+/gi;
export const MAX_LIENS_PAR_MESSAGE = 5;

/**
 * Retire les blocs de code (```…``` clôturés ou non) et le code en ligne (`…`) : une URL dans un
 * journal de compilation Gradle collé en ```text ne doit pas être lue comme un lien du message (#22).
 */
function sansCode(texte: string): string {
  return texte
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/g, " ") // bloc de code non refermé (journal tronqué)
    .replace(/`[^`\n]*`/g, " ");
}

/** Extrait les URL http(s) d'un texte (hors blocs de code), sans doublon, ponctuation finale retirée. */
export function detecterLiens(texte: string): string[] {
  const vus = new Set<string>();
  const resultat: string[] = [];
  for (const brut of sansCode(texte).match(RE_URL) ?? []) {
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
