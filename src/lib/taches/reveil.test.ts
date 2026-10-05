import { beforeEach, describe, expect, it, vi } from "vitest";
import { getKV } from "@/lib/kv";

vi.mock("@/lib/db/taches", () => ({
  tachesAReveiller: vi.fn(async () => []),
  majTache: vi.fn(async () => null),
}));
vi.mock("@/lib/taches/planificateur", () => ({ planificateurHTTP: { programmer: vi.fn(async () => {}) } }));
vi.mock("@/lib/github/menage", () => ({ nettoyerBranchesCompilation: vi.fn(async () => ({ examinees: 0, supprimees: [], erreurs: 0 })) }));

import { reveillerTaches } from "./index";
import { tachesAReveiller } from "@/lib/db/taches";

beforeEach(async () => {
  const kv = getKV();
  for (const k of await kv.keys("")) await kv.del(k);
  vi.clearAllMocks();
});

describe("verrou de réveil atomique", () => {
  it("un second appel dans la fenêtre ne relance rien", async () => {
    await reveillerTaches();
    expect(tachesAReveiller).toHaveBeenCalledTimes(1);
    const r2 = await reveillerTaches();
    expect(r2).toEqual([]);
    expect(tachesAReveiller).toHaveBeenCalledTimes(1); // pas de second SELECT
  });
});
