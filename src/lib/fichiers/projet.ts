/**
 * État du projet d'une conversation : la fusion de tous les fichiers produits par l'assistant,
 * la version la plus récente de chaque chemin faisant foi. Il est renvoyé au modèle à chaque
 * tour (une seule copie par fichier) pour qu'il ne reprenne que ce qui change.
 */
import { extraireFichiers, remplacerBlocsFichiers, type FichierGenere } from "./extraire";

export interface FichierProjet extends FichierGenere {
  /** Message de l'assistant qui a produit cette version. */
  messageId: string;
  /** Rang chronologique de la dernière modification (0 = la plus ancienne). */
  revision: number;
}

interface MessageMinimal {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string }>;
}

export function texteDuMessage(m: MessageMinimal): string {
  // Après une régénération, le texte dégénéré d'avant le marqueur ne compte pas dans le projet. (#23)
  const idx = m.parts.map((p) => p.type).lastIndexOf("data-regeneration");
  const parts = idx >= 0 ? m.parts.slice(idx + 1) : m.parts;
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

/** Chemins que la chaîne de compilation fournit elle-même ou refuse : jamais dans le projet. */
export const RE_CHEMIN_RESERVE = /^\.github\/|^vercel\.json$|(^|\/)gradlew(\.bat)?$|gradle-wrapper\.(jar|properties)$/;

/**
 * Fusionne les fichiers de toutes les réponses, dans l'ordre d'apparition des chemins.
 * Les lignes « Supprimer : chemin » d'une réponse retirent le fichier à ce moment-là ;
 * les chemins réservés (.github/, wrapper Gradle) sont ignorés.
 */
export function fusionnerProjet(messages: MessageMinimal[]): FichierProjet[] {
  const projet = new Map<string, FichierProjet>();
  let revision = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const texte = texteDuMessage(m);
    for (const chemin of suppressionsDemandees(texte)) projet.delete(chemin);
    const fichiers = extraireFichiers(texte).filter((f) => !RE_CHEMIN_RESERVE.test(f.chemin));
    if (!fichiers.length) continue;
    for (const f of fichiers) projet.set(f.chemin, { ...f, messageId: m.id, revision });
    revision++;
  }
  return [...projet.values()];
}

/** Fichiers produits par un message donné, dans l'état courant du projet. */
export function fichiersModifiesPar(projet: FichierProjet[], messageId: string): FichierProjet[] {
  return projet.filter((f) => f.messageId === messageId);
}

export const INSTRUCTION_PROJET =
  "Un projet est déjà en cours dans cette conversation : son état complet et à jour est donné ci-dessous " +
  "(c'est la seule version qui compte ; les blocs de code de tes réponses précédentes ont été remplacés par des renvois). " +
  "Pour toute modification ou correction, renvoie UNIQUEMENT les fichiers nouveaux ou modifiés, chacun EN ENTIER dans son " +
  "bloc de code avec son chemin, et ne récris jamais les fichiers inchangés. Pour supprimer un fichier, écris une ligne " +
  "« Supprimer : chemin ». L'utilisateur compile et télécharge toujours le projet complet (état ci-dessous + tes modifications).";

function estimerTokens(texte: string): number {
  return Math.ceil(texte.length / 3.2);
}

/**
 * Bloc « état du projet » pour le système : contenu complet des fichiers les plus récents
 * dans la limite du budget, les autres listés par chemin seulement.
 */
export function blocProjetPourModele(projet: FichierProjet[], budgetTokens: number): string {
  if (!projet.length) return "";
  const parRecence = [...projet].sort((a, b) => b.revision - a.revision);
  const complets = new Set<string>();
  let total = 0;
  for (const f of parRecence) {
    const t = estimerTokens(f.contenu) + 20;
    if (total + t > budgetTokens) continue;
    total += t;
    complets.add(f.chemin);
  }
  const lignes: string[] = [`<etat_du_projet fichiers="${projet.length}">`];
  for (const f of projet) {
    if (complets.has(f.chemin)) {
      const cloture = f.contenu.includes("```") ? "````" : "```";
      lignes.push(`${cloture}${f.langue ?? ""} ${f.chemin}\n${f.contenu.replace(/\n$/, "")}\n${cloture}`);
    } else {
      lignes.push(`- ${f.chemin} (${f.contenu.length} caractères, contenu omis faute de place : demande-le si tu dois le modifier)`);
    }
  }
  lignes.push("</etat_du_projet>");
  return lignes.join("\n");
}

/** Remplace, dans une réponse passée, les blocs des fichiers connus par un renvoi à l'état du projet. */
export function masquerFichiersConnus(markdown: string, chemins: Set<string>): string {
  return remplacerBlocsFichiers(markdown, (chemin) => (chemins.has(chemin) ? `[fichier \`${chemin}\` : voir l'état du projet]` : null));
}

/** Chemins à supprimer demandés dans une réponse (« Supprimer : chemin »). */
export function suppressionsDemandees(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/^\s*(?:[-*]\s*)?Supprimer\s*:\s*`?([^\s`]+)`?\s*$/gim)) out.push(m[1]);
  return out;
}
