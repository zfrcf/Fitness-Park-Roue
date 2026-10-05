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
