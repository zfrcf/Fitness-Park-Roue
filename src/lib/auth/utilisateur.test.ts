import { describe, expect, it } from "vitest";
import { creerJeton } from "./session";
import { AccesRefuse, exigerConversation, oublierCompte, proprietaire, utilisateurDepuisJeton } from "./utilisateur";
import { creerUtilisateur, majUtilisateur } from "@/lib/db/utilisateurs";
import { enregistrerMessages, listerConversations } from "@/lib/db/conversations";

process.env.APP_PASSWORD ??= "mot-de-passe-de-test";

async function membre(id: string) {
  await creerUtilisateur({ id, email: `${id}@exemple.fr`, emailNormalise: `${id}@exemple.fr`, nom: id, hash: "x", statut: "actif" });
  return (await utilisateurDepuisJeton(await creerJeton({ uid: id, role: "membre" })))!;
}

describe("isolation des comptes", () => {
  it("une session sans identité (ancienne) reste l'administrateur", async () => {
    const admin = await utilisateurDepuisJeton(await creerJeton());
    expect(admin?.admin).toBe(true);
    expect(proprietaire(admin!)).toBeNull();
  });

  it("chacun ne voit et n'ouvre que ses conversations", async () => {
    const a = await membre("membre-a");
    const b = await membre("membre-b");
    await enregistrerMessages("conv-de-a", [{ id: "m1", role: "user", parts: [{ type: "text", text: "secret de A" }] }], undefined, proprietaire(a));
    expect((await listerConversations(undefined, 50, proprietaire(a))).map((c) => c.id)).toContain("conv-de-a");
    expect((await listerConversations(undefined, 50, proprietaire(b))).map((c) => c.id)).not.toContain("conv-de-a");
    expect((await listerConversations(undefined, 50, null)).map((c) => c.id)).not.toContain("conv-de-a"); // l'admin n'y est pas mêlé
    await expect(exigerConversation(a, "conv-de-a")).resolves.toEqual({ existe: true });
    await expect(exigerConversation(b, "conv-de-a")).rejects.toBeInstanceOf(AccesRefuse);
    await expect(exigerConversation(b, "conv-nouvelle-de-b")).resolves.toEqual({ existe: false });
  });

  it("un compte bloqué perd l'accès malgré une session valide", async () => {
    await membre("membre-c");
    const jeton = await creerJeton({ uid: "membre-c", role: "membre" });
    await majUtilisateur("membre-c", { statut: "bloque" });
    await oublierCompte("membre-c");
    expect(await utilisateurDepuisJeton(jeton)).toBeNull();
    // Un jeton « membre » ne peut pas se faire passer pour l'administrateur.
    const faux = await utilisateurDepuisJeton(await creerJeton({ uid: "admin-pas-vraiment", role: "admin" }));
    expect(faux?.admin ?? false).toBe(false);
  });
});
