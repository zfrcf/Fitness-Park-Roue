import { describe, expect, it, vi } from "vitest";
import { lirePremierMessage } from "./utils";

function stock(valeur: string | null) {
  const store = new Map<string, string>();
  if (valeur !== null) store.set("chat:premier-message", valeur);
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    removeItem: vi.fn((k: string) => void store.delete(k)),
    _store: store,
  };
}

describe("lirePremierMessage", () => {
  it("renvoie un message frais et consomme la clé", () => {
    const s = stock(JSON.stringify({ texte: "bonjour", a: 1000 }));
    expect(lirePremierMessage(s, 5000)).toBe("bonjour");
    expect(s.removeItem).toHaveBeenCalledWith("chat:premier-message");
    expect(s._store.size).toBe(0);
  });
  it("ignore un message vieux de plus de 30 s", () => {
    const s = stock(JSON.stringify({ texte: "vieux", a: 1000 }));
    expect(lirePremierMessage(s, 1000 + 31_000)).toBeNull();
  });
  it("renvoie null si vide, invalide ou si le stockage lève", () => {
    expect(lirePremierMessage(stock(null), 0)).toBeNull();
    expect(lirePremierMessage(stock("pas du json"), 0)).toBeNull();
    const casse = { getItem: () => { throw new Error("bloqué"); }, removeItem: () => {} };
    expect(lirePremierMessage(casse, 0)).toBeNull();
  });
});
