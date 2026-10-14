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
  it("laisse intact un message sans cadre interne", () => {
    expect(nettoyerTraceback("NameError: name 'x' is not defined")).toBe("NameError: name 'x' is not defined");
  });
});
