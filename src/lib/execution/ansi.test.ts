import { describe, expect, it } from "vitest";
import { lignesAffichees, lignesAnsi, segmentsAnsi, texteLigne, tronquerLignes } from "./ansi";

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
  it("garde la FIN, comme un terminal, et dit combien de lignes sont masquées", () => {
    const r = tronquerLignes(lignesAnsi("1\n2\n3\n4"), 2, 1000);
    expect(r.lignes.map(texteLigne)).toEqual(["3", "4"]);
    expect(r.avertissement).toBe("[… 2 lignes masquées]");
    expect(r.position).toBe(0);
  });

  it("garde aussi les lignes d'en-tête demandées, l'avertissement entre les deux", () => {
    const r = tronquerLignes(lignesAnsi("T\na\nb\nc\nd\nErreur"), 3, 1000, 1);
    expect(r.lignes.map(texteLigne)).toEqual(["T", "d", "Erreur"]);
    expect(r.position).toBe(1);
    expect(r.avertissement).toBe("[… 3 lignes masquées]");
  });

  it("limite le nombre de caractères en partant de la fin", () => {
    const r = tronquerLignes(lignesAnsi("abcd\n\x1b[31mefgh\x1b[0m"), 10, 7);
    expect(r.lignes.map(texteLigne)).toEqual(["efgh"]);
    expect(r.lignes[0][0].couleur).toBeTruthy();
    expect(r.avertissement).toBe("[… 1 ligne masquée]");
  });

  it("garde la fin d'une dernière ligne trop longue", () => {
    const r = tronquerLignes(lignesAnsi("x".repeat(20) + "FIN"), 10, 5);
    expect(r.lignes.map(texteLigne)).toEqual(["xxFIN"]);
    expect(r.avertissement).toBe("[… début de la ligne masqué]");
  });

  it("ne dit rien quand tout tient", () => {
    const r = tronquerLignes(lignesAnsi("a\nb"), 10, 100);
    expect(r.avertissement).toBeNull();
    expect(r.position).toBe(2);
  });
});

describe("lignesAffichees", () => {
  it("500 lignes puis le résultat : le résultat est la dernière ligne affichée", () => {
    const texte = Array.from({ length: 500 }, (_, i) => `ligne ${i + 1}`).join("\n") + "\nRÉSULTAT FINAL = 42\n";
    const r = lignesAffichees(texte, 400, 40_000);
    const vues = r.lignes.map(texteLigne);
    expect(vues[vues.length - 2]).toBe("RÉSULTAT FINAL = 42");
    expect(vues).toHaveLength(400);
    expect(r.avertissement).toBe("[… 102 lignes masquées]");
  });

  it("traceback de 1000 lignes : en-tête et dernière ligne (l'erreur) visibles", () => {
    const cadres = Array.from({ length: 500 }, (_, i) => `  File "<exec>", line ${i % 2 ? 8 : 5}, in ${i % 2 ? "impair" : "pair"}\n    return f(n - 1)`).join("\n");
    const texte = `Traceback (most recent call last):\n  File "<exec>", line 10, in <module>\n    pair(5000)\n${cadres}\nRecursionError: maximum recursion depth exceeded`;
    const r = lignesAffichees(texte, 80, 6000, 3);
    const vues = r.lignes.map(texteLigne);
    expect(vues[0]).toBe("Traceback (most recent call last):");
    expect(r.position).toBe(3);
    expect(vues[vues.length - 1]).toBe("RecursionError: maximum recursion depth exceeded");
    expect(vues.length).toBeLessThanOrEqual(80);
    // Lignes masquées : toutes celles qui ne sont pas affichées.
    expect(r.avertissement).toBe(`[… ${texte.split("\n").length - vues.length} lignes masquées]`);
  });

  it("80 lignes de journal puis une exception sur stderr : l'exception reste visible", () => {
    const texte = Array.from({ length: 80 }, (_, i) => `INFO:root:traitement de l'élément ${i}`).join("\n") + "\nTraceback (most recent call last):\n  File \"<exec>\", line 5, in <module>\nValueError: donnée invalide à la fin\n";
    const vues = lignesAffichees(texte, 60, 4000, 3).lignes.map(texteLigne);
    expect(vues).toContain("ValueError: donnée invalide à la fin");
  });

  it("donne le même résultat que tronquerLignes sur un texte court, et reste rapide sur un texte énorme", () => {
    const court = "a\nb\nc\nd";
    expect(lignesAffichees(court, 2, 100)).toEqual(tronquerLignes(lignesAnsi(court), 2, 100));
    const enorme = Array.from({ length: 200_000 }, (_, i) => `ligne ${i}`).join("\n");
    const debut = performance.now();
    const r = lignesAffichees(enorme, 400, 40_000);
    expect(performance.now() - debut).toBeLessThan(200);
    expect(texteLigne(r.lignes[r.lignes.length - 1])).toBe("ligne 199999");
    expect(r.avertissement).toBe(`[… ${200_000 - 400} lignes masquées]`);
  });

  it("une seule ligne immense (barre de progression sans fin de ligne) : sa fin", () => {
    const r = lignesAffichees("#".repeat(100_000) + " 100%", 400, 1000);
    expect(texteLigne(r.lignes[0]).endsWith(" 100%")).toBe(true);
    expect(texteLigne(r.lignes[0])).toHaveLength(1000);
  });
});
