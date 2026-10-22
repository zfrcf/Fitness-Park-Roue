import { describe, expect, it } from "vitest";
import { estErreurFatale, nettoyerTraceback } from "./python-navigateur";

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
  it("retire les cadres internes du lanceur (asyncio.run, attentes)", () => {
    const brut = [
      "Traceback (most recent call last):",
      '  File "<exec>", line 3, in <module>',
      '  File "/lib/atelier/atelier_run.py", line 470, in _run',
      "    return _run_bloquant(main)",
      "           ^^^^^^^^^^^^^^^^^^^",
      '  File "/lib/atelier/atelier_run.py", line 455, in _run_bloquant',
      "    raise e",
      '  File "<exec>", line 2, in main',
      "ValueError: oups",
    ].join("\n");
    expect(nettoyerTraceback(brut)).toBe(['Traceback (most recent call last):', '  File "<exec>", line 3, in <module>', '  File "<exec>", line 2, in main', "ValueError: oups"].join("\n"));
  });
  it("laisse intact un message sans cadre interne", () => {
    expect(nettoyerTraceback("NameError: name 'x' is not defined")).toBe("NameError: name 'x' is not defined");
  });
});

describe("estErreurFatale", () => {
  it("reconnaît un interpréteur Pyodide planté", () => {
    expect(estErreurFatale(new Error("Pyodide already fatally failed and can no longer be used."))).toBe(true);
    expect(estErreurFatale(Object.assign(new RangeError("Maximum call stack size exceeded"), { pyodide_fatal_error: true }))).toBe(true);
    expect(estErreurFatale("Pyodide has suffered a fatal error. Please report this to the Pyodide maintainers.")).toBe(true);
  });
  it("ne confond pas avec une erreur ordinaire du programme", () => {
    expect(estErreurFatale(new Error("Traceback (most recent call last):\nValueError: fatal error in my code"))).toBe(false);
    expect(estErreurFatale(new Error("RecursionError: maximum recursion depth exceeded"))).toBe(false);
    expect(estErreurFatale(null)).toBe(false);
  });
});
