import { describe, expect, it } from "vitest";
import type { MessageUI } from "@/lib/chat/types";
import { allegerHistorique, cheminSur, estBinaire, filtrerArchive, rehydraterHistorique, retirerRacineCommune, URL_ALLEGEE } from "./pieces-jointes";

const t = (s: string) => new TextEncoder().encode(s);

describe("chemins et archives", () => {
  it("refuse les chemins dangereux, normalise les autres", () => {
    expect(cheminSur("../etc/passwd")).toBeNull();
    expect(cheminSur("/abs/x.py")).toBeNull();
    expect(cheminSur("C:\\\\x.py")).toBeNull();
    expect(cheminSur("./src\\\\main.py")).toBe("src/main.py");
  });
  it("retire le dossier racine commun", () => {
    expect(retirerRacineCommune(["projet/a.py", "projet/src/b.py"])).toEqual(["a.py", "src/b.py"]);
    expect(retirerRacineCommune(["a.py", "src/b.py"])).toEqual(["a.py", "src/b.py"]);
  });
  it("détecte les binaires et l'UTF-8 invalide", () => {
    expect(estBinaire(t("print('é')\n"))).toBe(false);
    expect(estBinaire(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]))).toBe(true);
    expect(estBinaire(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(true);
  });
  it("garde le code d'une archive, écarte sorties, dépendances et binaires", () => {
    const r = filtrerArchive(
      [
        { chemin: "app/main.py", octets: t("print(1)") },
        { chemin: "app/node_modules/x/index.js", octets: t("x") },
        { chemin: "app/build/out.txt", octets: t("x") },
        { chemin: "app/logo.png", octets: new Uint8Array([0x89, 0x50, 0, 0]) },
        { chemin: "app/donnees.bin", octets: new Uint8Array([1, 0, 2]) },
        { chemin: "app/../evasion.py", octets: t("x") },
      ],
      "app.zip",
    );
    expect(r.fichiers.map((f) => f.chemin)).toEqual(["main.py"]);
    expect(r.fichiers[0]).toMatchObject({ contenu: "print(1)", genre: "code", origine: "app.zip" });
    expect(r.ignores).toEqual(["app/donnees.bin (binaire)", "app/../evasion.py (chemin refusé)"]);
  });
});

describe("historique allégé pour l'envoi, puis repris en base", () => {
  const image = { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AAAA", filename: "a.jpg" } as const;
  const joints = { type: "data-fichiers-joints", data: { fichiers: [{ chemin: "a.py", contenu: "print(1)", taille: 8, genre: "code" }] } } as const;
  const enBase: MessageUI[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Regarde" }, image, joints] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "Vu." }, { type: "data-image", data: { url: "data:image/jpeg;base64,BBBB", prompt: "pomme", source: "cloudflare" } }] },
  ] as unknown as MessageUI[];
  const dernier = { id: "u2", role: "user", parts: [{ type: "text", text: "Et celle-ci ?" }, image] } as unknown as MessageUI;

  it("n'envoie le contenu lourd qu'avec le dernier message", () => {
    const allege = allegerHistorique([...enBase, dernier]);
    expect((allege[0].parts[1] as { url: string }).url).toBe(URL_ALLEGEE);
    expect((allege[0].parts[2] as { data: { allege: boolean; fichiers: Array<{ contenu: string }> } }).data).toMatchObject({ allege: true, fichiers: [{ contenu: "" }] });
    expect((allege[1].parts[1] as { data: { url: string } }).data.url).toBe("");
    expect(allege[2]).toBe(dernier);
  });
  it("le serveur remet tout en place depuis la base", () => {
    const repris = rehydraterHistorique(allegerHistorique([...enBase, dernier]), enBase);
    expect(repris.slice(0, 2)).toEqual(enBase);
    expect(repris[2]).toEqual(dernier);
  });
  it("une partie allégée introuvable en base est retirée", () => {
    const repris = rehydraterHistorique(allegerHistorique([...enBase, dernier]), []);
    expect(repris[0].parts.map((p) => p.type)).toEqual(["text"]);
  });
});

describe("fichiers joints dans l'état du projet", () => {
  it("un fichier joint devient un fichier du projet, que le modèle modifie ensuite par bloc modif", async () => {
    const { fusionnerProjetDetaille } = await import("./projet");
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Corrige mon script" }, { type: "data-fichiers-joints", data: { fichiers: [{ chemin: "main.py", contenu: "print('bonjour')", taille: 16, genre: "code" }, { chemin: "notice.pdf", contenu: "texte du pdf", taille: 9, genre: "document" }] } }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "```modif main.py\n<<<<<<< CHERCHER\nprint('bonjour')\n=======\nprint('Bonjour !')\n>>>>>>> REMPLACER\n```" }] },
    ];
    const { fichiers, echecs, instantanes } = fusionnerProjetDetaille(messages, { instantanes: true });
    expect(echecs).toEqual([]);
    expect(fichiers.map((f) => [f.chemin, f.contenu])).toEqual([["main.py", "print('Bonjour !')\n"]]);
    expect([...(instantanes?.keys() ?? [])]).toEqual(["u1", "a1"]);
  });
});
