import type { MessageUI } from "@/lib/chat/types";

/**
 * Parties à afficher : après le dernier marqueur de régénération, on ignore le TEXTE qui précède
 * (tentative dégénérée) mais on garde les pastilles pages lues / recherches émises avant lui. (#23)
 */
export function partiesVisibles(m: MessageUI): MessageUI["parts"] {
  const idx = m.parts.map((p) => p.type).lastIndexOf("data-regeneration");
  if (idx < 0) return m.parts;
  const avant = m.parts.slice(0, idx).filter((p) => p.type !== "text" && p.type !== "data-regeneration");
  return [...avant, ...m.parts.slice(idx + 1)];
}

export function texteDuMessage(m: MessageUI): string {
  return partiesVisibles(m)
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

const CLE_PREMIER = "chat:premier-message";

type StockLecture = Pick<Storage, "getItem" | "removeItem">;

/** Lit (et consomme) le premier message mis de côté par l'accueil ; ignore au-delà de 30 s. */
export function lirePremierMessage(storage: StockLecture, maintenant: number): string | null {
  try {
    const brut = storage.getItem(CLE_PREMIER);
    storage.removeItem(CLE_PREMIER);
    if (!brut) return null;
    const { texte, a } = JSON.parse(brut) as { texte?: string; a?: number };
    if (typeof texte !== "string" || typeof a !== "number" || maintenant - a > 30_000) return null;
    return texte.trim() || null;
  } catch {
    return null;
  }
}

/** Mémorise le premier message avant de naviguer vers /chat (évite de le mettre dans l'URL). */
export function ecrirePremierMessage(texte: string): void {
  try {
    sessionStorage.setItem(CLE_PREMIER, JSON.stringify({ texte, a: Date.now() }));
  } catch {
    /* mode privé : on se contente d'ouvrir le chat vide */
  }
}

/** Message d'erreur lisible : si le corps est un JSON {erreur|error|message}, on extrait le texte. (#36) */
export function messageErreurLisible(err: { message?: string } | null | undefined): string {
  const t = err?.message?.trim() ?? "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const m = j.erreur ?? j.error ?? j.message;
      if (typeof m === "string" && m.trim()) return m.trim();
    } catch {
      /* pas du JSON : on garde le texte brut */
    }
  }
  return t || "Une erreur est survenue. Réessayez.";
}

/**
 * Message utilisateur écrit par l'application (tâche de fond, bouton de correction) plutôt que
 * par l'utilisateur : journal de compilation à replier, relance automatique.
 */
export interface MessageAutomatique {
  type: "correction" | "relance";
  /** Lignes d'erreur du journal (au plus 8), pour l'aperçu. */
  erreurs: string[];
  nbErreurs: number | null;
  journal: string | null;
}

export function analyserMessageAutomatique(id: string, texte: string): MessageAutomatique | null {
  const correction = /^La compilation a échoué/.test(texte.trim());
  if (!correction && !id.startsWith("tache-")) return null;
  const bloc = /```(?:text)?\n([\s\S]*?)(?:\n```|$)/.exec(texte);
  const journal = bloc ? bloc[1] : null;
  const lignes = (journal ?? "").split("\n");
  const erreurs = lignes
    .filter((l) => /(^|\s|:)error:|erreur :|FAILURE:|What went wrong/i.test(l))
    .map((l) => l.replace(/^.*\/(src\/[^:]+:\d+:)/, "$1").trim())
    .slice(0, 8);
  const n = /^\s*(\d+) errors?\s*$/m.exec(journal ?? "");
  return { type: correction ? "correction" : "relance", erreurs, nbErreurs: n ? Number(n[1]) : null, journal };
}
