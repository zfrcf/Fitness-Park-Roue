/**
 * Lecture de la conversation par le modèle (outil `lire_conversation`) : retrouver un détail d'un
 * message précédent, même si le contexte a été résumé/élagué. Logique pure, testable.
 */
export interface MessageIndexe {
  n: number;
  role: string;
  texte: string;
}

const PLAFOND = 12_000;

export function roleFr(r: string): string {
  return r === "user" ? "Utilisateur" : r === "assistant" ? "Assistant" : r;
}

/** Index numéroté (1..N) des messages non vides et non système. */
export function indexerMessages(messages: Array<{ role: string; texte: string }>): MessageIndexe[] {
  return messages
    .map((m, i) => ({ n: i + 1, role: m.role, texte: m.texte.trim() }))
    .filter((e) => e.texte.length > 0 && e.role !== "system");
}

export function lireMessage(index: MessageIndexe[], numero: number): { numero: number; role: string; texte: string } | { erreur: string } {
  const e = index.find((x) => x.n === numero);
  if (!e) return { erreur: `Aucun message n°${numero} (la conversation a ${index.length} messages).` };
  const texte = e.texte.length > PLAFOND ? e.texte.slice(0, PLAFOND) + "\n[… message tronqué]" : e.texte;
  return { numero, role: roleFr(e.role), texte };
}

export function chercherPassages(index: MessageIndexe[], recherche: string): Array<{ numero: number; role: string; extrait: string }> {
  const q = recherche.trim().toLowerCase();
  if (!q) return [];
  const trouves = index.filter((e) => e.texte.toLowerCase().includes(q));
  let budget = PLAFOND;
  const resultats: Array<{ numero: number; role: string; extrait: string }> = [];
  for (const e of trouves.slice(-12)) {
    const i = e.texte.toLowerCase().indexOf(q);
    const extrait = (i > 80 ? "…" : "") + e.texte.slice(Math.max(0, i - 80), i + 400) + (e.texte.length > i + 400 ? "…" : "");
    const bout = extrait.slice(0, budget);
    budget -= bout.length;
    resultats.push({ numero: e.n, role: roleFr(e.role), extrait: bout });
    if (budget <= 0) break;
  }
  return resultats;
}

export function listerMessages(index: MessageIndexe[]): string {
  const liste = index.map((e) => `${e.n}. ${roleFr(e.role)} : ${e.texte.replace(/\s+/g, " ").slice(0, 90)}${e.texte.length > 90 ? "…" : ""}`).join("\n");
  return liste.length > PLAFOND ? liste.slice(-PLAFOND) : liste;
}
