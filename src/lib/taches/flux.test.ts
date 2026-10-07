import { describe, expect, it, vi } from "vitest";
import { cleFlux, creerPublieurFlux } from "./flux";

function fauxKV() {
  const ecritures: Array<{ cle: string; valeur: unknown }> = [];
  const supprimees: string[] = [];
  return {
    ecritures,
    supprimees,
    kv: {
      set: vi.fn(async (cle: string, valeur: unknown) => void ecritures.push({ cle, valeur })),
      del: vi.fn(async (cle: string) => void supprimees.push(cle)),
    } as unknown as import("@/lib/kv").KV,
  };
}

describe("publication du texte en cours d'une tâche de fond", () => {
  it("espace les écritures, publie toujours le dernier texte, puis efface à la fin", async () => {
    vi.useFakeTimers();
    let t = 0;
    const { kv, ecritures, supprimees } = fauxKV();
    const p = creerPublieurFlux(kv, "conv1", 1000, () => t);
    p.publier("B"); // t=0 : écrit tout de suite (première écriture)
    t = 100;
    p.publier("Bo");
    t = 200;
    p.publier("Bon"); // regroupé : seul « Bon » partira à t=1000
    await vi.advanceTimersByTimeAsync(0);
    expect(ecritures.map((e) => (e.valeur as { texte: string }).texte)).toEqual(["B"]);
    t = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ecritures.map((e) => (e.valeur as { texte: string }).texte)).toEqual(["B", "Bon"]);
    p.publier("Bonjour");
    await p.terminer();
    expect(supprimees).toEqual([cleFlux("conv1")]);
    p.publier("trop tard");
    await vi.advanceTimersByTimeAsync(5000);
    expect(ecritures.at(-1)?.cle).toBe("flux:conv1");
    expect(ecritures.some((e) => (e.valeur as { texte: string }).texte === "trop tard")).toBe(false);
    vi.useRealTimers();
  });
});
