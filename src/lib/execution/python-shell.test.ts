import { describe, expect, it } from "vitest";
import { indiceShell, transformerCommandes, transformerPip } from "./python-shell";

const APPEL = 'await __import__("atelier_pip").pip(';

describe("console Python : commandes pip", () => {
  it("toutes les formes de pip deviennent un appel au module pip de la console", () => {
    for (const ligne of [
      "pip install requests numpy",
      "pip3 install -r requirements.txt",
      "!pip install -U pandas",
      "%pip install flask",
      "python -m pip install six",
      "python3.12 -m pip list",
      "py -m pip freeze",
      "pip --version",
      "pip",
      "pip uninstall -y six",
      "pip show requests",
      "pip install gradle",
    ]) {
      const r = transformerPip(ligne);
      expect(r.pip, ligne).toBe(true);
      expect(r.code.startsWith(APPEL), ligne).toBe(true);
    }
  });

  it("transmet les arguments intacts (guillemets, versions, extras, -r)", () => {
    expect(transformerPip('pip install "requests[socks]>=2.0" -r req.txt').code).toBe(`${APPEL}"install \\"requests[socks]>=2.0\\" -r req.txt")`);
    expect(transformerPip("pip install -r requirements.txt").code).toBe(`${APPEL}"install -r requirements.txt")`);
  });

  it("garde l'indentation et ne touche pas au vrai Python", () => {
    expect(transformerPip("if True:\n    pip install six").code).toBe(`if True:\n    ${APPEL}"install six")`);
    for (const py of ["pip = 3", "pip -= 1", "pip.install(x)", "print('pip install x')", "pipeline = 2", "x = pip", "print('hello')"]) {
      expect(transformerPip(py), py).toEqual({ code: py, pip: false });
    }
  });

  it("ne réécrit pas « pip install » écrit dans une chaîne triple", () => {
    const r = transformerPip('AIDE = """\npip install requests\n"""\npip install six');
    expect(r.code).toBe(`AIDE = """\npip install requests\n"""\n${APPEL}"install six")`);
    expect(transformerPip("x = '''pip'''\npip list").code).toBe(`x = '''pip'''\n${APPEL}"list")`);
  });
});

describe("console Python : aide terminal", () => {
  it("indiceShell : outils de build vs commandes shell vs Python valide", () => {
    expect(indiceShell("gradle build", "SyntaxError: invalid syntax")).toMatch(/Construire et tester/);
    expect(indiceShell("ls -la", "SyntaxError")).toMatch(/commande système/);
    expect(indiceShell("print('ok')")).toBeNull();
    expect(indiceShell("x = 1", "NameError")).toBeNull();
  });
});

describe("console Python : lancement de programmes", () => {
  const LANCER = 'await __import__("atelier_run").lancer(';
  it("python fichier.py, -c, -m, %run et ! deviennent un lancement", () => {
    for (const [ligne, args] of [
      ["python main.py", "main.py"],
      ["python3 jeu.py --niveau 2", "jeu.py --niveau 2"],
      ["!python outils/script.py", "outils/script.py"],
      ["%run analyse.py", "analyse.py"],
      ['python -c "print(1)"', '-c "print(1)"'],
      ["py -m calendar", "-m calendar"],
      ["python3.12 app.pyw", "app.pyw"],
      ["python", ""],
    ]) {
      const r = transformerCommandes(ligne);
      expect(r.python, ligne).toBe(true);
      expect(r.code, ligne).toBe(`${LANCER}${JSON.stringify(args)})`);
    }
  });
  it("ne touche pas au Python qui ressemble à une commande", () => {
    for (const py of ["python = 3", "py = 2", "run = True", "python.version", "print('python main.py')", "pythonista = 1", "run(x)"]) {
      expect(transformerCommandes(py), py).toEqual({ code: py, pip: false, python: false });
    }
  });
  it("mélange pip et lancement dans la même cellule, avec l'indentation", () => {
    const r = transformerCommandes("pip install six\nif True:\n    python main.py");
    expect(r).toEqual({ code: `await __import__("atelier_pip").pip("install six")\nif True:\n    ${LANCER}"main.py")`, pip: true, python: true });
  });
});
