import { describe, expect, it } from "vitest";
import { assainirJson, sansNul } from "./conversations";

describe("assainissement du caractère NUL (Postgres le rejette)", () => {
  it("sansNul retire le NUL d'une chaîne", () => {
    expect(sansNul("a\u0000b")).toBe("ab");
    expect(sansNul("propre")).toBe("propre");
  });
  it("assainirJson retire le NUL dans des valeurs imbriquées (échappé en JSON)", () => {
    const r = assainirJson([{ type: "text", text: "pdf\u0000 sale" }, { type: "data", d: { x: "y\u0000z" } }]);
    expect(JSON.stringify(r)).not.toContain("\\u0000");
    expect((r[0] as { text: string }).text).toBe("pdf sale");
    expect((r[1] as { d: { x: string } }).d.x).toBe("yz");
  });
  it("laisse les valeurs propres intactes", () => {
    const v = [{ type: "text", text: "ok" }];
    expect(assainirJson(v)).toEqual(v);
  });
});
