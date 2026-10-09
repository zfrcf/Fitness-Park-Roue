import { describe, expect, it } from "vitest";
import { emailValide, estJetable, normaliserEmail } from "./email";
import { hacherMotDePasse, refusMotDePasse, verifierMotDePasse } from "./motdepasse";

describe("e-mails : une boîte = une seule forme", () => {
  it("ramène les variantes Gmail à la même adresse", () => {
    const base = "jeanmartin@gmail.com";
    for (const v of ["Jean.Martin@gmail.com", "jean.martin+test@gmail.com", "J.E.A.N.martin@googlemail.com", " jeanmartin@GMAIL.com "]) {
      expect(normaliserEmail(v)).toBe(base);
    }
  });
  it("retire le +suffixe partout mais garde les points hors Gmail", () => {
    expect(normaliserEmail("jean.martin+promo@orange.fr")).toBe("jean.martin@orange.fr");
    expect(normaliserEmail("jean.martin@orange.fr")).not.toBe(normaliserEmail("jeanmartin@orange.fr"));
  });
  it("valide la forme et repère les adresses jetables", () => {
    expect(emailValide("a@b.fr")).toBe(true);
    expect(emailValide("pas une adresse")).toBe(false);
    expect(emailValide("a@b")).toBe(false);
    expect(estJetable("x@yopmail.com")).toBe(true);
    expect(estJetable("x@abc.mailinator.com")).toBe(true);
    expect(estJetable("x@orange.fr")).toBe(false);
  });
});

describe("mots de passe", () => {
  it("hache et vérifie (sel aléatoire)", async () => {
    const h = await hacherMotDePasse("cheval-batterie-agrafe");
    expect(h).toMatch(/^scrypt\$/);
    expect(await hacherMotDePasse("cheval-batterie-agrafe")).not.toBe(h);
    expect(await verifierMotDePasse("cheval-batterie-agrafe", h)).toBe(true);
    expect(await verifierMotDePasse("cheval-batterie-agrafE", h)).toBe(false);
    expect(await verifierMotDePasse("x", "n'importe quoi")).toBe(false);
  });
  it("refuse les mots de passe faibles", () => {
    expect(refusMotDePasse("court", "a@b.fr")).toMatch(/10 caractères/);
    expect(refusMotDePasse("1234567890", "a@b.fr")).toMatch(/courant/);
    expect(refusMotDePasse("antoine-2026-salle", "antoine@b.fr")).toMatch(/adresse/);
    expect(refusMotDePasse("cheval-batterie-agrafe", "antoine@b.fr")).toBeNull();
  });
});
