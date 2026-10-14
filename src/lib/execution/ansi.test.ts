import { describe, expect, it } from "vitest";
import { lignesAnsi, segmentsAnsi, texteLigne, tronquerLignes } from "./ansi";

const texteDe = (texte: string) => lignesAnsi(texte).map(texteLigne).join("\n");

describe("segmentsAnsi", () => {
  it("laisse intact un texte sans séquence", () => {
    expect(segmentsAnsi("bonjour\nle monde")).toEqual([{ texte: "bonjour\nle monde" }]);
    expect(segmentsAnsi("")).toEqual([]);
  });

  it("interprète les couleurs de base, claires, le gras et la remise à zéro", () => {
    const s = segmentsAnsi("\x1b[31mrouge\x1b[0m normal \x1b[1;92mvif\x1b[39m gras\x1b[22m fin");
    expect(s.map((x) => x.texte)).toEqual(["rouge", " normal ", "vif", " gras", " fin"]);
    expect(s[0].couleur).toBeTruthy();
    expect(s[0].gras).toBeUndefined();
    expect(s[1]).toEqual({ texte: " normal " });
    expect(s[2].gras).toBe(true);
    expect(s[2].couleur).toBeTruthy();
    expect(s[2].couleur).not.toBe(s[0].couleur);
    expect(s[3]).toEqual({ texte: " gras", gras: true });
    expect(s[4]).toEqual({ texte: " fin" });
  });

  it("« ESC[m » seul remet à zéro et 39 ne retire que la couleur", () => {
    const s = segmentsAnsi("\x1b[1;34ma\x1b[mb\x1b[1;33mc\x1b[39md");
    expect(s[1]).toEqual({ texte: "b" });
    expect(s[3]).toEqual({ texte: "d", gras: true });
  });

  it("gère les couleurs 256 et vraies couleurs, ignore le fond", () => {
    const s = segmentsAnsi("\x1b[38;5;196mA\x1b[38;2;10;20;30mB\x1b[48;5;21mC\x1b[0m");
    expect(s[0].couleur).toMatch(/^rgb\(/);
    expect(s[1].couleur).toBe("rgb(10,20,30)");
    expect(s[1].texte).toBe("BC");
  });

  it("garde le style d'une ligne à l'autre", () => {
    const s = segmentsAnsi("\x1b[32mun\ndeux\x1b[0m");
    expect(s).toHaveLength(1);
    expect(s[0].texte).toBe("un\ndeux");
  });
});

describe("lignesAnsi", () => {
  it("réécrit la ligne après un retour chariot (barre de progression)", () => {
    expect(texteDe("10%\r20%\r100%\nfini")).toBe("100%\nfini");
    expect(lignesAnsi("a\r\nb")).toHaveLength(2);
    expect(texteDe("a\r\nb")).toBe("a\nb");
  });

  it("garde la fin d'une ligne plus longue, comme un terminal, sauf ESC[K", () => {
    expect(texteDe("chargement…\rok")).toBe("okargement…");
    expect(texteDe("chargement…\r\x1b[Kok")).toBe("ok");
    expect(texteDe("abc\x1b[2Kx")).toBe("   x");
  });

  it("recule avec \\b et ignore les autres séquences", () => {
    expect(texteDe("ab\bc")).toBe("ac");
    expect(texteDe("\x1b]0;titre\x07x\x1b[2Ay\x07")).toBe("xy");
  });

  it("colore les cellules réécrites avec le style courant", () => {
    const [ligne] = lignesAnsi("....\r\x1b[31mOK\x1b[0m");
    expect(ligne.map((s) => s.texte)).toEqual(["OK", ".."]);
    expect(ligne[0].couleur).toBeTruthy();
    expect(ligne[1].couleur).toBeUndefined();
  });

  it("autant de lignes que split('\\n')", () => {
    expect(lignesAnsi("a\nb\n")).toHaveLength(3);
    expect(lignesAnsi("")).toEqual([[]]);
  });

  it("ne plante pas sur une séquence incomplète", () => {
    expect(texteDe("ok\x1b[31")).toBe("ok");
    expect(texteDe("ok\x1b")).toBe("ok");
  });
});

describe("tronquerLignes", () => {
  it("limite le nombre de lignes", () => {
    const r = tronquerLignes(lignesAnsi("1\n2\n3\n4"), 2, 1000);
    expect(r.lignes.map(texteLigne)).toEqual(["1", "2"]);
    expect(r.avertissement).toBe("[… 2 lignes de plus]");
  });

  it("limite le nombre de caractères en coupant la ligne", () => {
    const r = tronquerLignes(lignesAnsi("abcd\n\x1b[31mefgh\x1b[0m"), 10, 7);
    expect(r.lignes.map(texteLigne)).toEqual(["abcd", "ef"]);
    expect(r.lignes[1][0].couleur).toBeTruthy();
    expect(r.avertissement).toBe("[… sortie tronquée]");
  });

  it("ne dit rien quand tout tient", () => {
    expect(tronquerLignes(lignesAnsi("a\nb"), 10, 100).avertissement).toBeNull();
  });
});
