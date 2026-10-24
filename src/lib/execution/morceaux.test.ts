import { describe, expect, it, vi } from "vitest";
import { ajouterMorceau, avecMorceau, avecMorceaux, dernierTexte, grouperMorceaux, imagesDe, MARQUE_MASQUE, MAX_MORCEAUX, MAX_TEXTE, tamponMorceaux, texteDuFlux, type Morceau } from "./morceaux";

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
  it("au-delà de la limite, garde les DERNIERS morceaux (la fin de la sortie)", () => {
    const l: Morceau[] = Array.from({ length: 10 }, (_, i) => (i % 2 ? { texte: `e${i}`, erreur: true } : { texte: `s${i}` }));
    const r = grouperMorceaux(l, 4);
    expect(r.tronque).toBe(true);
    expect(r.groupes).toHaveLength(1);
    expect("textes" in r.groupes[0] && r.groupes[0].textes.map((t) => t.texte)).toEqual(["s6", "e7", "s8", "e9"]);
    expect(grouperMorceaux(l, 10).tronque).toBe(false);
  });
});

describe("mémoire bornée (programme qui affiche sans fin)", () => {
  it("garde la fin du texte, marque le début masqué, à coût amorti", () => {
    const l: Morceau[] = [];
    for (let i = 0; i < 60_000; i++) ajouterMorceau(l, { texte: `ligne ${i}\n` });
    const t = texteDuFlux(l);
    expect(t.length).toBeLessThanOrEqual(2 * MAX_TEXTE + MARQUE_MASQUE.length);
    expect(t.startsWith(MARQUE_MASQUE)).toBe(true);
    expect(t.endsWith("ligne 59999\n")).toBe(true);
    expect(t.slice(MARQUE_MASQUE.length).startsWith("ligne ")).toBe(true); // coupé à une fin de ligne
  });
  it("borne le nombre de morceaux quand sortie et erreurs alternent", () => {
    const l: Morceau[] = [];
    for (let i = 0; i < 5 * MAX_MORCEAUX; i++) ajouterMorceau(l, i % 2 ? { texte: "e", erreur: true } : { texte: "s" });
    expect(l.length).toBeLessThanOrEqual(2 * MAX_MORCEAUX);
    expect(l[0]).toEqual({ texte: MARQUE_MASQUE });
    expect(l[l.length - 1]).toEqual({ texte: "e", erreur: true });
  });
});

describe("tamponMorceaux", () => {
  it("une rafale d'écritures donne une seule mise à jour, abandonner oublie l'attente", () => {
    vi.useFakeTimers();
    try {
      const recus: Morceau[][] = [];
      const t = tamponMorceaux((ms) => recus.push(ms));
      for (let i = 0; i < 1000; i++) t.ajouter({ texte: "x" });
      t.ajouter({ image: "i" });
      vi.advanceTimersByTime(20);
      expect(recus).toEqual([[{ texte: "x".repeat(1000) }, { image: "i" }]]);
      t.ajouter({ texte: "perdu" });
      t.abandonner();
      vi.advanceTimersByTime(20);
      t.ajouter({ texte: "tardif" });
      vi.advanceTimersByTime(20);
      expect(recus.slice(1)).toEqual([[{ texte: "tardif" }]]);
      expect(avecMorceaux([{ texte: "a" }], [{ texte: "b" }, { image: "i" }])).toEqual([{ texte: "ab" }, { image: "i" }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
