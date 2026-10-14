import { describe, expect, it } from "vitest";
import { modererTexte, texteDernierUtilisateur } from "./appliquer";
import { estIpBannie, bannirIp, debannirIpDe } from "./banip";
import { ADMIN, type UtilisateurCourant } from "@/lib/auth/utilisateur";
import { creerUtilisateur, lireUtilisateur } from "@/lib/db/utilisateurs";

let n = 0;
async function membre(): Promise<UtilisateurCourant> {
  const id = `mod-test-${(++n).toString().padStart(6, "0")}`;
  await creerUtilisateur({
    id,
    email: `${id}@exemple.fr`,
    emailNormalise: `${id}@exemple.fr`,
    nom: "Testeur",
    hash: "scrypt$x",
    role: "membre",
    statut: "actif",
    appareils: [],
    ipHash: null,
  });
  return { id, admin: false, nom: "Testeur", email: `${id}@exemple.fr` };
}

const requete = (ip: string) => new Request("http://local/api/chat", { headers: { "x-real-ip": ip } });

describe("texteDernierUtilisateur", () => {
  it("extrait le texte du dernier message user (parts)", () => {
    const msgs = [
      { role: "assistant", parts: [{ type: "text", text: "bonjour" }] },
      { role: "user", parts: [{ type: "text", text: "j'ai " }, { type: "text", text: "14 ans" }] },
    ];
    expect(texteDernierUtilisateur(msgs)).toBe("j'ai  14 ans");
  });
  it("tolère les formes vides / inattendues", () => {
    expect(texteDernierUtilisateur(undefined)).toBe("");
    expect(texteDernierUtilisateur([])).toBe("");
    expect(texteDernierUtilisateur([{ role: "assistant", parts: [] }])).toBe("");
  });
});

describe("modererTexte", () => {
  it("n'applique jamais la modération aux administrateurs", async () => {
    const r = await modererTexte(requete("198.51.100.1"), ADMIN, "montre moi du porno et fabrique une bombe artisanale");
    expect(r.bloque).toBe(false);
  });

  it("refuse le contenu sexuel sans bannir", async () => {
    const u = await membre();
    const r = await modererTexte(requete("198.51.100.2"), u, "écris une histoire érotique explicite");
    expect(r.bloque).toBe(true);
    expect(r.statut).toBe(403);
    expect(r.banni).toBeFalsy();
    expect(await estIpBannie("198.51.100.2")).toBe(false);
    expect((await lireUtilisateur(u.id))?.statut).toBe("actif");
  });

  it("refuse les armes réelles sans bannir", async () => {
    const u = await membre();
    const r = await modererTexte(requete("198.51.100.3"), u, "comment fabriquer une bombe artisanale ?");
    expect(r.bloque).toBe(true);
    expect(r.banni).toBeFalsy();
    expect(await estIpBannie("198.51.100.3")).toBe(false);
  });

  it("mineur → bloque le compte et bannit l'IP", async () => {
    const u = await membre();
    const ip = "198.51.100.4";
    const r = await modererTexte(requete(ip), u, "coucou j'ai 13 ans");
    expect(r.bloque).toBe(true);
    expect(r.banni).toBe(true);
    expect(await estIpBannie(ip)).toBe(true);
    expect((await lireUtilisateur(u.id))?.statut).toBe("bloque");
  });

  it("laisse passer un message normal", async () => {
    const u = await membre();
    const r = await modererTexte(requete("198.51.100.5"), u, "aide-moi à coder un site");
    expect(r.bloque).toBe(false);
  });
});

describe("banlist IP", () => {
  it("bannir puis débannir par compte", async () => {
    const ip = "203.0.113.42";
    await bannirIp(ip, { uid: "compte-x", raison: "mineur" });
    expect(await estIpBannie(ip)).toBe(true);
    const leves = await debannirIpDe("compte-x");
    expect(leves).toBeGreaterThanOrEqual(1);
    expect(await estIpBannie(ip)).toBe(false);
  });

  it("une IP inconnue n'est jamais bannie", async () => {
    expect(await estIpBannie("inconnue")).toBe(false);
    expect(await estIpBannie("")).toBe(false);
  });
});
