/**
 * État du projet d'une conversation : la fusion de tous les fichiers produits par l'assistant,
 * la version la plus récente de chaque chemin faisant foi. Il est renvoyé au modèle à chaque
 * tour (une seule copie par fichier) pour qu'il ne reprenne que ce qui change.
 */
import { extraireFichiers, extraireModifications, remplacerBlocsFichiers, type FichierGenere } from "./extraire";

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
  return fusionnerProjetDetaille(messages).fichiers;
}

/** Une modification partielle qui n'a pas pu être appliquée (le modèle doit renvoyer le fichier entier). */
export interface EchecModification {
  messageId: string;
  chemin: string;
  raison: string;
}

/**
 * Comme fusionnerProjet, mais applique aussi les blocs de modification partielle
 * (```modif chemin, paires CHERCHER/REMPLACER) et renvoie les modifications qui ont échoué.
 */
export function fusionnerProjetDetaille(messages: MessageMinimal[]): { fichiers: FichierProjet[]; echecs: EchecModification[] } {
  const projet = new Map<string, FichierProjet>();
  const echecs: EchecModification[] = [];
  let revision = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const texte = texteDuMessage(m);
    for (const chemin of suppressionsDemandees(texte)) projet.delete(chemin);
    let change = false;
    const fichiers = extraireFichiers(texte).filter((f) => !RE_CHEMIN_RESERVE.test(f.chemin));
    for (const f of fichiers) {
      projet.set(f.chemin, { ...f, messageId: m.id, revision });
      change = true;
    }
    const ecrits = new Set([...fichiers.map((f) => f.chemin), ...extraireModifications(texte).map((x) => x.chemin)]);
    for (const chemin of modificationsFantomes(texte, ecrits)) {
      echecs.push({ messageId: m.id, chemin, raison: "modification annoncée mais non écrite (aucun bloc ```modif dans la réponse)" });
    }
    for (const modif of extraireModifications(texte)) {
      if (RE_CHEMIN_RESERVE.test(modif.chemin)) continue;
      const actuel = projet.get(modif.chemin);
      if (!actuel) {
        echecs.push({ messageId: m.id, chemin: modif.chemin, raison: "fichier inconnu dans le projet" });
        continue;
      }
      if (!modif.remplacements.length) {
        echecs.push({ messageId: m.id, chemin: modif.chemin, raison: "bloc mal formé (aucune paire CHERCHER / REMPLACER)" });
        continue;
      }
      let contenu = actuel.contenu;
      let ok = true;
      for (const { chercher, remplacer } of modif.remplacements) {
        const r = appliquerRemplacement(contenu, chercher, remplacer);
        if (r === null) {
          echecs.push({ messageId: m.id, chemin: modif.chemin, raison: `texte à remplacer introuvable : « ${resumer(chercher)} »` });
          ok = false;
          break;
        }
        contenu = r;
      }
      if (!ok) continue;
      projet.set(modif.chemin, { ...actuel, contenu, messageId: m.id, revision });
      change = true;
    }
    if (change) revision++;
  }
  return { fichiers: [...projet.values()], echecs };
}

function resumer(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

/**
 * Remplace la première occurrence de `chercher` dans `contenu`. Tolérances, dans l'ordre :
 * correspondance exacte ; espaces de fin de ligne ignorés ; indentation ignorée (le remplacement
 * est alors ré-indenté comme la première ligne trouvée). Renvoie null si introuvable.
 */
export function appliquerRemplacement(contenu: string, chercher: string, remplacer: string): string | null {
  const cible = chercher.replace(/\n$/, "");
  if (!cible.trim()) return null;
  const idx = contenu.indexOf(cible);
  if (idx >= 0) return contenu.slice(0, idx) + remplacer.replace(/\n$/, "") + contenu.slice(idx + cible.length);

  const lignes = contenu.split("\n");
  const voulues = cible.split("\n");
  const essais: Array<{ norm: (s: string) => string; reindenter: boolean }> = [
    { norm: (s) => s.trimEnd(), reindenter: false },
    { norm: (s) => s.trim(), reindenter: true },
  ];
  for (const { norm, reindenter } of essais) {
    const v = voulues.map(norm);
    for (let i = 0; i + v.length <= lignes.length; i++) {
      let egal = true;
      for (let k = 0; k < v.length; k++) {
        if (norm(lignes[i + k]) !== v[k]) {
          egal = false;
          break;
        }
      }
      if (!egal) continue;
      let nouvelles = remplacer.replace(/\n$/, "").split("\n");
      if (reindenter) {
        // Décalage entre l'indentation du fichier et celle du bloc CHERCHER, appliqué au remplacement.
        const indentFichier = /^\s*/.exec(lignes[i])?.[0] ?? "";
        const indentBloc = /^\s*/.exec(voulues[0])?.[0] ?? "";
        nouvelles = nouvelles.map((l) => (l.startsWith(indentBloc) ? indentFichier + l.slice(indentBloc.length) : l));
      }
      return [...lignes.slice(0, i), ...nouvelles, ...lignes.slice(i + v.length)].join("\n");
    }
  }
  return null;
}

/** Fichiers produits par un message donné, dans l'état courant du projet. */
export function fichiersModifiesPar(projet: FichierProjet[], messageId: string): FichierProjet[] {
  return projet.filter((f) => f.messageId === messageId);
}

/** Mode d'emploi des modifications partielles, donné au modèle (prompt système et messages de correction). */
export const INSTRUCTION_MODIFICATIONS =
  "RÈGLE IMPÉRATIVE pour les fichiers qui existent déjà : ne les réécris JAMAIS en entier. Modifie-les avec un bloc " +
  "```modif chemin/du/fichier contenant une ou plusieurs paires (autant que de changements) :\n" +
  "<<<<<<< CHERCHER\n(lignes existantes, copiées à l'identique, assez longues pour être uniques)\n=======\n(nouvelles lignes)\n>>>>>>> REMPLACER\n" +
  "Le texte CHERCHER doit exister tel quel dans le fichier (indentation comprise) ; pour ajouter du code, cherche la ligne voisine et " +
  "remplace-la par elle-même plus les nouvelles lignes. Un fichier n'est écrit en entier que s'il est NOUVEAU, ou si plus de la moitié de " +
  "ses lignes change. Ne renvoie jamais un fichier inchangé.";

export const INSTRUCTION_PROJET =
  "Un projet est déjà en cours dans cette conversation : son état complet et à jour est donné ci-dessous " +
  "(c'est la seule version qui compte ; les blocs de code de tes réponses précédentes ont été remplacés par des renvois). " +
  "Pour toute modification ou correction, ne touche qu'aux fichiers concernés et ne récris jamais les fichiers inchangés. " +
  INSTRUCTION_MODIFICATIONS +
  " Dans l'historique, tes anciens blocs de code sont remplacés par des notes « ⟦note de l'application : …⟧ » : ne les écris " +
  "JAMAIS toi-même ; une modification n'existe que si tu écris le bloc ```modif complet." +
  " Pour supprimer un fichier, écris une ligne « Supprimer : chemin ». L'utilisateur compile et télécharge toujours le projet " +
  "complet (état ci-dessous + tes modifications).";

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
  return remplacerBlocsFichiers(markdown, (chemin, modification) =>
    chemins.has(chemin) ? (modification ? `${NOTE_APPLICATION} bloc modif de ${chemin} appliqué ; contenu actuel dans l'état du projet ⟧` : `${NOTE_APPLICATION} fichier ${chemin} ; contenu actuel dans l'état du projet ⟧`) : null,
  );
}

/**
 * Préfixe des notes qui remplacent les anciens blocs de code dans l'historique envoyé au modèle.
 * Volontairement sans ressemblance avec un format de réponse : un modèle qui imitait l'ancienne
 * note « [modification de x : appliquée] » croyait avoir modifié le fichier sans rien écrire.
 */
export const NOTE_APPLICATION = "⟦note de l'application :";

/**
 * Fichiers qu'une réponse prétend avoir modifiés sans contenir de bloc pour eux (note recopiée,
 * « [modification de x : appliquée] »…) : la modification n'a pas eu lieu.
 */
export function modificationsFantomes(markdown: string, cheminsEcrits: Set<string>): string[] {
  const out = new Set<string>();
  const motifs = [/⟦note de l'application\s*:\s*(?:bloc modif de|fichier)\s+(\S+)/g, /\[modification de `([^`]+)`\s*:\s*appliquée/g, /\[fichier `([^`]+)`\s*:\s*voir l'état du projet\]/g];
  for (const re of motifs) for (const m of markdown.matchAll(re)) if (!cheminsEcrits.has(m[1])) out.add(m[1]);
  return [...out];
}

/** Chemins à supprimer demandés dans une réponse (« Supprimer : chemin »). */
export function suppressionsDemandees(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/^\s*(?:[-*]\s*)?Supprimer\s*:\s*`?([^\s`]+)`?\s*$/gim)) out.push(m[1]);
  return out;
}
