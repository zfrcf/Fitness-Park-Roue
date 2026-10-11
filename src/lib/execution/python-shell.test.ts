import { describe, expect, it } from "vitest";
import { indiceShell, messageMicropip, transformerPip } from "./python-shell";

describe("console Python : aide terminal", () => {
  it("traduit pip install vers micropip pour les vrais paquets", () => {
    const r = transformerPip("pip install requests numpy");
    expect(r.paquets).toEqual(["requests", "numpy"]);
    expect(r.code).toContain("micropip");
  });
  it("pip install d'un outil de build renvoie vers le bouton Construire, sans micropip", () => {
    const r = transformerPip("pip install gradle");
    expect(r.paquets).toEqual([]);
    expect(r.code).not.toContain("micropip");
    expect(r.code).toContain("Construire et tester");
  });
  it("signale les paquets impossibles dans le navigateur (pyinstaller)", () => {
    const r = transformerPip("pip install pyinstaller");
    expect(r.paquets).toEqual([]);
    expect(r.code).toContain("pyinstaller");
    expect(r.code).toContain("navigateur");
  });
  it("gère -r requirements.txt et laisse le vrai Python intact", () => {
    expect(transformerPip("pip install -r requirements.txt").code).toContain("un par un");
    expect(transformerPip("print(\'hello\')").code).toBe("print(\'hello\')");
  });
  it("indiceShell : outils de build vs commandes shell vs Python valide", () => {
    expect(indiceShell("gradle build", "SyntaxError: invalid syntax")).toMatch(/Construire et tester/);
    expect(indiceShell("ls -la", "SyntaxError")).toMatch(/commande système/);
    expect(indiceShell("print(\'ok\')")).toBeNull();
    expect(indiceShell("x = 1", "NameError")).toBeNull();
  });
  it("messageMicropip : erreur d'installation rendue claire", () => {
    expect(messageMicropip("ValueError: Unsupported content type: text/plain", ["gradle"])).toMatch(/pas disponible pour le navigateur/);
    expect(messageMicropip("autre erreur", ["numpy"])).toBeNull();
    expect(messageMicropip("Unsupported content type", [])).toBeNull();
  });
});
