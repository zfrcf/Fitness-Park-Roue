/**
 * Ajustement de l'historique à la fenêtre de contexte d'un fournisseur :
 * on résume les anciens messages plutôt que de les couper.
 */
import type { ModelMessage } from "ai";

/** Estimation prudente : ~3,2 caractères par token (français, Markdown, code). */
export function estimerTokens(texte: string): number {
  return Math.ceil(texte.length / 3.2);
}

export function texteDe(m: ModelMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type === "reasoning") return "";
      if ("text" in p && typeof p.text === "string") return p.text;
      return "";
    })
    .join("\n");
}

export function tokensMessage(m: ModelMessage): number {
  return estimerTokens(texteDe(m)) + 4; // + enveloppe du rôle
}

export interface ParamsAjustement {
  /** Fenêtre de contexte du fournisseur (tokens). */
  contexte: number;
  /** Tokens réservés à la réponse. */
  maxSortie: number;
  /** Prompt système (déjà compté à part). */
  systeme: string;
}

export type Resumeur = (anciens: ModelMessage[], budgetTokens: number) => Promise<string>;

export interface ResultatAjustement {
  messages: ModelMessage[];
  /** Prompt système éventuellement enrichi du résumé. */
  systeme: string;
  resume: boolean;
  /** Résumé impossible : les anciens messages ont été coupés. */
  tronque: boolean;
}

export function budgetEntree(p: ParamsAjustement): number {
  const marge = Math.ceil(p.contexte * 0.05) + 64;
  return p.contexte - p.maxSortie - estimerTokens(p.systeme) - marge;
}

/**
 * Garde les messages les plus récents qui tiennent dans le budget, résume le reste.
 * Le dernier message (la question) est toujours conservé, tronqué si lui seul dépasse.
 */
export async function ajusterAuContexte(
  messages: ModelMessage[],
  p: ParamsAjustement,
  resumer: Resumeur,
): Promise<ResultatAjustement> {
  const budget = budgetEntree(p);
  const total = messages.reduce((s, m) => s + tokensMessage(m), 0);
  if (total <= budget) return { messages, systeme: p.systeme, resume: false, tronque: false };

  // On remonte depuis la fin en gardant au moins le dernier message.
  const budgetRecents = Math.floor(budget * 0.7); // 30 % pour le résumé
  const recents: ModelMessage[] = [];
  let somme = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = tokensMessage(messages[i]);
    if (recents.length > 0 && somme + t > budgetRecents) break;
    recents.unshift(messages[i]);
    somme += t;
  }
  // Ne pas commencer les récents par une réponse d'assistant orpheline.
  while (recents.length > 1 && recents[0].role === "assistant") {
    somme -= tokensMessage(recents[0]);
    recents.shift();
  }
  const anciens = messages.slice(0, messages.length - recents.length);

  // Cas limite : le dernier message dépasse à lui seul le budget → on le tronque.
  if (recents.length === 1 && somme > budget) {
    const m = recents[0];
    const texte = texteDe(m);
    const maxCar = Math.max(200, Math.floor(budget * 3.2));
    const coupe = texte.slice(0, maxCar) + "\n\n[… message tronqué pour tenir dans le contexte …]";
    return {
      messages: [{ role: m.role, content: coupe } as ModelMessage],
      systeme: p.systeme,
      resume: false,
      tronque: true,
    };
  }

  if (anciens.length === 0) return { messages: recents, systeme: p.systeme, resume: false, tronque: false };

  const budgetResume = budget - somme;
  try {
    const resume = await resumerParTranches(anciens, Math.max(300, budgetResume), resumer);
    const systeme = `${p.systeme}\n\n## Résumé des échanges précédents de cette conversation\n${resume}`;
    return { messages: recents, systeme, resume: true, tronque: false };
  } catch {
    return { messages: recents, systeme: p.systeme, resume: false, tronque: true };
  }
}

/** Résume une longue liste de messages par tranches qui tiennent chacune dans le budget. */
export async function resumerParTranches(
  anciens: ModelMessage[],
  budgetTokens: number,
  resumer: Resumeur,
): Promise<string> {
  const tailleTranche = Math.max(400, Math.floor(budgetTokens * 2)); // tokens d'entrée par tranche
  const tranches: ModelMessage[][] = [];
  let courante: ModelMessage[] = [];
  let somme = 0;
  for (const m of anciens) {
    let t = tokensMessage(m);
    let msg = m;
    if (t > tailleTranche) {
      // Un message géant est coupé pour rester résumable.
      msg = { role: m.role, content: texteDe(m).slice(0, tailleTranche * 3) } as ModelMessage;
      t = tokensMessage(msg);
    }
    if (courante.length && somme + t > tailleTranche) {
      tranches.push(courante);
      courante = [];
      somme = 0;
    }
    courante.push(msg);
    somme += t;
  }
  if (courante.length) tranches.push(courante);

  if (tranches.length === 1) return resumer(tranches[0], budgetTokens);

  const partiels: string[] = [];
  for (const tr of tranches) partiels.push(await resumer(tr, Math.floor(budgetTokens / tranches.length)));
  const fusion: ModelMessage[] = [{ role: "user", content: partiels.map((p, i) => `Partie ${i + 1} :\n${p}`).join("\n\n") }];
  const texteFusion = texteDe(fusion[0]);
  if (estimerTokens(texteFusion) <= budgetTokens) return texteFusion;
  return resumer(fusion, budgetTokens);
}

export const INSTRUCTION_RESUME =
  "Résume fidèlement les échanges suivants d'une conversation entre un utilisateur et un assistant. " +
  "Conserve les faits, décisions, chiffres, noms, extraits de code essentiels et les demandes encore en cours. " +
  "Écris en français, de façon dense, sans introduction ni conclusion.";

export function promptResume(anciens: ModelMessage[]): string {
  return anciens
    .map((m) => `${m.role === "user" ? "Utilisateur" : m.role === "assistant" ? "Assistant" : "Système"} : ${texteDe(m)}`)
    .join("\n\n");
}

/**
 * Retire le raisonnement des anciens messages de l'assistant : il ne sert à rien au modèle
 * pour la suite, coûte des tokens, et certains fournisseurs (Groq) refusent la propriété
 * `reasoning_content` dans l'historique.
 */
export function sansRaisonnement(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || typeof m.content === "string") return m;
    const parts = m.content.filter((part) => part.type !== "reasoning");
    if (parts.length === m.content.length) return m;
    if (parts.length === 0) return { ...m, content: "" };
    return { ...m, content: parts };
  });
}
