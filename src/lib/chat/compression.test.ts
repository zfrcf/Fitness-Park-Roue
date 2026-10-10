import { describe, expect, it } from "vitest";
import { gunzipVersTexte, gzipTexte } from "./compression";

describe("compression gzip du corps", () => {
  it("compresse puis décompresse à l'identique", async () => {
    const texte = JSON.stringify({ fichiers: Array.from({ length: 50 }, (_, i) => ({ chemin: `src/f${i}.ts`, contenu: "export const x = 1;\n".repeat(200) })) });
    const gz = await gzipTexte(texte);
    expect(gz.length).toBeLessThan(texte.length / 4); // du code répétitif compresse beaucoup
    expect(await gunzipVersTexte(gz)).toBe(texte);
  });
  it("gère l'UTF-8 et les petites chaînes", async () => {
    const texte = "Bonjour à toi — café, €, 日本語, 🚀";
    expect(await gunzipVersTexte(await gzipTexte(texte))).toBe(texte);
  });
});
