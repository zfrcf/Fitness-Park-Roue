import { describe, expect, it, vi } from "vitest";
import { nettoyerBranchesCompilation } from "./menage";

function fauxGitHub(branches: Array<{ name: string; sha: string; ageMs: number }>, maintenant: number) {
  const supprimees: string[] = [];
  const g = vi.fn(async (chemin: string, init?: { method?: string }) => {
    if (chemin.endsWith("/branches?per_page=100")) {
      return branches.map((b) => ({ name: b.name, commit: { sha: b.sha } }));
    }
    const commit = chemin.match(/\/commits\/(.+)$/);
    if (commit) {
      const b = branches.find((x) => x.sha === commit[1])!;
      return { commit: { committer: { date: new Date(maintenant - b.ageMs).toISOString() } } };
    }
    if (init?.method === "DELETE") {
      supprimees.push(chemin.split("/git/refs/heads/")[1]);
      return undefined;
    }
    throw new Error("chemin inattendu " + chemin);
  });
  return { g: g as unknown as typeof import("./api").github, supprimees };
}

describe("nettoyerBranchesCompilation", () => {
  it("supprime les branches compilation/* plus vieilles que l'âge max, garde les récentes et les autres", async () => {
    const maintenant = 10_000_000_000;
    const { g, supprimees } = fauxGitHub(
      [
        { name: "main", sha: "s0", ageMs: 999 * 3600_000 },
        { name: "compilation/vieux", sha: "s1", ageMs: 5 * 3600_000 },
        { name: "compilation/recent", sha: "s2", ageMs: 30 * 60_000 },
        { name: "compilation/tres-vieux", sha: "s3", ageMs: 48 * 3600_000 },
      ],
      maintenant,
    );
    const r = await nettoyerBranchesCompilation({ maintenant, github: g });
    expect(r.examinees).toBe(3); // les 3 compilation/*, pas main
    expect(supprimees.sort()).toEqual(["compilation/tres-vieux", "compilation/vieux"]);
    expect(r.supprimees.sort()).toEqual(["compilation/tres-vieux", "compilation/vieux"]);
    expect(r.erreurs).toBe(0);
  });

  it("compte une erreur sans planter si une suppression échoue", async () => {
    const maintenant = 10_000_000_000;
    const g = (async (chemin: string, init?: { method?: string }) => {
      if (chemin.endsWith("/branches?per_page=100")) return [{ name: "compilation/x", commit: { sha: "s1" } }];
      if (chemin.includes("/commits/")) return { commit: { author: { date: new Date(maintenant - 10 * 3600_000).toISOString() } } };
      if (init?.method === "DELETE") throw new Error("403");
      throw new Error("inattendu");
    }) as unknown as typeof import("./api").github;
    const r = await nettoyerBranchesCompilation({ maintenant, github: g });
    expect(r.erreurs).toBe(1);
    expect(r.supprimees).toEqual([]);
  });
});
