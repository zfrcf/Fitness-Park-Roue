import { describe, expect, it } from "vitest";
import { indiceShell, transformerPip } from "./python-shell";

describe("console Python : aide terminal", () => {
  it("traduit pip install vers micropip", () => {
    const r = transformerPip("pip install requests numpy");
    expect(r.paquets).toEqual(["requests", "numpy"]);
    expect(r.code).toContain("micropip");
    expect(r.code).toContain("'requests'");
  });
  it("signale les paquets impossibles dans le navigateur (pyinstaller)", () => {
    const r = transformerPip("pip install pyinstaller");
    expect(r.impossibles).toContain("pyinstaller");
    expect(r.paquets).toEqual([]);
    expect(r.code).toContain("ne peut pas s'installer");
    expect(r.code).not.toContain("micropip");
  });
  it("ignore les options et gère -r requirements.txt", () => {
    expect(transformerPip("pip3 install -U rich").paquets).toEqual(["rich"]);
    expect(transformerPip("pip install -r requirements.txt").code).toContain("n'est pas géré");
  });
  it("laisse le vrai Python intact", () => {
    expect(transformerPip("print('hello')").code).toBe("print('hello')");
  });
  it("explique les commandes shell tapées par réflexe", () => {
    expect(indiceShell("ls -la", "SyntaxError: invalid syntax")).toMatch(/commande système/);
    expect(indiceShell("cd /tmp")).toMatch(/console Python/);
    expect(indiceShell("print('ok')")).toBeNull();
    expect(indiceShell("x = 1", "NameError")).toBeNull();
  });
});
