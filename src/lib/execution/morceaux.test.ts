import { describe, expect, it } from "vitest";
import { ajouterMorceau, avecMorceau, dernierTexte, grouperMorceaux, imagesDe, texteDuFlux, type Morceau } from "./morceaux";

describe("ajouterMorceau", () => {
  it("garde l'ordre exact des textes, erreurs et images", () => {
    const l: Morceau[] = [];
    ajouterMorceau(l, { texte: "avant\n" });
    ajouterMorceau(l, { image: "data:1" });
    ajouterMorceau(l, { texte: "après\n" });
    ajouterMorceau(l, { texte: "oups\n", erreur: true });
    ajouterMorceau(l, { texte: "fin\n" });
    expect(l).toEqual([{ texte: "avant\n" }, { image: "data:1" }, { texte: "après\n" }, { texte: "oups\n", erreur: true }, { texte: "fin\n" }]);
  });

  it("prolonge le texte du même flux et ignore les textes vides", () => {
    const l: Morceau[] = [];
    ajouterMorceau(l, { texte: "a" });
    ajouterMorceau(l, { texte: "" });
    ajouterMorceau(l, { texte: "b" });
    ajouterMorceau(l, { texte: "x", erreur: true });
    ajouterMorceau(l, { texte: "y", erreur: true });
    expect(l).toEqual([{ texte: "ab" }, { texte: "xy", erreur: true }]);
  });

  it("remplace l'image précédente de la même figure (animation), pas celle d'une autre", () => {
    const l: Morceau[] = [];
    ajouterMorceau(l, { image: "f1-a", figure: 1 });
    ajouterMorceau(l, { image: "f1-b", figure: 1 });
    expect(l).toEqual([{ image: "f1-b", figure: 1 }]);
    ajouterMorceau(l, { image: "f2", figure: 2 });
    ajouterMorceau(l, { texte: "entre\n" });
    ajouterMorceau(l, { image: "f2-bis", figure: 2 });
    ajouterMorceau(l, { image: "sans-numero" });
    ajouterMorceau(l, { image: "sans-numero-2" });
    expect(imagesDe(l)).toEqual(["f1-b", "f2", "f2-bis", "sans-numero", "sans-numero-2"]);
  });

  it("ne modifie pas les morceaux déjà présents (états React)", () => {
    const premier = { texte: "a" };
    const l: Morceau[] = [premier];
    const copie = avecMorceau(l, { texte: "b" });
    expect(premier.texte).toBe("a");
    expect(l).toHaveLength(1);
    expect(copie).toEqual([{ texte: "ab" }]);
  });
});

describe("lecture des morceaux", () => {
  const l: Morceau[] = [{ texte: "1\n" }, { image: "i" }, { texte: "E\n", erreur: true }, { texte: "2" }];
  it("rassemble chaque flux", () => {
    expect(texteDuFlux(l)).toBe("1\n2");
    expect(texteDuFlux(l, true)).toBe("E\n");
    expect(imagesDe(l)).toEqual(["i"]);
  });
  it("donne le dernier texte affiché", () => {
    expect(dernierTexte(l)).toBe("2");
    expect(dernierTexte([{ image: "i" }])).toBe("");
  });
});

describe("grouperMorceaux", () => {
  it("réunit les textes consécutifs, coupe aux images", () => {
    const l: Morceau[] = [{ texte: "x" }, { texte: "\nTraceback", erreur: true }, { image: "i", figure: 1 }, { texte: "après\n" }];
    expect(grouperMorceaux(l)).toEqual({
      groupes: [{ textes: [{ texte: "x" }, { texte: "\nTraceback", erreur: true }] }, { image: "i" }, { textes: [{ texte: "après\n" }] }],
      tronque: false,
    });
  });
  it("limite le nombre de morceaux affichés", () => {
    const l: Morceau[] = Array.from({ length: 10 }, (_, i) => (i % 2 ? { texte: "e", erreur: true } : { texte: "s" }));
    const r = grouperMorceaux(l, 4);
    expect(r.tronque).toBe(true);
    expect(r.groupes).toHaveLength(1);
    expect("textes" in r.groupes[0] && r.groupes[0].textes).toHaveLength(4);
  });
});
