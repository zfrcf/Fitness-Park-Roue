/**
 * Le module pip de la console (Python) exécuté pour de vrai en CPython, avec un faux micropip qui
 * imite l'API de micropip 0.6.0 (install / uninstall, erreurs réelles) et installe des paquets
 * factices dans un dossier temporaire. La vérification en Pyodide réel se fait à la main.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOURCE_PIP, codeChargementPip } from "./pip-console";

const python = spawnSync("python3", ["-c", "import packaging"], { encoding: "utf-8" }).status === 0 ? "python3" : null;

const FAUX_MICROPIP = String.raw`
import os, re, shutil
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

__version__ = "0.6.0"
SITE = os.environ["SITE"]
APPELS = []
CATALOGUE = {
    "requests": ("2.31.0", ["urllib3", "idna"]), "urllib3": ("2.2.1", []), "idna": ("3.7", []),
    "six": ("1.16.0", []), "attrs": ("23.2.0", []), "colorama": ("0.4.6", []),
    "flask": ("3.0.0", ["werkzeug"]), "werkzeug": ("3.0.1", []), "monpaquet": ("1.0", []),
    "rich": ("13.7.1", ["pygments", "markdown-it-py"]), "pygments": ("2.17.2", []),
    "markdown-it-py": ("3.0.0", ["mdurl"]), "mdurl": ("0.1.2", []), "outil": ("1.0", ["torch"]),
}
NATIFS = {"torch", "pyinstaller"}
# Comme dans la distribution Pyodide : livrés sans leurs dépendances, bien qu'elles soient déclarées.
SANS_DEPS = {"rich", "outil"}

def _dossier(nom):
    for d in os.listdir(SITE):
        if d.endswith(".dist-info") and canonicalize_name(d[:-10].rsplit("-", 1)[0]) == nom:
            return os.path.join(SITE, d)

def _version(nom):
    d = _dossier(nom)
    return d and os.path.basename(d)[:-10].rsplit("-", 1)[1]

def ecrire(nom, version, deps=()):
    d = os.path.join(SITE, f"{nom}-{version}.dist-info")
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "METADATA"), "w") as f:
        f.write(f"Metadata-Version: 2.1\nName: {nom}\nVersion: {version}\nSummary: paquet {nom}\n")
        for dep in deps:
            f.write(f"Requires-Dist: {dep}\n")

async def install(requirements, keep_going=False, deps=True, credentials=None, pre=False, index_urls=None, *, verbose=False):
    reqs = [requirements] if isinstance(requirements, str) else list(requirements)
    APPELS.append({"reqs": reqs, "deps": deps, "pre": pre, "index_urls": index_urls})
    plan, echecs = [], []
    for brut in reqs:
        if brut.startswith("emfs:"):
            nom, version = os.path.basename(brut[5:]).split("-")[:2]
            plan.append((canonicalize_name(nom), version))
            continue
        r = Requirement(brut)
        if r.marker is not None and not r.marker.evaluate({"extra": ""}):
            continue
        nom = canonicalize_name(r.name)
        if nom == "introuvable-texte":
            raise ValueError("Unsupported content type: text/plain; charset=utf-8")
        if nom in NATIFS or nom not in CATALOGUE:
            msg = f"Can't find a pure Python 3 wheel for '{brut}'." if nom in NATIFS else f"Can't fetch metadata for '{nom}'."
            if keep_going:
                echecs.append(msg)
                continue
            raise ValueError(msg)
        version, dependances = CATALOGUE[nom]
        actuelle = _version(nom)
        if actuelle and r.specifier and not r.specifier.contains(actuelle, prereleases=True):
            raise ValueError(f"Requested '{brut}', but {nom}=={actuelle} is already installed")
        plan.append((nom, version))
        if deps and nom not in SANS_DEPS:
            plan.extend((d, CATALOGUE[d][0]) for d in dependances)
    if echecs:
        raise ValueError("Can't find a pure Python 3 wheel for: " + ", ".join(echecs))
    for nom, version in plan:
        if not _version(nom):
            ecrire(nom, version, CATALOGUE.get(nom, ("", []))[1])

def uninstall(packages, *, verbose=False):
    for p in [packages] if isinstance(packages, str) else packages:
        d = _dossier(canonicalize_name(p))
        if d:
            shutil.rmtree(d)
`;

const PILOTE = String.raw`
import asyncio, importlib.metadata as meta, json, os, sys
sys.path.insert(0, os.environ["MODULES"])
exec(open(os.environ["CHARGEMENT"]).read())
import atelier_pip, micropip
SITE = os.environ["SITE"]
atelier_pip._distributions = lambda: meta.distributions(path=[SITE])
def _distribution(n):
    for d in meta.distributions(name=n, path=[SITE]):
        return d
    raise meta.PackageNotFoundError(n)
atelier_pip._distribution = _distribution
for nom, version in json.loads(os.environ.get("PREINSTALLES", "[]")):
    micropip.ecrire(nom, version)
os.chdir(os.environ["PROJET"])
async def principal():
    for c in json.loads(sys.argv[1]):
        print("### " + c)
        await atelier_pip.pip(c)
    print("### APPELS")
    print(json.dumps(micropip.APPELS))
asyncio.run(principal())
`;

let racine = "";

/** Lance une suite de commandes pip ; renvoie la sortie de chacune, plus les appels faits à micropip. */
function lancer(commandes: string[], fichiers: Record<string, string> = {}, preinstalles: [string, string][] = []) {
  const dossier = mkdtempSync(path.join(racine, "cas-"));
  const [modules, site, projet] = ["modules", "site", "projet"].map((d) => path.join(dossier, d));
  for (const d of [path.join(modules, "micropip"), site, projet]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(modules, "micropip", "__init__.py"), FAUX_MICROPIP);
  writeFileSync(path.join(dossier, "chargement.py"), codeChargementPip());
  writeFileSync(path.join(dossier, "pilote.py"), PILOTE);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(projet, chemin)), { recursive: true });
    writeFileSync(path.join(projet, chemin), contenu);
  }
  const sortie = execFileSync(python!, [path.join(dossier, "pilote.py"), JSON.stringify(commandes)], {
    encoding: "utf-8",
    env: { ...process.env, MODULES: modules, SITE: site, PROJET: projet, CHARGEMENT: path.join(dossier, "chargement.py"), PREINSTALLES: JSON.stringify(preinstalles) },
  });
  const blocs = new Map<string, string>();
  for (const bloc of sortie.split("### ").slice(1)) {
    const i = bloc.indexOf("\n");
    blocs.set(bloc.slice(0, i), bloc.slice(i + 1).trim());
  }
  return { sortie: (c: string) => blocs.get(c) ?? "", appels: JSON.parse(blocs.get("APPELS") ?? "[]") as { reqs: string[]; deps: boolean; pre: boolean; index_urls: string[] | null }[] };
}

describe.skipIf(!python)("pip de la console (module Python réel, micropip simulé)", () => {
  beforeAll(() => {
    racine = mkdtempSync(path.join(tmpdir(), "pip-console-"));
  });
  afterAll(() => rmSync(racine, { recursive: true, force: true }));

  it("le source ne contient rien qui casse le gabarit TS", () => {
    expect(SOURCE_PIP).not.toContain("`");
    expect(SOURCE_PIP).toContain("async def pip(");
  });

  it("pip install -r requirements.txt : commentaires, suites de ligne, marqueurs, -r imbriqué, hash, échecs isolés", () => {
    const requirements = [
      "# dépendances du projet",
      "requests==2.31.0  # client HTTP",
      "six \\",
      "  >=1.0",
      'pywin32==306 ; sys_platform == "win32"',
      "-r dev/extra.txt",
      "torch",
      "attrs --hash=sha256:abc123",
      "-e .",
      "gradle",
      "git+https://github.com/exemple/projet.git",
      "--pre",
      "",
    ].join("\n");
    const { sortie, appels } = lancer(["install -r requirements.txt"], { "requirements.txt": requirements, "dev/extra.txt": "colorama\n" });
    const s = sortie("install -r requirements.txt");
    expect(s).toMatch(/^Installé : .*attrs 23\.2\.0.*colorama 0\.4\.6.*idna 3\.7.*requests 2\.31\.0.*six 1\.16\.0.*urllib3 2\.2\.1/m);
    expect(s).toMatch(/ÉCHEC : torch — aucune version installable dans le navigateur.*trop lourde/);
    expect(s).toMatch(/Ignoré : pywin32==306 ; sys_platform == "win32" — réservé à une autre plateforme/);
    expect(s).toMatch(/Ignoré : gradle — ce n'est pas un paquet Python.*Construire et tester/);
    expect(s).toMatch(/Ignoré : git\+https.*dépôt de sources/);
    expect(s).toMatch(/« -e \. » ignoré/);
    expect(s).toMatch(/Terminé : 6 installé\(s\), 1 échec\(s\), 3 ignoré\(s\)\./);
    expect(appels[0].pre).toBe(true);
    expect(appels[0].reqs).toEqual(["requests==2.31.0", "six >=1.0", "colorama", "torch", "attrs"]);
  });

  it("-r : fichier rangé dans un sous-dossier trouvé par son nom ; fichier absent expliqué", () => {
    const { sortie } = lancer(["install -r requirements.txt"], { "backend/requirements.txt": "six\n" });
    expect(sortie("install -r requirements.txt")).toMatch(/« requirements\.txt » trouvé dans backend\/requirements\.txt\.\nInstallé : six 1\.16\.0/);
    const absent = lancer(["install -r requirements.txt"]).sortie("install -r requirements.txt");
    expect(absent).toMatch(/ERREUR : fichier « requirements\.txt » introuvable/);
    expect(absent).toMatch(/Importer des fichiers/);
  });

  it("déjà installé, désinstallation, -qU groupés, --no-deps puis check", () => {
    const cmds = ["install six", "install six", "uninstall -y six", "install -qU six", "install --no-deps flask", "check"];
    const { sortie } = lancer(cmds);
    expect(sortie("install six")).toContain("Déjà installé : six 1.16.0");
    expect(sortie("uninstall -y six")).toBe("Désinstallé : six 1.16.0");
    expect(sortie("install -qU six")).toBe("");
    expect(sortie("install --no-deps flask")).toMatch(/^Installé : flask 3\.0\.0\nTerminé/);
    expect(sortie("check")).toBe("flask 3.0.0 requiert werkzeug, qui n'est pas installé.");
  });

  it("complète les dépendances qu'une distribution ne livre pas, et signale celles qui échouent", () => {
    const { sortie } = lancer(["install rich", "check", "install outil", "install introuvable-texte"]);
    expect(sortie("install rich")).toMatch(/^Installé : markdown-it-py 3\.0\.0, mdurl 0\.1\.2, pygments 2\.17\.2, rich 13\.7\.1$/m);
    expect(sortie("check")).toBe("Aucune dépendance cassée.");
    expect(sortie("install outil")).toMatch(/ATTENTION : dépendance torch \(requise par outil\) non installée — aucune version installable/);
    expect(sortie("install introuvable-texte")).toMatch(/ÉCHEC : introuvable-texte — introuvable sur l'index des paquets \(PyPI\) : vérifiez le nom/);
  });

  it("autre version déjà chargée : remplacée comme le ferait pip", () => {
    const { sortie } = lancer(['install "attrs>=23"'], {}, [["attrs", "21.0"]]);
    const s = sortie('install "attrs>=23"');
    expect(s).toContain("Installé : attrs 23.2.0");
    expect(s).toMatch(/Version changée pour attrs/);
  });

  it("list, freeze, show, --version, help, index, wheel locale, commandes indisponibles", () => {
    const cmds = [
      "install requests",
      "list",
      "list --format=freeze",
      "freeze",
      "show requests",
      "show inexistant",
      "--version",
      "help",
      "-i https://exemple.org/simple --extra-index-url https://autre.org/simple install six",
      "install ./monpaquet-1.0-py3-none-any.whl",
      "install --upgrade pip",
      "download six",
      "frobnique",
      "install",
      "install inconnu-xyz",
    ];
    const { sortie, appels } = lancer(cmds, { "monpaquet-1.0-py3-none-any.whl": "wheel" });
    expect(sortie("list")).toMatch(/^Package +Version\n-+ -+\nidna +3\.7\nrequests +2\.31\.0\nurllib3 +2\.2\.1$/);
    expect(sortie("list --format=freeze")).toBe("idna==3.7\nrequests==2.31.0\nurllib3==2.2.1");
    expect(sortie("freeze")).toBe("idna==3.7\nrequests==2.31.0\nurllib3==2.2.1");
    expect(sortie("show requests")).toMatch(/Name: requests\nVersion: 2\.31\.0\nSummary: paquet requests[\s\S]*Requires: idna, urllib3\nRequired-by:$/);
    expect(sortie("show inexistant")).toBe("ATTENTION : paquet introuvable : inexistant");
    expect(sortie("--version")).toMatch(/^pip \(micropip 0\.6\.0\) — Python 3/);
    expect(sortie("help")).toMatch(/^Usage : pip <commande>/);
    expect(appels.find((a) => a.reqs.includes("six"))?.index_urls).toEqual(["https://exemple.org/simple", "https://autre.org/simple"]);
    expect(appels.some((a) => a.reqs.some((r) => r.startsWith("emfs:/") && r.endsWith("monpaquet-1.0-py3-none-any.whl")))).toBe(true);
    expect(sortie("install --upgrade pip")).toMatch(/Ignoré : pip — le pip de la console est toujours à jour/);
    expect(sortie("download six")).toMatch(/« pip download » n'est pas disponible/);
    expect(sortie("frobnique")).toMatch(/commande inconnue « frobnique »/);
    expect(sortie("install")).toMatch(/^ERREUR : indiquez au moins un paquet/);
    expect(sortie("install inconnu-xyz")).toMatch(/ÉCHEC : inconnu-xyz — introuvable sur l'index des paquets/);
  });
});
