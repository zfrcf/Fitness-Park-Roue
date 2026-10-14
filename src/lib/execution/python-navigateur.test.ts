import { describe, expect, it } from "vitest";
import { nettoyerTraceback } from "./python-navigateur";

describe("nettoyerTraceback", () => {
  it("retire les cadres internes de Pyodide et garde ceux du programme", () => {
    const brut = [
      "Traceback (most recent call last):",
      '  File "/lib/python312.zip/_pyodide/_base.py", line 574, in eval_code_async',
      "    await CodeRunner(",
      '  File "/lib/python312.zip/_pyodide/_base.py", line 396, in run_async',
      "    coroutine = eval(self.code, globals, locals)",
      "                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
      '  File "<exec>", line 2, in <module>',
      '  File "<exec>", line 1, in f',
      "ZeroDivisionError: division by zero",
    ].join("\n");
    expect(nettoyerTraceback(brut)).toBe(
      ['Traceback (most recent call last):', '  File "<exec>", line 2, in <module>', '  File "<exec>", line 1, in f', "ZeroDivisionError: division by zero"].join("\n"),
    );
  });
  it("retire aussi le cadre de l'exécuteur de cellules de la console", () => {
    const brut = [
      "Traceback (most recent call last):",
      '  File "/lib/atelier/atelier_run.py", line 312, in cellule',
      '    return await eval_code_async(code, __main__.__dict__, filename="<exec>")',
      "           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
      '  File "/lib/python312.zip/_pyodide/_base.py", line 597, in eval_code_async',
      "    await CodeRunner(",
      '  File "<exec>", line 1, in <module>',
      "ValueError: boum",
    ].join("\n");
    expect(nettoyerTraceback(brut)).toBe(['Traceback (most recent call last):', '  File "<exec>", line 1, in <module>', "ValueError: boum"].join("\n"));
  });
  it("garde un fichier du programme nommé comme le lanceur", () => {
    const brut = ['  File "/home/pyodide/atelier_run.py", line 3, in main', "    x()"].join("\n");
    expect(nettoyerTraceback(brut)).toBe(brut.trim());
  });
  it("laisse intact un message sans cadre interne", () => {
    expect(nettoyerTraceback("NameError: name 'x' is not defined")).toBe("NameError: name 'x' is not defined");
  });
});
