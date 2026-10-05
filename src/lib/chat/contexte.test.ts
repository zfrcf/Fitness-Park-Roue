import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { ajusterAuContexte, budgetEntree, estimerTokens, resumerParTranches, sortieEffective } from "./contexte";

const u = (t: string): ModelMessage => ({ role: "user", content: t });
const a = (t: string): ModelMessage => ({ role: "assistant", content: t });

describe("ajusterAuContexte", () => {
  it("laisse intact ce qui tient", async () => {
    const r = await ajusterAuContexte([u("salut"), a("bonjour"), u("ça va ?")], { contexte: 2000, maxSortie: 200, systeme: "S" }, async () => "x");
    expect(r.resume).toBe(false);
    expect(r.messages).toHaveLength(3);
  });

  it("résume les anciens messages et garde les récents", async () => {
    const long = "mot ".repeat(400); // ≈ 500 tokens
    const msgs = [u("A " + long), a("B " + long), u("C " + long), a("D " + long), u("question finale")];
    const appels: ModelMessage[][] = [];
    const r = await ajusterAuContexte(
      msgs,
      { contexte: 1400, maxSortie: 200, systeme: "S" },
      async (anc) => {
        appels.push(anc);
        return "RÉSUMÉ";
      },
    );
    expect(r.resume).toBe(true);
    expect(r.systeme).toContain("RÉSUMÉ");
    expect(r.messages.at(-1)).toEqual(u("question finale"));
    expect(r.messages[0].role).toBe("user"); // ne commence pas par un assistant orphelin
    expect(appels.length).toBeGreaterThan(0);
    const totalRecents = r.messages.reduce((s, m) => s + estimerTokens(String(m.content)), 0);
    expect(totalRecents).toBeLessThan(1400);
  });

  it("tronque si le résumé échoue", async () => {
    const long = "mot ".repeat(400);
    const r = await ajusterAuContexte([u(long), a(long), u("fin")], { contexte: 800, maxSortie: 100, systeme: "" }, async () => {
      throw new Error("non");
    });
    expect(r.tronque).toBe(true);
    expect(r.messages.at(-1)).toEqual(u("fin"));
  });

  it("tronque un dernier message géant", async () => {
    const r = await ajusterAuContexte([u("x".repeat(20_000))], { contexte: 1000, maxSortie: 100, systeme: "" }, async () => "r");
    expect(r.tronque).toBe(true);
    expect(String(r.messages[0].content).length).toBeLessThan(4000);
  });
});

describe("resumerParTranches", () => {
  it("découpe en tranches puis fusionne", async () => {
    const msgs = Array.from({ length: 12 }, (_, i) => u(`m${i} ` + "bla ".repeat(150)));
    let n = 0;
    const r = await resumerParTranches(msgs, 500, async () => `r${n++}`);
    expect(n).toBeGreaterThan(1);
    expect(r).toContain("Partie 1");
  });
});

describe("sortieEffective / budget", () => {
  it("borne la sortie à la moitié de la fenêtre pour garder un budget d'entrée positif", () => {
    // Fenêtre 8192, maxSortie demandé 16384 → effectif ≤ 4096, budget > 0.
    expect(sortieEffective({ contexte: 8192, maxSortie: 16384, systeme: "" })).toBeLessThanOrEqual(4096);
    expect(budgetEntree({ contexte: 8192, maxSortie: 16384, systeme: "S" })).toBeGreaterThan(0);
  });

  it("fenêtre plus petite que maxSortie : message court conservé, pas tronqué", async () => {
    const r = await ajusterAuContexte([u("question courte")], { contexte: 8192, maxSortie: 16384, systeme: "S" }, async () => "x");
    expect(r.tronque).toBe(false);
    expect(r.maxSortie).toBeLessThanOrEqual(4096);
    expect((r.messages[0].content as string)).toBe("question courte");
  });
});
